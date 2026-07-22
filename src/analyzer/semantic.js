/**
 * semantic.js — MECHANICAL semantic layer (no AI).
 *
 * Everything here is derived deterministically from the static-analysis index +
 * knowledge graph so the semantic views work with AI switched OFF. AI (Phase 2)
 * only *explains* these facts; it never produces them. This is additive: it is
 * computed at analyze time and attached under index.semantic, leaving every
 * existing index field untouched.
 *
 * Produces:
 *   domains        business/technical modules (directory + name clustering)
 *   subsystems     coarse architectural layers with member files
 *   criticalModules files ranked by graph centrality (fan-in x fan-out)
 *   riskAreas      files combining high complexity/size with high centrality
 *   coreComponents entrypoints + hubs
 *   health         0-100 sub-scores (architecture, docs, testing, security, ...)
 *   learningPath   ordered domains a newcomer should read, with time estimate
 */

const DOMAIN_KEYWORDS = [
  'auth','login','logout','register','signup','signin','password','session','oauth','token','jwt',
  'user','account','profile','member','organization','team','tenant',
  'order','checkout','cart','payment','invoice','billing','subscription','pricing','wallet','transaction',
  'notification','email','mail','sms','push','message','messaging','chat','comment','inbox',
  'upload','download','file','storage','media','image','asset','document',
  'search','index','query','filter','report','analytics','dashboard','metric','stats','export','import',
  'schedule','scheduler','booking','reservation','calendar','event','cron','job','queue','worker','task',
  'product','catalog','inventory','stock','category','review','rating',
  'admin','permission','role','policy','access','rbac','acl','capability',
  'payroll','attendance','leave','onboarding','employee','hr','salary','penalty','holiday',
  'webhook','integration','sync','api','graphql','rest','rpc','grpc','client','gateway','proxy',
  'config','setting','env','feature','flag','cache','redis','database','db','migration','model','entity','schema',
  'test','mock','fixture','util','helper','common','shared','core','lib','middleware','router','route',
];

function tokens(p){
  return p.toLowerCase().replace(/\.[^./]+$/,'').split(/[\/_\-.]+/).filter(Boolean);
}

export function buildSemantic(index){
  const files = index.files.filter((f)=>!f.meta || f.functions);
  const codeFiles = index.files.filter((f)=> f.functions);
  const byPath = new Map(index.files.map((f)=>[f.path,f]));

  // ---------- graph adjacency (file-level) ----------
  const outAdj = new Map();   // file -> Set(imported files)
  const inAdj = new Map();    // file -> Set(importer files)
  for(const f of index.files){ outAdj.set(f.path,new Set()); inAdj.set(f.path,new Set()); }
  for(const f of index.files){
    for(const imp of (f.imports||[])){
      if(imp.resolved && byPath.has(imp.resolved) && imp.resolved!==f.path){
        outAdj.get(f.path).add(imp.resolved);
        if(!inAdj.has(imp.resolved)) inAdj.set(imp.resolved,new Set());
        inAdj.get(imp.resolved).add(f.path);
      }
    }
  }

  // ---------- domains (clustering) ----------
  const domains = clusterDomains(codeFiles, index);

  // ---------- subsystems (layers) ----------
  const layerMembers = {};
  for(const f of codeFiles){
    const layer = f.layer || layerFromGraph(index,f.path) || 'other';
    (layerMembers[layer]=layerMembers[layer]||[]).push(f.path);
  }
  const subsystems = Object.entries(layerMembers).map(([layer,members])=>({
    layer, files: members.length, sample: members.slice(0,6),
  })).sort((a,b)=>b.files-a.files);

  // ---------- centrality / critical modules ----------
  const centrality = codeFiles.map((f)=>{
    const fanIn = (inAdj.get(f.path)||new Set()).size;
    const fanOut = (outAdj.get(f.path)||new Set()).size;
    const fns = f.functions?f.functions.length:0;
    // callers of functions in this file (importance signal)
    const score = (fanIn*2) + fanOut + Math.min(fns,20)*0.2 + Math.min((f.complexity||0),80)*0.05;
    return { path:f.path, fanIn, fanOut, functions:fns, complexity:f.complexity||0, loc:f.loc||0, score:Math.round(score*10)/10 };
  }).sort((a,b)=>b.score-a.score);
  const criticalModules = centrality.slice(0,20);

  // ---------- risk areas ----------
  const riskAreas = centrality.map((c)=>{
    const churnProxy = c.complexity + c.loc*0.02;
    const risk = c.fanIn*3 + churnProxy*0.3 + (c.complexity>60?15:0) + (c.loc>500?10:0);
    const reasons=[];
    if(c.fanIn>=5) reasons.push(`${c.fanIn} modules depend on it`);
    if(c.complexity>60) reasons.push(`high complexity (${c.complexity})`);
    if(c.loc>500) reasons.push(`large file (${c.loc} LOC)`);
    if(c.fanIn>=3 && c.complexity>30) reasons.push('central + complex');
    return { path:c.path, risk:Math.round(risk), fanIn:c.fanIn, complexity:c.complexity, loc:c.loc, reasons };
  }).filter((r)=>r.reasons.length).sort((a,b)=>b.risk-a.risk).slice(0,20);

  // ---------- core components (entrypoints + hubs) ----------
  const entrypoints = codeFiles.filter((f)=>isEntrypoint(f.path)).map((f)=>f.path);
  const coreComponents = {
    entrypoints: entrypoints.slice(0,15),
    hubs: criticalModules.slice(0,8).map((c)=>c.path),
  };

  // ---------- health scores ----------
  const health = computeHealth(index, codeFiles, centrality);

  // ---------- learning path ----------
  const learningPath = buildLearningPath(domains, subsystems, index);

  return {
    domains,
    subsystems,
    criticalModules,
    riskAreas,
    coreComponents,
    health,
    learningPath,
    stats: {
      domains: domains.length,
      subsystems: subsystems.length,
    },
  };
}

function layerFromGraph(index, path){
  const n = index.graph.nodes.find((x)=>x.type==='file' && x.path===path);
  return n ? n.layer : null;
}

function clusterDomains(codeFiles, index){
  // 1) primary cluster by directory (2 levels), 2) refine/label by keyword.
  const dirClusters = new Map();
  for(const f of codeFiles){
    const segs = f.path.split('/');
    const key = segs.length>1 ? segs.slice(0,Math.min(2,segs.length-1)).join('/') : '(root)';
    if(!dirClusters.has(key)) dirClusters.set(key,[]);
    dirClusters.get(key).push(f);
  }

  // keyword tally per cluster to name it
  const routesByFile = new Map();
  for(const r of index.routes){ (routesByFile.get(r.file)||routesByFile.set(r.file,[]).get(r.file)).push(r); }
  const tablesByFile = new Map();
  for(const h of index.dbAccess||[]){ if(!h.table)continue; if(!tablesByFile.has(h.file))tablesByFile.set(h.file,new Set()); tablesByFile.get(h.file).add(h.table); }

  const domains=[];
  for(const [dir,dfiles] of dirClusters){
    if(dfiles.length<1) continue;
    // keyword frequency across the CLUSTER's file basenames (not full paths, to
    // avoid the shared parent dir dominating every child's tokens)
    const kw={};
    for(const f of dfiles){
      const base = f.path.split('/').pop();
      for(const t of tokens(base)){ if(DOMAIN_KEYWORDS.includes(t)) kw[t]=(kw[t]||0)+1; }
    }
    // require a keyword to cover a meaningful share of the cluster to "name" it
    const strongKw = Object.entries(kw)
      .filter(([,n])=>n>=Math.max(2, dfiles.length*0.34))
      .sort((a,b)=>b[1]-a[1]).map((x)=>x[0])
      .filter((k)=>!GENERIC_KW.has(k));
    const topKw = Object.entries(kw).sort((a,b)=>b[1]-a[1]).slice(0,3).map((x)=>x[0]);
    const label = domainLabel(dir, strongKw);
    const routes = dfiles.flatMap((f)=> index.routes.filter((r)=>r.file===f.path));
    const tables = new Set();
    for(const f of dfiles){ for(const t of (tablesByFile.get(f.path)||[])) tables.add(t); }
    const fnCount = dfiles.reduce((s,f)=>s+(f.functions?f.functions.length:0),0);
    const loc = dfiles.reduce((s,f)=>s+(f.loc||0),0);
    domains.push({
      id: 'dom:'+dir,
      label,
      dir,
      keywords: topKw,
      files: dfiles.map((f)=>f.path),
      fileCount: dfiles.length,
      functionCount: fnCount,
      loc,
      routes: routes.length,
      tables: [...tables],
      kind: strongKw.length ? 'business' : 'technical',
    });
  }
  // merge tiny domains (<2 files) into an "misc" only if many
  return domains.sort((a,b)=>b.loc-a.loc);
}

// generic keywords that should not, alone, name a domain
const GENERIC_KW = new Set(['config','test','util','helper','common','shared','core','lib','index','api','route','router','middleware','model','schema','db','database','client']);

function domainLabel(dir, kws){
  if(dir==='(root)') return 'Root';
  const base = dir.split('/').pop();
  if(kws.length && !DOMAIN_KEYWORDS.includes(base)){
    return titleCase(kws[0]) + (kws[1]?' / '+titleCase(kws[1]):'') + ' (' + base + ')';
  }
  return titleCase(base.replace(/[-_]/g,' '));
}

function isEntrypoint(p){
  const b = p.split('/').pop().toLowerCase();
  return /(^|\/)(main|index|app|server|cli|__main__|program|mod|manage)\.[a-z]+$/.test(p.toLowerCase())
    || /(^|\/)(route|page|layout|middleware)\.[a-z]+$/.test(b);
}

function computeHealth(index, codeFiles, centrality){
  const m = index.metrics;
  const totalFiles = Math.max(codeFiles.length,1);
  const totalFns = Math.max(index.functions.length,1);

  // documentation: share of files + large functions that carry a doc comment
  const docFiles = codeFiles.filter((f)=>f.doc).length;
  const bigFns = index.functions.filter((f)=>f.loc>=15);
  const docFns = bigFns.filter((f)=>f.doc).length;
  const docScore = Math.round(clamp01((docFiles/totalFiles)*0.5 + (bigFns.length?docFns/bigFns.length:1)*0.5)*100);

  // testing: share of test files / test LOC
  const testFiles = codeFiles.filter((f)=>/(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\./.test(f.path.toLowerCase())).length;
  const testScore = Math.round(clamp01((testFiles/totalFiles)/0.35)*100); // 35% test files -> 100

  // security: penalize by high-sev findings density
  const highSec = index.security.filter((s)=>s.severity==='high').length;
  const medSec = index.security.filter((s)=>s.severity==='medium').length;
  const secPenalty = highSec*8 + medSec*1.5;
  const securityScore = Math.round(clamp01(1 - secPenalty/Math.max(totalFiles*2,40))*100);

  // complexity: penalize by complex-function density
  const complexFns = index.functions.filter((f)=>f.complexity>=12).length;
  const complexityScore = Math.round(clamp01(1 - complexFns/Math.max(totalFns*0.12,20))*100);

  // coupling: penalize by circular deps + high average fan-in
  const avgFanIn = centrality.reduce((s,c)=>s+c.fanIn,0)/Math.max(centrality.length,1);
  const couplingScore = Math.round(clamp01(1 - (m.summary.circular*0.05 + Math.max(avgFanIn-2,0)*0.12))*100);

  // dead code: penalize by dead-file ratio
  const deadScore = Math.round(clamp01(1 - (m.summary.dead/totalFiles)/0.15)*100);

  // architecture: layer separation + few violations + acyclic
  const layers = Object.keys(m.layerCounts||{}).length;
  const archScore = Math.round(clamp01(
    (m.summary.circular===0?0.4:0.15) +
    (m.summary.layerViolations===0?0.3: Math.max(0,0.3-m.summary.layerViolations*0.01)) +
    Math.min(layers/5,1)*0.3
  )*100);

  // maintainability: composite of size + complexity + docs
  const bigFiles = m.summary.largeFiles;
  const maintainScore = Math.round((complexityScore*0.4 + docScore*0.25 + clamp01(1-bigFiles/Math.max(totalFiles*0.1,10))*100*0.35)/100*100);

  const overall = Math.round((archScore + docScore + testScore + securityScore + maintainScore + couplingScore + complexityScore + deadScore)/8);

  return {
    overall,
    scores: [
      { key:'architecture', label:'Architecture', value:archScore },
      { key:'documentation', label:'Documentation', value:docScore },
      { key:'testing', label:'Testing', value:testScore },
      { key:'security', label:'Security', value:securityScore },
      { key:'maintainability', label:'Maintainability', value:maintainScore },
      { key:'coupling', label:'Coupling', value:couplingScore },
      { key:'complexity', label:'Complexity', value:complexityScore },
      { key:'deadcode', label:'Dead code', value:deadScore },
    ],
    evidence: {
      docFiles, totalFiles, testFiles, highSec, medSec, complexFns,
      circular: m.summary.circular, dead: m.summary.dead, largeFiles: bigFiles,
      layerViolations: m.summary.layerViolations,
    },
  };
}

function buildLearningPath(domains, subsystems, index){
  // Order: config/infra -> core/lib -> auth -> data/models -> domains by size -> ui/tests
  const priority = (d)=>{
    const l = (d.dir||'').toLowerCase();
    const lbl = (d.label||'').toLowerCase();
    if(/(^|\/)(config|configs|settings|infra|deploy|setup|bootstrap|\.github|scripts?)($|\/)/.test(l)) return 0;
    if(/(^|\/)(core|lib|libs|common|shared|util|utils|helpers?)($|\/)/.test(l)) return 1;
    if(/auth|login|session|security|permission/.test(l+' '+lbl)) return 2;
    if(/model|entity|schema|migration|(^|\/)db($|\/)|database/.test(l+' '+lbl)) return 3;
    if(/api|route|controller|handler|server/.test(l+' '+lbl)) return 4;
    if(/(^|\/)(test|tests|spec|specs|__tests__)($|\/)|mock/.test(l)) return 9;
    if(/(^|\/)(ui|components?|views?|pages?|screens?|widgets?)($|\/)/.test(l)) return 8;
    return 5;
  };
  const ordered = domains.slice().filter((d)=>d.fileCount>=1).sort((a,b)=>{
    const pa=priority(a),pb=priority(b);
    if(pa!==pb) return pa-pb;
    return b.loc-a.loc;
  }).slice(0,12);
  // time estimate: ~ LOC / 250 lines-per-min reading + overhead
  const totalLoc = index.manifest.counts.loc;
  const minutes = Math.round(Math.min(totalLoc/220 + ordered.length*4, 600));
  return {
    estimatedMinutes: minutes,
    steps: ordered.map((d,i)=>({
      order:i+1, id:d.id, label:d.label, dir:d.dir,
      files:d.fileCount, routes:d.routes, tables:d.tables.slice(0,6),
      why: whyStep(d, priority(d)),
    })),
  };
}
function whyStep(d, prio){
  switch(prio){
    case 0: return 'Start here: how the app is configured and wired.';
    case 1: return 'Shared building blocks used across the codebase.';
    case 2: return 'How requests are authenticated and authorized.';
    case 3: return 'The data model everything reads and writes.';
    case 4: return 'The HTTP/API surface: how the outside world enters.';
    case 8: return 'The presentation layer.';
    case 9: return 'Tests document expected behavior.';
    default: return `A feature area (${d.fileCount} files${d.routes?`, ${d.routes} routes`:''}${d.tables.length?`, ${d.tables.length} tables`:''}).`;
  }
}

function clamp01(x){ return Math.max(0,Math.min(1,x)); }
function titleCase(s){ return String(s).replace(/\b\w/g,(c)=>c.toUpperCase()); }
