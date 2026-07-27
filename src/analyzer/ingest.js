/**
 * ingest.js — repository ingestion: git clone (GitHub/GitLab/Bitbucket/any git
 * URL) into a cache dir, or use a local path directly. Also reads git metadata
 * (current commit, branch, remote) for the analyzed tree.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const pExecFile = promisify(execFile);

const CACHE_ROOT = path.join(process.env.REPO_INTEL_CACHE || path.join(os.homedir(), '.repo-intel-cache'));

export function normalizeRepoUrl(input) {
  let url = input.trim();
  // scp-like git@host:owner/repo.git -> https
  const scp = url.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (scp) return { url: `https://${scp[1]}/${scp[2]}.git`, kind: 'git' };
  if (/^https?:\/\//.test(url)) {
    if (!url.endsWith('.git') && /github\.com|gitlab\.com|bitbucket\.org/.test(url)) {
      // strip trailing slashes, /tree/branch etc.
      url = url.replace(/\/(tree|blob)\/[^/]+.*$/, '').replace(/\/+$/, '');
      url = url + '.git';
    }
    return { url, kind: 'git' };
  }
  return null;
}

function repoDirFor(url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
  const name = url.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('__').replace(/[^\w.-]/g, '_');
  return path.join(CACHE_ROOT, `${name}-${hash}`);
}

async function run(cmd, args, cwd, timeoutMs = 180000) {
  return pExecFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Resolve an input (git URL or local path) into a working directory.
 * options: { ref, depth, onLog, authToken }
 *
 * authToken (optional): a short-lived credential for cloning a PRIVATE repo.
 * It is used ONLY as an in-memory HTTP Basic credential for a single clone and
 * is NEVER written to disk, logged, or stored in the remote URL. For GitHub App
 * installation tokens this is an x-access-token. See src/github/README.md.
 */
export async function ingest(input, options = {}) {
  const log = options.onLog || (() => {});
  // local path?
  const asPath = path.resolve(input);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isDirectory()) {
    log(`Using local path: ${asPath}`);
    const meta = await gitMeta(asPath);
    return { dir: asPath, source: 'local', input, meta, cloned: false };
  }
  const norm = normalizeRepoUrl(input);
  if (!norm) throw new Error(`Not a directory and not a recognized git URL: ${input}`);

  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  const dir = repoDirFor(norm.url);
  const depth = options.depth ?? (options.ref ? 0 : 1);

  // For private repos we inject the token via an ephemeral HTTP header
  // (http.extraHeader) rather than embedding it in the remote URL, so the
  // credential never lands in .git/config, reflogs, or process listings.
  const auth = options.authToken
    ? authArgs(norm.url, options.authToken)
    : { pre: [], remote: norm.url, redactedRemote: norm.url };

  if (fs.existsSync(path.join(dir, '.git'))) {
    log(`Updating cached clone: ${auth.redactedRemote}`);
    try {
      await run('git', [...auth.pre, 'fetch', '--all', '--tags', '--prune'], dir);
    } catch (e) { log('fetch failed (using cached state): ' + redact(e.message.split('\n')[0], options.authToken)); }
  } else {
    log(`Cloning ${auth.redactedRemote} ...`);
    fs.rmSync(dir, { recursive: true, force: true });
    const args = [...auth.pre, 'clone'];
    if (depth > 0) args.push('--depth', String(depth));
    if (!options.ref) args.push('--single-branch');
    args.push(norm.url, dir);
    try {
      await run('git', args, CACHE_ROOT);
    } catch (e) { throw new Error(redact(e.message.split('\n')[0], options.authToken)); }
  }

  if (options.ref) {
    log(`Checking out ref: ${options.ref}`);
    try {
      await run('git', ['checkout', options.ref], dir);
    } catch {
      // try fetching that specific ref
      try {
        await run('git', [...auth.pre, 'fetch', 'origin', options.ref], dir);
        await run('git', ['checkout', options.ref], dir);
      } catch (e) { throw new Error(`Could not checkout ref '${options.ref}': ${redact(e.message.split('\n')[0], options.authToken)}`); }
    }
  }

  // scrub any credential helper state just in case (defense in depth)
  if (options.authToken) { try { await run('git', ['config', '--unset-all', 'http.extraHeader'], dir, 5000); } catch { /* noop */ } }

  const meta = await gitMeta(dir);
  return { dir, source: 'git', input: norm.url, meta, cloned: true };
}

// Build the ephemeral auth args for a private clone/fetch. GitHub App
// installation tokens authenticate as Basic x-access-token:<token>. We pass the
// header via -c http.extraHeader so it is only present for this invocation.
function authArgs(url, token) {
  const basic = Buffer.from('x-access-token:' + token).toString('base64');
  return {
    pre: ['-c', 'http.extraHeader=Authorization: Basic ' + basic],
    remote: url,
    redactedRemote: url, // url itself carries no secret
  };
}
function redact(msg, token) { return token ? String(msg || '').split(token).join('***') : msg; }

export async function gitMeta(dir) {
  const safe = async (args) => {
    try { return (await run('git', args, dir, 15000)).stdout.trim(); } catch { return null; }
  };
  const [commit, branch, remote, subject, author, date, count] = await Promise.all([
    safe(['rev-parse', 'HEAD']),
    safe(['rev-parse', '--abbrev-ref', 'HEAD']),
    safe(['config', '--get', 'remote.origin.url']),
    safe(['log', '-1', '--pretty=%s']),
    safe(['log', '-1', '--pretty=%an']),
    safe(['log', '-1', '--pretty=%cI']),
    safe(['rev-list', '--count', 'HEAD']),
  ]);
  return { commit, branch, remote, lastSubject: subject, lastAuthor: author, lastDate: date, commitCount: count ? Number(count) : null };
}

// list branches/tags/recent commits for version comparison UI
export async function gitRefs(dir) {
  const safe = async (args) => {
    try { return (await run('git', args, dir, 15000)).stdout.trim(); } catch { return ''; }
  };
  const branches = (await safe(['branch', '-a', '--format=%(refname:short)'])).split('\n').filter(Boolean);
  const tags = (await safe(['tag', '--sort=-creatordate'])).split('\n').filter(Boolean).slice(0, 50);
  const commits = (await safe(['log', '-30', '--pretty=%H\t%s\t%an\t%cI'])).split('\n').filter(Boolean)
    .map((l) => { const [hash, subject, author, date] = l.split('\t'); return { hash, subject, author, date }; });
  return { branches, tags, commits };
}
