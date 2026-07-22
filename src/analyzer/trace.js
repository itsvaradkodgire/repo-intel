/**
 * trace.js — MECHANICAL impact analysis + data/request/flow tracing.
 *
 * All derived from the knowledge graph (imports, calls, reads/writes, exposes).
 * No AI. These power: "what breaks if I delete X", Follow Data, Follow Request,
 * Follow Business Flow. Returns node/edge subgraphs the UI renders interactively.
 */

function buildAdj(index){
  const byPath = new Map(index.files.map((f)=>[f.path,f]));
  const importers = new Map();   // file -> [files that import it]
  const imports = new Map();     // file -> [files it imports]
  for(const f of index.files){ importers.set(f.path,[]); imports.set(f.path,[]); }
  for(const f of index.files){
    for(const imp of (f.imports||[])){
      if(imp.resolved && byPath.has(imp.resolved) && imp.resolved!==f.path){
        imports.get(f.path).push(imp.resolved);
        if(!importers.has(imp.resolved)) importers.set(imp.resolved,[]);
        importers.get(imp.resolved).push(f.path);
      }
    }
  }
  const fnById = new Map(index.functions.map((f)=>[f.id,f]));
  return { byPath, importers, imports, fnById };
}

// ---------------------------------------------------------------------------
// IMPACT: what breaks if you delete a file / function / table
// ---------------------------------------------------------------------------
export function impactOfFile(index, path){
  const { importers, fnById } = buildAdj(index);
  // transitive set of files that (directly/indirectly) import `path`
  const affectedFiles = new Set();
  const queue = [path];
  const directImporters = new Set(importers.get(path)||[]);
  while(queue.length){
    const cur = queue.shift();
    for(const imp of (importers.get(cur)||[])){
      if(!affectedFiles.has(imp)){ affectedFiles.add(imp); queue.push(imp); }
    }
  }
  affectedFiles.delete(path);

  // functions defined in this file, and their in-repo callers
  const ownFns = index.functions.filter((f)=>f.file===path);
  const affectedFns = new Set();
  for(const fn of ownFns){
    for(const callerId of (fn.calledBy||[])){
      const c = fnById.get(callerId);
      if(c && c.file!==path) affectedFns.add(callerId);
    }
  }

  // routes exposed by this file (would disappear)
  const affectedRoutes = index.routes.filter((r)=>r.file===path);
  // tables this file writes/reads (data access lost, not the table itself)
  const tables = new Set();
  for(const h of (index.dbAccess||[])){ if(h.file===path && h.table) tables.add(h.table); }
  // tests referencing this file
  const affectedTests = [...affectedFiles].filter((p)=>/(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\./.test(p.toLowerCase()));
  // business flows whose entry or steps include this file
  const affectedFlows = (index.flows||[]).filter((fl)=> fl.entry===path || (fl.steps||[]).some((s)=>s.ref===path) || (fl.routes||[]).some((r)=>r.file===path));

  const severity = affectedFiles.size>=10||affectedRoutes.length>=3 ? 'high'
                 : affectedFiles.size>=3||affectedFns.size>=5 ? 'medium' : 'low';

  return {
    target: path,
    kind: 'file',
    severity,
    directImporters: [...directImporters],
    affectedFiles: [...affectedFiles],
    affectedFunctions: [...affectedFns].map((id)=>{const f=fnById.get(id);return {id,name:f.name,file:f.file};}),
    affectedRoutes: affectedRoutes.map((r)=>({method:r.method,path:r.path,file:r.file})),
    affectedTables: [...tables],
    affectedTests,
    affectedFlows: affectedFlows.map((f)=>({id:f.id,name:f.name})),
    summary: {
      files: affectedFiles.size, functions: affectedFns.size, routes: affectedRoutes.length,
      tables: tables.size, tests: affectedTests.length, flows: affectedFlows.length,
    },
  };
}

export function impactOfFunction(index, fnId){
  const { fnById } = buildAdj(index);
  const fn = fnById.get(fnId);
  if(!fn) return null;
  // transitive callers
  const affected = new Set();
  const queue = [fnId];
  while(queue.length){
    const cur = queue.shift();
    const cfn = fnById.get(cur);
    if(!cfn) continue;
    for(const callerId of (cfn.calledBy||[])){
      if(!affected.has(callerId)){ affected.add(callerId); queue.push(callerId); }
    }
  }
  affected.delete(fnId);
  const affectedFiles = new Set([...affected].map((id)=>fnById.get(id)?.file).filter(Boolean));
  const severity = affected.size>=15 ? 'high' : affected.size>=4 ? 'medium' : 'low';
  return {
    target: fnId, kind:'function', name: fn.name, file: fn.file, severity,
    affectedFunctions: [...affected].map((id)=>{const f=fnById.get(id);return {id,name:f.name,file:f.file};}),
    affectedFiles: [...affectedFiles],
    summary: { functions: affected.size, files: affectedFiles.size },
  };
}

export function impactOfTable(index, table){
  const readers = new Set(), writers = new Set();
  for(const h of (index.dbAccess||[])){
    if(h.table!==table) continue;
    const write = /write|insert|update|delete|create|save|upsert|ddl/i.test(h.kind+' '+(h.op||''));
    if(write) writers.add(h.file); else readers.add(h.file);
  }
  const all = new Set([...readers,...writers]);
  const flows = (index.flows||[]).filter((fl)=> (fl.tablesWritten||[]).includes(table));
  const severity = all.size>=8 ? 'high' : all.size>=3 ? 'medium':'low';
  return {
    target: table, kind:'table', severity,
    readers:[...readers], writers:[...writers],
    affectedFlows: flows.map((f)=>({id:f.id,name:f.name})),
    summary:{ readers:readers.size, writers:writers.size, flows:flows.length },
  };
}

// ---------------------------------------------------------------------------
// FOLLOW DATA: creation -> validation -> storage -> reads -> updates -> deletes
// Trace a table's lifecycle across the codebase.
// ---------------------------------------------------------------------------
export function traceData(index, table){
  const stages = { create:[], read:[], update:[], delete:[], ddl:[] };
  for(const h of (index.dbAccess||[])){
    if(h.table!==table) continue;
    const kind=(h.kind+' '+(h.op||'')).toLowerCase();
    let stage='read';
    if(/ddl/.test(kind)) stage='ddl';
    else if(/insert|create|save|add/.test(kind)) stage='create';
    else if(/update|upsert|patch|set/.test(kind)) stage='update';
    else if(/delete|remove|destroy/.test(kind)) stage='delete';
    else stage='read';
    stages[stage].push({ file:h.file, line:h.line, kind:h.kind });
  }
  const nodes=[{id:'table:'+table,type:'table',label:table}];
  const edges=[];
  const order=[['ddl','Definition'],['create','Creation'],['update','Update'],['read','Read'],['delete','Deletion']];
  for(const [stage,label] of order){
    const hits=dedupeByFile(stages[stage]);
    hits.slice(0,12).forEach((hh)=>{
      const id='file:'+hh.file;
      if(!nodes.find((n)=>n.id===id)) nodes.push({id,type:'file',label:hh.file.split('/').pop(),path:hh.file});
      edges.push({source:id,target:'table:'+table,type:stage,label:label});
    });
  }
  return {
    kind:'data', target:table,
    stages: order.map(([s,label])=>({stage:s,label,sites:dedupeByFile(stages[s]).slice(0,20)})),
    graph:{nodes,edges},
  };
}

// ---------------------------------------------------------------------------
// FOLLOW REQUEST: browser -> middleware -> route -> handler chain -> db -> response
// ---------------------------------------------------------------------------
export function traceRequest(index, method, path, file){
  const { fnById } = buildAdj(index);
  const route = index.routes.find((r)=>r.method===method && r.path===path && (!file||r.file===file))
             || index.routes.find((r)=>r.method===method && r.path===path);
  if(!route) return null;
  // handler functions in the route's file
  const handlerFns = index.functions.filter((f)=>f.file===route.file);
  // transitive call closure from handlers -> collect files + tables
  const chain = new Set();
  const stack = handlerFns.map((f)=>f.id);
  let guard=0;
  while(stack.length && guard++<3000){
    const id=stack.pop(); if(chain.has(id))continue; chain.add(id);
    const fn=fnById.get(id); if(!fn)continue;
    for(const c of (fn.resolvedCalls||[])) if(!chain.has(c)) stack.push(c);
  }
  const chainFiles=[]; const seenF=new Set([route.file]);
  for(const id of chain){ const fn=fnById.get(id); if(fn&&!seenF.has(fn.file)){seenF.add(fn.file);chainFiles.push(fn.file);} }
  const tables=new Set();
  for(const f of [route.file,...chainFiles]) for(const h of (index.dbAccess||[])) if(h.file===f&&h.table){const w=/write|insert|update|delete|create|save|upsert/i.test(h.kind+' '+(h.op||''));tables.add((w?'write ':'read ')+h.table);}
  // middleware detection
  const middleware = index.files.filter((f)=>/middleware/i.test(f.path)).map((f)=>f.path).slice(0,4);

  const steps=[];
  steps.push({kind:'client',label:'Client / Browser',detail:`${method} ${path}`});
  if(middleware.length) steps.push({kind:'middleware',label:'Middleware',detail:middleware.map((m)=>m.split('/').pop()).join(', '),refs:middleware});
  steps.push({kind:'route',label:`Route handler`,detail:route.file.split('/').pop()+' ('+route.framework+')',ref:route.file});
  chainFiles.slice(0,8).forEach((f)=>{
    const w=[...tables].filter((t)=>t.startsWith('write')&&index.dbAccess.some((h)=>h.file===f&&('write '+h.table)===t));
    steps.push({kind:'service',label:f.split('/').pop(),ref:f});
  });
  if(tables.size) steps.push({kind:'db',label:'Database',detail:[...tables].slice(0,8).join(', ')});
  steps.push({kind:'response',label:'Response',detail:'returned to client'});

  return { kind:'request', route:{method:route.method,path:route.path,file:route.file,framework:route.framework}, chainFiles, tables:[...tables], steps };
}

// ---------------------------------------------------------------------------
// FOLLOW BUSINESS FLOW: expand an inferred flow into its ordered evidence chain
// ---------------------------------------------------------------------------
export function traceFlow(index, flowId){
  const flow=(index.flows||[]).find((f)=>f.id===flowId);
  if(!flow) return null;
  const nodes=[]; const edges=[];
  flow.steps.forEach((s,i)=>{
    const id='s'+i;
    nodes.push({id,type:s.kind,label:s.label,ref:s.ref,writes:s.writes||[]});
    if(i>0) edges.push({source:'s'+(i-1),target:id,type:'next'});
  });
  (flow.tablesWritten||[]).forEach((t)=>{ nodes.push({id:'t:'+t,type:'table',label:t}); });
  return { kind:'flow', flow, graph:{nodes,edges} };
}

function dedupeByFile(arr){
  const seen=new Set(); const out=[];
  for(const x of arr){ const k=x.file+':'+x.line; if(!seen.has(k)){seen.add(k);out.push(x);} }
  return out;
}
