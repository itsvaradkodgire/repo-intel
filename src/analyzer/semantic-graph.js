/**
 * semantic-graph.js — Phase 3 MECHANICAL semantic graph engine (ADDITIVE).
 *
 * Builds a hierarchical, layered, semantically-labeled graph ON TOP OF the
 * factual knowledge graph (index.graph). It NEVER invents nodes or edges: every
 * semantic node maps to real files/functions/tables, and every semantic edge is
 * an aggregation of real import/call/read/write/expose edges. AI (later) only
 * narrates this; it does not produce it.
 *
 * Output (attached as index.semanticGraph):
 *   hierarchy   nested tree: repo > domain > subsystem > module > file > (class/fn)
 *   nodes       flat semantic nodes with metrics + layer membership
 *   edges       semantic edges (verb + explanation + evidence count)
 *   layers      per-layer node/edge id sets (technical/business/data/api/db/...)
 *   heatmaps    per-node metric values (criticality, coupling, complexity, ...)
 *   clusters    domain-level clusters (from the mechanical semantic layer)
 */
import { layerOf } from './graph.js';

// Semantic verb inference for an aggregated relationship between two groups.
// Derived from the real edge types flowing between the groups' members.
function verbForEdges(edgeTypes){
  // edgeTypes: {imports, calls, reads, writes, exposes, uses, contains}
  if(edgeTypes.writes && !edgeTypes.reads) return { verb:'persists', explain:'writes records into' };
  if(edgeTypes.writes && edgeTypes.reads) return { verb:'reads/writes', explain:'reads from and writes to' };
  if(edgeTypes.reads) return { verb:'reads', explain:'reads data from' };
  if(edgeTypes.exposes) return { verb:'exposes', explain:'exposes an HTTP surface via' };
  if(edgeTypes.calls && edgeTypes.imports) return { verb:'uses', explain:'imports and calls into' };
  if(edgeTypes.calls) return { verb:'calls', explain:'invokes functions in' };
  if(edgeTypes.imports) return { verb:'depends on', explain:'imports symbols from' };
  if(edgeTypes.uses) return { verb:'uses', explain:'uses' };
  return { verb:'relates to', explain:'is related to' };
}

// refine verb by the semantic role of the target (table => persists, route => exposes)
function refineVerbByRole(base, targetRole, targetLabel){
  if(targetRole==='table'){
    if(/write|persist/.test(base.verb)) return { verb:'persists', explain:`persists data to the ${targetLabel} table` };
    return { verb:'reads', explain:`reads the ${targetLabel} table` };
  }
  if(targetRole==='route') return { verb:'exposes', explain:`exposes ${targetLabel}` };
  if(targetRole==='env') return { verb:'configures', explain:`reads configuration ${targetLabel}` };
  if(targetRole==='dependency') return { verb:'uses', explain:`uses the ${targetLabel} library` };
  return base;
}

export function buildSemanticGraph(index){
  const sem = index.semantic;
  if(!sem) return null;
  const fileByPath = new Map(index.files.map((f)=>[f.path,f]));
  const codeFiles = index.files.filter((f)=>f.functions);

  // ---- map each file to a domain (from mechanical semantic domains) ----
  const domainOfFile = new Map();
  for(const d of sem.domains){ for(const p of d.files) domainOfFile.set(p, d); }

  // ---- heatmap metrics per file (all mechanical) ----
  const importers = new Map(); const imports = new Map();
  for(const f of index.files){ importers.set(f.path,new Set()); imports.set(f.path,new Set()); }
  for(const f of index.files){
    for(const imp of (f.imports||[])){
      if(imp.resolved && fileByPath.has(imp.resolved) && imp.resolved!==f.path){
        imports.get(f.path).add(imp.resolved);
        importers.get(imp.resolved) || importers.set(imp.resolved,new Set());
        importers.get(imp.resolved).add(f.path);
      }
    }
  }
  const testImporters = new Map(); // file -> #test files importing it (proxy for tested-ness)
  for(const f of index.files){
    if(!/(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\./.test(f.path.toLowerCase())) continue;
    for(const t of (imports.get(f.path)||[])) testImporters.set(t,(testImporters.get(t)||0)+1);
  }
  const fileMetric = new Map();
  let maxImp=1,maxCx=1,maxLoc=1;
  for(const f of codeFiles){
    const fanIn=(importers.get(f.path)||new Set()).size;
    const fanOut=(imports.get(f.path)||new Set()).size;
    maxImp=Math.max(maxImp,fanIn); maxCx=Math.max(maxCx,f.complexity||0); maxLoc=Math.max(maxLoc,f.loc||0);
    fileMetric.set(f.path,{fanIn,fanOut,complexity:f.complexity||0,loc:f.loc||0,tested:(testImporters.get(f.path)||0),functions:(f.functions||[]).length});
  }
  // normalized heatmaps 0..1
  for(const [p,m] of fileMetric){
    m.h_mostImported = m.fanIn/maxImp;
    m.h_mostCoupled = (m.fanIn+m.fanOut)/(maxImp*2);
    m.h_complexity = m.complexity/maxCx;
    m.h_leastTested = m.tested>0?0:(m.fanIn>0?0.8:0.4); // untested + imported = hot
    m.h_criticality = Math.min(1,(m.fanIn/maxImp)*0.6 + (m.complexity/maxCx)*0.4);
    m.h_risk = Math.min(1,(m.fanIn/maxImp)*0.4 + (m.complexity/maxCx)*0.3 + (m.loc/maxLoc)*0.3);
  }

  // ---- semantic node ids ----
  const nodes = [];          // flat list of ALL semantic nodes (every level)
  const nodeById = new Map();
  function addNode(n){ nodes.push(n); nodeById.set(n.id,n); return n; }

  const repoLabel = (index.source && index.source.input ? index.source.input.split('/').pop().replace(/\.git$/,'') : 'repository');
  const repoNode = addNode({ id:'repo', kind:'repo', label:repoLabel, parent:null, children:[], files:codeFiles.length, layers:['technical'] });

  // domain nodes
  for(const d of sem.domains){
    const dn = addNode({
      id:d.id, kind:'domain', label:d.label, parent:'repo', children:[],
      dir:d.dir, domainKind:d.kind, files:d.fileCount, loc:d.loc, routes:d.routes, tables:d.tables.slice(),
      layers: domainLayers(d), evidence:{ files:d.files.slice(0,50) },
    });
    repoNode.children.push(dn.id);
  }

  // subsystem = layer within a domain (only if the domain spans >1 layer with >1 file)
  // module = a sub-directory within a domain (one level deeper than the domain dir)
  // We use MODULES = immediate subdirectories; FILE nodes under modules; and
  // CLASS/FUNCTION nodes lazily referenced (not all materialized to keep it light).
  const moduleNodes = new Map(); // key -> node
  for(const d of sem.domains){
    const domId=d.id;
    // group this domain's files by their next path segment after the domain dir
    const groups = new Map();
    for(const p of d.files){
      const rest = d.dir==='(root)'? p : p.slice(d.dir.length+1);
      const seg = rest.includes('/') ? rest.split('/')[0] : '(files)';
      if(!groups.has(seg)) groups.set(seg,[]);
      groups.get(seg).push(p);
    }
    for(const [seg,files] of groups){
      const mid = domId+'/mod:'+seg;
      const layerSet = new Set(); files.forEach((p)=>layerSet.add(layerOfFile(index,p)));
      const loc = files.reduce((s,p)=>s+((fileByPath.get(p)||{}).loc||0),0);
      const mnode = addNode({
        id:mid, kind:'module', label:seg==='(files)'?d.label+' files':seg, parent:domId, children:[],
        files:files.length, loc, layers:[...layerSet], evidence:{files:files.slice(0,50)},
      });
      moduleNodes.set(mid,mnode);
      nodeById.get(domId).children.push(mid);
      // file nodes under the module
      for(const p of files){
        const f=fileByPath.get(p); if(!f)continue;
        const fid='file:'+p;
        const met=fileMetric.get(p)||{};
        const fnode=addNode({
          id:fid, kind:'file', label:p.split('/').pop(), parent:mid, children:[], path:p,
          lang:f.lang, loc:f.loc, functions:(f.functions||[]).length, classes:(f.classes||[]).length,
          layers:[layerOfFile(index,p)], doc:f.doc||null, metric:met,
        });
        mnode.children.push(fid);
        // class + function children (materialized but flagged lazy for render)
        (f.classes||[]).forEach((c)=>{ const cid=fid+'::class:'+c.name; addNode({id:cid,kind:'class',label:c.name,parent:fid,children:[],path:p,line:c.line,ckind:c.kind,layers:fnode.layers}); fnode.children.push(cid); });
        (f.functions||[]).slice(0,60).forEach((fn)=>{ const fnid=fid+'::fn:'+fn.name+'#'+fn.line; addNode({id:fnid,kind:'function',label:fn.name,parent:fid,children:[],path:p,line:fn.line,complexity:fn.complexity,loc:fn.loc,layers:fnode.layers}); fnode.children.push(fnid); });
      }
    }
  }

  // ---- semantic EDGES between domains (aggregate real edges) ----
  const domEdgeMap = new Map(); // "a->b" -> {types:{}, count, samples:[]}
  const fileToDom = (p)=>{ const d=domainOfFile.get(p); return d?d.id:null; };
  for(const f of index.files){
    const fromDom=fileToDom(f.path); if(!fromDom)continue;
    for(const imp of (f.imports||[])){
      if(imp.resolved && domainOfFile.has(imp.resolved)){
        const toDom=fileToDom(imp.resolved); if(!toDom||toDom===fromDom)continue;
        bump(domEdgeMap,fromDom,toDom,'imports',f.path+' -> '+imp.resolved);
      }
    }
  }
  // calls between domains via function call graph
  const fnById=new Map(index.functions.map((f)=>[f.id,f]));
  for(const fn of index.functions){
    const fromDom=fileToDom(fn.file); if(!fromDom)continue;
    for(const cid of (fn.resolvedCalls||[])){
      const c=fnById.get(cid); if(!c)continue; const toDom=fileToDom(c.file);
      if(toDom&&toDom!==fromDom) bump(domEdgeMap,fromDom,toDom,'calls',fn.name+'()->'+c.name+'()');
    }
  }
  // data writes/reads: domain -> table node
  const tableNodes=new Map();
  for(const t of index.tables){ const tid='table:'+t.name; if(!tableNodes.has(tid)){tableNodes.set(tid,addNode({id:tid,kind:'table',label:t.name,parent:'repo',children:[],layers:['data','database']}));} }
  for(const hh of (index.dbAccess||[])){
    if(!hh.table)continue; const fromDom=fileToDom(hh.file); if(!fromDom)continue;
    const write=/write|insert|update|delete|create|save|upsert|ddl/i.test(hh.kind+' '+(hh.op||''));
    bump(domEdgeMap,fromDom,'table:'+hh.table,write?'writes':'reads',hh.file+' '+(write?'writes':'reads')+' '+hh.table);
  }
  // routes exposed by domain -> route node cluster (aggregate as a single "API" node per domain)
  const edges=[];
  for(const [key,agg] of domEdgeMap){
    const [source,target]=key.split('->');
    const targetNode=nodeById.get(target)||tableNodes.get(target);
    const role= target.startsWith('table:')?'table': (nodeById.get(target)||{}).kind || 'domain';
    let vb=verbForEdges(agg.types);
    vb=refineVerbByRole(vb,role,(targetNode||{}).label||target.replace(/^table:/,''));
    edges.push({
      source, target, verb:vb.verb, explanation:vb.explain, count:agg.count,
      types:Object.keys(agg.types), samples:agg.samples.slice(0,5),
      layers: edgeLayers(agg.types),
    });
  }

  // ---- layers: which node/edge ids belong to each layer ----
  const LAYER_DEFS = ['technical','business','data','api','database','security','performance','testing','infrastructure','dependency'];
  const layers={};
  for(const L of LAYER_DEFS) layers[L]={nodes:[],edges:[]};
  for(const n of nodes){ for(const L of (n.layers||['technical'])) if(layers[L]) layers[L].nodes.push(n.id); }
  edges.forEach((e,i)=>{ for(const L of (e.layers||['technical'])) if(layers[L]) layers[L].edges.push(i); });
  // security/performance/testing/infra layer membership from detectors
  tagSpecialLayers(index, nodeById, layers);

  // ---- clusters (domain clusters w/ member files) ----
  const clusters = sem.domains.map((d)=>({ id:d.id, label:d.label, kind:d.domainKind||d.kind, files:d.files.length, layers:domainLayers(d) }));

  // ---- intent modes: predefined graph views (mechanical filters) ----
  const intents = buildIntents(index, sem, nodeById);

  return {
    hierarchy: { rootId:'repo' },
    nodes, edges,
    layers, clusters, intents,
    heatmaps: ['h_criticality','h_mostImported','h_mostCoupled','h_complexity','h_leastTested','h_risk'],
    stats:{ nodes:nodes.length, edges:edges.length, domains:sem.domains.length },
  };
}

function bump(map,from,to,type,sample){
  const key=from+'->'+to;
  if(!map.has(key)) map.set(key,{types:{},count:0,samples:[]});
  const a=map.get(key); a.types[type]=(a.types[type]||0)+1; a.count++; if(a.samples.length<8)a.samples.push(sample);
}
function layerOfFile(index,p){ const n=index.graph.nodes.find((x)=>x.type==='file'&&x.path===p); return n?n.layer:'other'; }
function domainLayers(d){
  const L=new Set(['business']);
  if(d.routes) L.add('api');
  if(d.tables && d.tables.length) { L.add('data'); L.add('database'); }
  const l=(d.label+' '+d.dir).toLowerCase();
  if(/auth|login|permission|security|token|session/.test(l)) L.add('security');
  if(/test|spec|mock/.test(l)) L.add('testing');
  if(/config|infra|deploy|docker|ci|worker|job|queue|cache|redis/.test(l)) L.add('infrastructure');
  L.add('technical');
  return [...L];
}
function edgeLayers(types){
  const L=new Set(['technical']);
  if(types.reads||types.writes){L.add('data');L.add('database');}
  if(types.exposes)L.add('api');
  if(types.imports||types.calls)L.add('dependency');
  L.add('business');
  return [...L];
}
function tagSpecialLayers(index, nodeById, layers){
  // mark file nodes touched by security findings / perf signals / jobs / infra
  const secFiles=new Set((index.security||[]).map((s)=>s.file));
  const jobFiles=new Set((index.jobs||[]).map((j)=>j.file));
  for(const [id,n] of nodeById){
    if(n.kind!=='file')continue;
    if(secFiles.has(n.path)){ if(!n.layers.includes('security'))n.layers.push('security'); layers.security.nodes.push(id); }
    if(jobFiles.has(n.path)){ if(!n.layers.includes('infrastructure'))n.layers.push('infrastructure'); layers.infrastructure.nodes.push(id); }
    if((n.metric&&n.metric.h_complexity>0.6)){ if(!n.layers.includes('performance'))n.layers.push('performance'); layers.performance.nodes.push(id); }
    if(/(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\./.test((n.path||'').toLowerCase())){ if(!n.layers.includes('testing'))n.layers.push('testing'); layers.testing.nodes.push(id); }
  }
}

// intent modes = named filters that select a subset of nodes/edges mechanically
function buildIntents(index, sem, nodeById){
  const intents=[];
  const domsMatching=(re)=>sem.domains.filter((d)=>re.test((d.label+' '+d.dir).toLowerCase())).map((d)=>d.id);
  const add=(id,label,nodeIds,note)=>{ if(nodeIds.length) intents.push({id,label,nodeIds:[...new Set(nodeIds)],note}); };
  add('auth','Show Authentication',domsMatching(/auth|login|session|permission|token|oauth|security/),'Domains related to authentication/authorization.');
  add('db','Show Database Writes',dataDomains(index,sem,true),'Domains that write to the database.');
  add('db-read','Show Database Reads',dataDomains(index,sem,false),'Domains that read the database.');
  add('api','Show External APIs / Routes',sem.domains.filter((d)=>d.routes>0).map((d)=>d.id),'Domains exposing HTTP routes.');
  add('jobs','Show Background Jobs',jobDomains(index,sem),'Domains containing background jobs / workers / cron.');
  add('notif','Show Notifications',domsMatching(/notif|email|mail|sms|push|message/),'Notification-related domains.');
  add('frontend','Show Frontend',domsMatching(/ui|component|view|page|frontend|client|web/),'Frontend/UI domains.');
  add('backend','Show Backend',sem.domains.filter((d)=>d.routes>0||d.tables.length>0).map((d)=>d.id),'Server-side domains (routes or DB).');
  add('infra','Show Infrastructure',domsMatching(/config|infra|deploy|docker|ci|worker|queue|cache|redis/),'Infrastructure/config domains.');
  add('security','Show Security-sensitive',securityDomains(index,sem),'Domains with security findings or auth logic.');
  add('critical','Show Critical Modules',sem.criticalModules.slice(0,12).map((m)=>'file:'+m.path),'Highest graph-centrality files.');
  return intents;
}
function dataDomains(index,sem,write){
  const doms=new Set();
  const fileDom=new Map(); for(const d of sem.domains)for(const p of d.files)fileDom.set(p,d.id);
  for(const hh of (index.dbAccess||[])){ if(!hh.table)continue; const w=/write|insert|update|delete|create|save|upsert|ddl/i.test(hh.kind+' '+(hh.op||'')); if(w===write&&fileDom.has(hh.file))doms.add(fileDom.get(hh.file)); }
  return [...doms];
}
function jobDomains(index,sem){
  const doms=new Set(); const fileDom=new Map(); for(const d of sem.domains)for(const p of d.files)fileDom.set(p,d.id);
  for(const j of (index.jobs||[])) if(fileDom.has(j.file))doms.add(fileDom.get(j.file));
  return [...doms];
}
function securityDomains(index,sem){
  const doms=new Set(); const fileDom=new Map(); for(const d of sem.domains)for(const p of d.files)fileDom.set(p,d.id);
  for(const s of (index.security||[])) if(fileDom.has(s.file))doms.add(fileDom.get(s.file));
  sem.domains.filter((d)=>/auth|login|permission|security/.test((d.label+' '+d.dir).toLowerCase())).forEach((d)=>doms.add(d.id));
  return [...doms];
}
