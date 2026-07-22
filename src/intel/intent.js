/**
 * intent.js — Phase 5 Intent Search + Conversational Maps (ADDITIVE, mechanical).
 *
 * Translates a natural-language question ("how are users authenticated?",
 * "where is salary calculated?", "show modules touching Redis") into a GRAPH
 * QUERY over the intel model + knowledge graph, and returns a focused answer:
 *   - the capability/system the question is about (intent classification)
 *   - the concrete evidence (files, routes, tables, functions) that answers it
 *   - a suggested sub-map (node ids) to visualize
 *
 * This is fully offline and deterministic. The AI layer (optional) only narrates
 * the returned evidence; it never chooses the evidence.
 */
import { CAPABILITIES } from './taxonomy.js';

function lc(s){ return String(s||'').toLowerCase(); }
const STOP = new Set(['the','a','an','is','are','of','to','in','and','or','how','does','do','what','where','which','this','that','for','on','with','it','show','me','find','all','only','about','using','used','use','uses','get','happen','happens','work','works','implemented','handled','done']);
function terms(q){ return (lc(q).match(/[a-z_][a-z0-9_]{1,}/g)||[]).filter((t)=>!STOP.has(t)); }

// Map question verbs to a query "operation" so we can bias the evidence returned.
function classifyOp(q){
  const s=lc(q);
  if(/where.*(write|save|store|insert|persist)|written to|writes? to|store data/.test(s)) return 'db-write';
  if(/where.*(read|fetch|load|query)|reads? from/.test(s)) return 'db-read';
  if(/how.*(auth|login|sign)/.test(s)) return 'auth';
  if(/where.*(calcul|comput|generat)/.test(s)) return 'compute';
  if(/how.*(email|notif|sms|sent|send)/.test(s)) return 'notify';
  if(/how.*(cache|caching)/.test(s)) return 'cache';
  if(/external|third.?party|integrat|api call/.test(s)) return 'integration';
  if(/touch|use|using|depend/.test(s)) return 'uses';
  if(/security|secure|vulnerab|permission/.test(s)) return 'security';
  if(/performance|slow|bottleneck|hot path/.test(s)) return 'performance';
  return 'general';
}

export function answerIntent(index, capResult, systemMap, query){
  const t = terms(query);
  const op = classifyOp(query);
  const capById = new Map(capResult.capabilities.map((c)=>[c.id,c]));

  // ---- 1. classify which capability/system the question targets ----
  const scored = capResult.capabilities.map((cap)=>{
    let s=0;
    const hay = lc(cap.label+' '+cap.id+' '+cap.why+' '+(cap.evidence.deps||[]).join(' ')+' '+(cap.evidence.symbols||[]).join(' '));
    for(const tok of t){ if(hay.includes(tok)) s+=2; }
    // taxonomy signals
    const def = CAPABILITIES.find((c)=>c.id===cap.id);
    if(def){ for(const grp of ['name','symbol','route','table','dep']){ for(const n of (def.signals[grp]||[])){ if(t.includes(lc(n))) s+=3; } } }
    return { cap, s };
  }).filter((x)=>x.s>0).sort((a,b)=>b.s-a.s);

  const target = scored.length ? scored[0].cap : null;

  // ---- 2. gather concrete evidence, biased by the operation ----
  const evidence = { files:[], routes:[], tables:[], functions:[], deps:[] };
  const nodeIds = new Set();

  // direct symbol/file search over the whole index (so we answer even when no
  // capability matched, e.g. "where is X()").
  const fnMatches = index.functions.filter((fn)=>{ const n=lc(fn.name); return t.some((tok)=>n.includes(tok)); }).slice(0,20);
  const fileMatches = index.files.filter((f)=>{ const n=lc(f.path); return t.some((tok)=>n.includes(tok)); }).slice(0,20);
  const tableMatches = (index.tables||[]).filter((tb)=>{ const n=lc(tb.name); return t.some((tok)=>n.includes(tok)); }).slice(0,20);
  const routeMatches = (index.routes||[]).filter((r)=>{ const n=lc(r.path); return t.some((tok)=>n.includes(tok)); }).slice(0,20);

  if(target){
    for(const p of target.evidence.files.slice(0,14)){ evidence.files.push(p); nodeIds.add('file:'+p); }
    for(const r of target.evidence.routes.slice(0,12)) evidence.routes.push(r);
    for(const tb of target.evidence.tables.slice(0,12)){ evidence.tables.push(tb); nodeIds.add('table:'+tb); }
    for(const d of target.evidence.deps) evidence.deps.push(d);
    nodeIds.add(target.id);
  }
  // op-specific evidence
  if(op==='db-write'||op==='db-read'){
    const write = op==='db-write';
    for(const h of (index.dbAccess||[])){
      if(!h.table) continue;
      const w=/write|insert|update|delete|create|save|upsert|ddl/i.test(h.kind+' '+(h.op||''));
      if(w===write && (!t.length || t.some((tok)=>lc(h.table).includes(tok)||lc(h.file).includes(tok)))){
        evidence.tables.push(h.table); evidence.files.push(h.file); nodeIds.add('file:'+h.file); nodeIds.add('table:'+h.table);
      }
    }
  }
  if(op==='compute'){
    for(const fn of index.functions){ if(/calc|comput|generat|process|derive|sum|total|aggregate/.test(lc(fn.name)) && (!t.length||t.some((tok)=>lc(fn.name).includes(tok)||lc(fn.file).includes(tok)))){ evidence.functions.push({name:fn.name,file:fn.file,line:fn.line}); nodeIds.add('file:'+fn.file); } }
  }
  // merge generic symbol/file/table/route matches
  fnMatches.forEach((fn)=>{ evidence.functions.push({name:fn.name,file:fn.file,line:fn.line}); nodeIds.add('file:'+fn.file); });
  fileMatches.forEach((f)=>{ evidence.files.push(f.path); nodeIds.add('file:'+f.path); });
  tableMatches.forEach((tb)=>{ evidence.tables.push(tb.name); nodeIds.add('table:'+tb.name); });
  routeMatches.forEach((r)=>evidence.routes.push(r.method+' '+r.path));

  // dedupe
  evidence.files=[...new Set(evidence.files)].slice(0,24);
  evidence.routes=[...new Set(evidence.routes)].slice(0,24);
  evidence.tables=[...new Set(evidence.tables)].slice(0,24);
  evidence.deps=[...new Set(evidence.deps)].slice(0,12);
  const seenFn=new Set(); evidence.functions=evidence.functions.filter((f)=>{const k=f.file+f.name;if(seenFn.has(k))return false;seenFn.add(k);return true;}).slice(0,24);

  const found = evidence.files.length+evidence.routes.length+evidence.tables.length+evidence.functions.length;

  // ---- 3. build a focused answer ----
  let answer;
  if(target && found){
    answer = `This concerns the **${target.label}** system (${target.confidenceLabel}). `+
      (evidence.routes.length?`It exposes ${evidence.routes.length} endpoint(s); `:'')+
      (evidence.tables.length?`it touches tables: ${evidence.tables.slice(0,5).join(', ')}; `:'')+
      `implemented across ${evidence.files.length} file(s).`;
  } else if(found){
    answer = `No single capability owns this, but the analysis found ${found} related item(s) in the repository.`;
  } else {
    answer = 'Unable to determine from repository analysis. No files, routes, tables, or functions matched this question.';
  }

  return {
    query, op,
    target: target ? { id:target.id, label:target.label, kind:target.kind, confidence:target.confidence, why:target.why } : null,
    answer,
    evidence,
    nodeIds:[...nodeIds].slice(0,60),
    related: scored.slice(1,5).map((x)=>({ id:x.cap.id, label:x.cap.label })),
  };
}

// ---- Conversational maps: parse a "show me X" command into a graph filter ----
// Returns node ids (capabilities + their files) to display, plus a title.
export function conversationalMap(index, capResult, systemMap, command){
  const t = terms(command);
  const s = lc(command);
  const capById = new Map(capResult.capabilities.map((c)=>[c.id,c]));

  // layer/tech keyword filters
  const wantLayer = /security|secure/.test(s) ? 'security'
    : /database|data|storage|persist/.test(s) ? 'data'
    : /external|integration|api|third/.test(s) ? 'integration'
    : /performance|bottleneck|slow/.test(s) ? 'performance'
    : /infra|deploy|config|jobs?/.test(s) ? 'infrastructure' : null;

  let picked=[];
  let title='';
  // tech token like "redis", "stripe" -> systems whose deps/files reference it
  const techTok = t.find((tok)=>['redis','stripe','kafka','s3','postgres','mongo','celery','openai','elasticsearch','graphql','docker'].includes(tok));

  if(techTok){
    picked = capResult.capabilities.filter((c)=> (c.evidence.deps||[]).some((d)=>d.includes(techTok)) || c.evidence.files.some((f)=>lc(f).includes(techTok)));
    title = `Systems touching ${techTok}`;
  } else if(wantLayer==='security'){
    picked = capResult.capabilities.filter((c)=>c.id==='auth'||c.id==='security'||c.kind==='business'&&/auth|permission/.test(c.id));
    title='Security-related systems';
  } else if(wantLayer==='data'){
    picked = capResult.capabilities.filter((c)=>c.evidence.tables.length>0 || c.id==='data-access');
    title='Systems that read or write data';
  } else if(wantLayer==='integration'){
    picked = capResult.integration.concat(capResult.capabilities.filter((c)=>c.id==='external-api'));
    title='External integrations';
  } else if(wantLayer==='infrastructure'){
    picked = capResult.infrastructure;
    title='Infrastructure systems';
  } else {
    // match by capability name/keyword
    picked = capResult.capabilities.filter((c)=>{ const hay=lc(c.label+' '+c.id+' '+c.why); return t.some((tok)=>hay.includes(tok)); });
    title = picked.length ? picked.map((c)=>c.label).slice(0,3).join(', ') : 'No matching systems';
  }
  // dedupe
  const seen=new Set(); picked=picked.filter((c)=>{ if(seen.has(c.id))return false; seen.add(c.id); return true; });

  const nodeIds=new Set();
  picked.forEach((c)=>{ nodeIds.add(c.id); c.evidence.files.slice(0,10).forEach((p)=>nodeIds.add('file:'+p)); c.evidence.tables.forEach((tb)=>nodeIds.add('table:'+tb)); });
  // include edges among picked systems
  const pickedIds=new Set(picked.map((c)=>c.id));
  const edges = systemMap.edges.filter((e)=>pickedIds.has(e.source)&&pickedIds.has(e.target));

  return {
    command, title,
    systems: picked.map((c)=>({ id:c.id, label:c.label, kind:c.kind, confidence:c.confidence, files:c.evidence.fileCount, tables:c.evidence.tables.slice(0,6) })),
    edges,
    nodeIds:[...nodeIds].slice(0,80),
    empty: picked.length===0,
  };
}
