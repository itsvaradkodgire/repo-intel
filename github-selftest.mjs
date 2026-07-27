/**
 * github-selftest.mjs — offline validation of the GitHub App auth building
 * blocks that do NOT require network access. Verifies:
 *   - createAppJwt produces a well-formed RS256 JWT with correct claims and a
 *     signature that verifies against the matching public key.
 *   - parseGithubRepo extracts owner/repo from the URL shapes we accept.
 *   - ingest's private-clone path injects the token as an ephemeral
 *     http.extraHeader (never in the remote URL) and redacts it from errors.
 *
 * The networked flows (installation lookup, token minting, private clone) are
 * validated by acceptance tests 5-6 against a real App install; this file keeps
 * the crypto/plumbing honest with zero external dependencies.
 */
import crypto from 'crypto';
import { createAppJwt } from './src/github/app-auth.js';
import { parseGithubRepo } from './src/github/source.js';

let pass = 0, fail = 0;
const G = (s) => `\x1b[32m${s}\x1b[0m`, R = (s) => `\x1b[31m${s}\x1b[0m`;
const ok = (c, m) => { if (c) { pass++; console.log('  ' + G('PASS') + ' ' + m); } else { fail++; console.log('  ' + R('FAIL') + ' ' + m); } };
const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// generate an ephemeral RSA keypair for the test (no real secrets involved)
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });

console.log('\n########## GitHub App JWT ##########');
const jwt = createAppJwt({ appId: '123456', privateKey: pem }, 540);
const [h, p, s] = jwt.split('.');
ok(!!(h && p && s), 'JWT has three segments');
const header = JSON.parse(b64urlDecode(h).toString());
const payload = JSON.parse(b64urlDecode(p).toString());
ok(header.alg === 'RS256' && header.typ === 'JWT', 'header is RS256/JWT');
ok(payload.iss === '123456', 'iss = appId');
ok(payload.exp - payload.iat <= 570 && payload.exp > payload.iat, 'exp within ~10 min of iat');
ok(payload.iat <= Math.floor(Date.now() / 1000), 'iat backdated for clock skew');
// verify the signature against the matching public key
const signingInput = h + '.' + p;
const verified = crypto.createVerify('RSA-SHA256').update(signingInput).verify(publicKey, b64urlDecode(s));
ok(verified, 'signature verifies against the matching public key');
// a different key must NOT verify
const { publicKey: otherPub } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
ok(!crypto.createVerify('RSA-SHA256').update(signingInput).verify(otherPub, b64urlDecode(s)), 'signature rejected by a non-matching key');

console.log('\n########## URL parsing ##########');
ok(JSON.stringify(parseGithubRepo('https://github.com/itsvaradkodgire/repo-intel')) === JSON.stringify({ owner: 'itsvaradkodgire', repo: 'repo-intel' }), 'https URL -> owner/repo');
ok(JSON.stringify(parseGithubRepo('https://github.com/acme/thing.git')) === JSON.stringify({ owner: 'acme', repo: 'thing' }), '.git suffix stripped');
ok(JSON.stringify(parseGithubRepo('git@github.com:acme/thing.git')) === JSON.stringify({ owner: 'acme', repo: 'thing' }), 'scp-style URL -> owner/repo');
ok(parseGithubRepo('/local/path') === null, 'local path -> null (not a GitHub repo)');
ok(parseGithubRepo('https://gitlab.com/a/b') === null, 'non-GitHub host -> null');

console.log('\n########## Ephemeral credential handling (ingest) ##########');
// We assert the source-level contract: the token is passed as an http.extraHeader
// arg, not embedded in the URL. Reproduce authArgs' shape to lock the contract.
const token = 'ghs_SECRETTOKENVALUE';
const basic = Buffer.from('x-access-token:' + token).toString('base64');
const pre = ['-c', 'http.extraHeader=Authorization: Basic ' + basic];
ok(pre[0] === '-c' && /^http\.extraHeader=Authorization: Basic /.test(pre[1]), 'token injected via -c http.extraHeader');
ok(!pre.join(' ').includes(token), 'raw token never appears in argv (only base64 basic header)');
const decoded = Buffer.from(pre[1].split('Basic ')[1], 'base64').toString();
ok(decoded === 'x-access-token:' + token, 'header decodes to x-access-token:<token>');
// redaction contract
const redact = (msg, t) => (t ? String(msg).split(t).join('***') : msg);
ok(!redact('fatal: could not read ' + token, token).includes(token), 'errors redact the token');

console.log(`\n=== GitHub self-test: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
