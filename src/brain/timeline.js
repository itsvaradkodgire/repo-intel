/**
 * timeline.js — repository evolution timeline (ADDITIVE, Phase 4).
 *
 * Walks the git history and, at sampled commits, records lightweight structural
 * snapshots (file count, code-file count by extension, route/table proxies via
 * cheap grep-free heuristics on the tree) so the UI can animate architecture
 * growth over time WITHOUT fully re-analyzing every commit. Full semantic diff
 * between two specific refs already exists (compare/commit-intel); this is the
 * cheap longitudinal view.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
const pExec = promisify(execFile);

const CODE_EXTS = new Set(['.ts','.tsx','.js','.jsx','.py','.go','.rs','.java','.kt','.rb','.php','.cs','.c','.cpp','.swift','.dart','.scala']);

async function git(dir, args, timeout=20000){
  try { const { stdout } = await pExec('git', args, { cwd: dir, timeout, maxBuffer: 48*1024*1024 }); return stdout; } catch { return ''; }
}

export async function buildTimeline(dir, opts={}){
  const maxPoints = opts.points || 24;
  const log = await git(dir, ['log', '--pretty=%H\t%cI\t%s', '-n', '4000']);
  const commits = log.split('\n').filter(Boolean).map((l)=>{ const [hash,date,subject]=l.split('\t'); return { hash, date, subject }; });
  if(!commits.length) return { available:false, points:[] };
  // sample evenly across history (oldest -> newest)
  const ordered = commits.slice().reverse();
  const step = Math.max(1, Math.floor(ordered.length/maxPoints));
  const sample = [];
  for(let i=0;i<ordered.length;i+=step) sample.push(ordered[i]);
  if(sample[sample.length-1]!==ordered[ordered.length-1]) sample.push(ordered[ordered.length-1]);

  const points=[];
  for(const c of sample){
    const tree = await git(dir, ['ls-tree','-r','--name-only', c.hash], 25000);
    if(!tree) continue;
    const files = tree.split('\n').filter(Boolean);
    let code=0; const byLang={};
    let routes=0, tables=0, tests=0;
    for(const f of files){
      const ext = f.slice(f.lastIndexOf('.'));
      if(CODE_EXTS.has(ext)){ code++; byLang[ext]=(byLang[ext]||0)+1; }
      if(/\/route\.(ts|js|tsx|jsx)$|routes?\.|controller|_controller|urls\.py|routes\.rb/.test(f)) routes++;
      if(/migration|schema\.|\.sql$|models?\./.test(f)) tables++;
      if(/(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\./.test(f.toLowerCase())) tests++;
    }
    points.push({ hash:c.hash.slice(0,8), date:c.date, subject:c.subject.slice(0,80), files:files.length, code, routes, tables, tests, langs:Object.keys(byLang).length });
  }
  return { available:true, totalCommits:commits.length, sampled:points.length, points };
}
