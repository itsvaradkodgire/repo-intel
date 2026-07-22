/**
 * insights.js — continuous Repository Insights (ADDITIVE, Phase 4).
 *
 * Computes ranked "insight" lists from the analysis index + git history:
 * most critical / complex / coupled / most-modified (git churn) / least
 * documented / highest-risk / fastest-growing modules. All mechanical; git churn
 * comes from `git log` over the working dir when available.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
const pExec = promisify(execFile);

// churn: number of commits touching each file over the last N commits
async function gitChurn(dir, limit=400){
  const churn = new Map();
  try {
    const { stdout } = await pExec('git', ['log', '-n', String(limit), '--name-only', '--pretty=format:'], { cwd: dir, timeout: 20000, maxBuffer: 32*1024*1024 });
    for(const line of stdout.split('\n')){
      const p = line.trim();
      if(!p) continue;
      churn.set(p, (churn.get(p)||0)+1);
    }
  } catch { /* no git or shallow clone */ }
  return churn;
}

export async function computeInsights(index, dir){
  const files = index.files.filter((f)=>f.functions);
  const byPath = new Map(index.files.map((f)=>[f.path,f]));

  // fan-in / fan-out
  const importers = new Map(); const imports = new Map();
  for(const f of index.files){ importers.set(f.path,0); imports.set(f.path,0); }
  for(const f of index.files){
    for(const imp of (f.imports||[])){
      if(imp.resolved && byPath.has(imp.resolved) && imp.resolved!==f.path){
        imports.set(f.path,(imports.get(f.path)||0)+1);
        importers.set(imp.resolved,(importers.get(imp.resolved)||0)+1);
      }
    }
  }
  const churn = dir ? await gitChurn(dir) : new Map();

  const rows = files.map((f)=>{
    const fanIn=importers.get(f.path)||0, fanOut=imports.get(f.path)||0;
    const ch=churn.get(f.path)||0;
    const documented = !!f.doc;
    const criticality = fanIn*2 + fanOut + (f.complexity||0)*0.05;
    const risk = fanIn*3 + (f.complexity||0)*0.3 + (f.loc>500?10:0) + ch*0.8 + (documented?0:5);
    return {
      path:f.path, label:f.path.split('/').pop(),
      fanIn, fanOut, complexity:f.complexity||0, loc:f.loc||0, churn:ch, documented,
      criticality:Math.round(criticality*10)/10, risk:Math.round(risk*10)/10,
      functions:(f.functions||[]).length,
    };
  });

  const top = (key, n=15, filter=null) => rows.filter(filter||(()=>true)).slice().sort((a,b)=>b[key]-a[key]).slice(0,n);
  const bottom = (key, n=15, filter=null) => rows.filter(filter||(()=>true)).slice().sort((a,b)=>a[key]-b[key]).slice(0,n);

  const hasGit = churn.size>0;

  return {
    hasGit,
    mostCritical: top('criticality'),
    mostComplex: top('complexity'),
    mostCoupled: rows.slice().sort((a,b)=>(b.fanIn+b.fanOut)-(a.fanIn+a.fanOut)).slice(0,15),
    mostModified: hasGit ? top('churn') : [],
    leastDocumented: rows.filter((r)=>!r.documented && r.functions>=2).sort((a,b)=>b.fanIn-a.fanIn).slice(0,15),
    highestRisk: top('risk'),
    mostUnstable: hasGit ? rows.filter((r)=>r.churn>0).sort((a,b)=>(b.churn*b.fanIn)-(a.churn*a.fanIn)).slice(0,15) : [],
    fastestGrowing: hasGit ? top('churn', 15, (r)=>r.loc>100) : [],
    generatedAt: new Date().toISOString(),
  };
}
