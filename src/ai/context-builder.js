/**
 * context-builder.js — Phase 2 graph-aware context assembly (ADDITIVE).
 *
 * Extends the Phase 1 lexical retrieval (grounding.js) with knowledge-graph
 * neighbor expansion so the AI receives a compact, connected subgraph rather than
 * a flat list. Pipeline:
 *   question -> lexical seed match -> expand neighbors (imports/calls/reads/
 *   writes) -> rank -> collect files/apis/tables/functions -> compact prompt.
 * The AI NEVER sees the whole repo; only this structured context. Reuses
 * grounding.retrieve for the seed set so behavior is consistent.
 */
import { retrieve, buildRepoOverview } from './grounding.js';

function adjacency(index){
  const byPath = new Map(index.files.map((f)=>[f.path,f]));
  const fnById = new Map(index.functions.map((f)=>[f.id,f]));
  return { byPath, fnById };
}

// Expand a seed set of evidence items into their immediate graph neighbors.
function expandNeighbors(index, seeds, budget=10){
  const { byPath, fnById } = adjacency(index);
  const extra = [];
  const seen = new Set(seeds.map((s)=>s.ref));
  for(const s of seeds.slice(0,6)){
    if(s.type==='function'){
      const fn = s.obj;
      // callers + callees
      for(const cid of (fn.resolvedCalls||[]).slice(0,3)){
        const c = fnById.get(cid); if(c && !seen.has(c.file+':'+c.line)){ seen.add(c.file+':'+c.line); extra.push(neighborItem('function',c,'calls '+s.title)); }
      }
      for(const cid of (fn.calledBy||[]).slice(0,3)){
        const c = fnById.get(cid); if(c && !seen.has(c.file+':'+c.line)){ seen.add(c.file+':'+c.line); extra.push(neighborItem('function',c,'called by '+s.title)); }
      }
    } else if(s.type==='file'){
      const f = s.obj;
      for(const imp of (f.imports||[]).filter((i)=>i.resolved).slice(0,4)){
        const t = byPath.get(imp.resolved); if(t && !seen.has(t.path)){ seen.add(t.path); extra.push({type:'file',score:1,ref:t.path,title:t.path.split('/').pop(),obj:t,relation:s.title+' imports'}); }
      }
      for(const p of (f.importedBy||[]).slice(0,3)){
        const t = byPath.get(p); if(t && !seen.has(t.path)){ seen.add(t.path); extra.push({type:'file',score:1,ref:t.path,title:t.path.split('/').pop(),obj:t,relation:'imports '+s.title}); }
      }
    } else if(s.type==='table'){
      // include files that read/write this table
      const t = s.obj;
      for(const p of (t.writtenBy||[]).slice(0,3)){ const f=byPath.get(p); if(f&&!seen.has(p)){seen.add(p);extra.push({type:'file',score:1,ref:p,title:p.split('/').pop(),obj:f,relation:'writes '+t.name});} }
    }
    if(extra.length>=budget) break;
  }
  return extra.slice(0,budget);
}
function neighborItem(type,obj,relation){ return {type,score:1,ref:obj.file+':'+obj.line,title:obj.name,obj,relation}; }

// Build the compact grounded context (string) + evidence list for citations.
export function buildGraphContext(index, question, opts={}){
  const seeds = retrieve(index, question, opts.seedLimit||12);
  const neighbors = expandNeighbors(index, seeds, opts.neighborLimit||10);
  const all = [...seeds, ...neighbors];

  const lines = [];
  lines.push('=== REPOSITORY OVERVIEW ===');
  lines.push(buildRepoOverview(index));
  // add semantic hints if present
  if(index.semantic){
    const doms = index.semantic.domains.slice(0,8).map((d)=>`${d.label} (${d.fileCount} files${d.routes?`, ${d.routes} routes`:''})`).join('; ');
    lines.push('Detected modules/domains: '+doms);
    lines.push('Health: overall '+index.semantic.health.overall+'/100 ('+index.semantic.health.scores.map((s)=>s.label+' '+s.value).join(', ')+')');
  }
  lines.push('');
  lines.push('=== RELEVANT EVIDENCE (static analysis; connected subgraph) ===');
  if(!all.length) lines.push('(no directly matching symbols found)');
  for(const e of all){
    lines.push(evidenceLine(e));
  }
  return { context: lines.join('\n'), evidence: all.map((e)=>({type:e.type,title:e.title,ref:e.ref,relation:e.relation})) };
}

function evidenceLine(e){
  if(e.type==='function'){
    const fn=e.obj;
    return `FUNCTION ${fn.name}() at ${fn.file}:${fn.line} — complexity ${fn.complexity}, ${fn.loc} LOC`+
      (e.relation?` [${e.relation}]`:'')+
      (fn.doc?`\n  doc: ${fn.doc}`:'')+
      (fn.calls&&fn.calls.length?`\n  calls: ${fn.calls.slice(0,8).join(', ')}`:'')+
      (fn.calledBy&&fn.calledBy.length?`\n  called by ${fn.calledBy.length} fn(s)`:'');
  }
  if(e.type==='file'){
    const f=e.obj; const fns=(f.functions||[]).slice(0,8).map((x)=>x.name).join(', ');
    return `FILE ${f.path} — ${f.lang||''}, ${f.loc} LOC`+(e.relation?` [${e.relation}]`:'')+(f.doc?`\n  purpose: ${f.doc}`:'')+(fns?`\n  functions: ${fns}`:'')+((f.importedBy&&f.importedBy.length)?`\n  imported by ${f.importedBy.length} file(s)`:'');
  }
  if(e.type==='route') return `API ${e.obj.method} ${e.obj.path} — in ${e.obj.file} (${e.obj.framework})`;
  if(e.type==='table'){ const t=e.obj; return `DB TABLE ${t.name} — read by ${t.readBy.length}, written by ${t.writtenBy.length}`+(t.definedIn?`, defined in ${t.definedIn}`:''); }
  if(e.type==='class') return `CLASS/TYPE ${e.obj.name} (${e.obj.kind}) at ${e.obj.file}:${e.obj.line}`+(e.obj.doc?`\n  doc: ${e.obj.doc}`:'');
  if(e.type==='flow') return `FLOW ${e.obj.name} — ${e.obj.trigger}; steps: ${e.obj.steps.map((s)=>s.label).join(' -> ')}`;
  return '';
}

export const CHAT_SYSTEM = `You are a senior engineer helping a developer understand an unfamiliar codebase.
You receive a REPOSITORY OVERVIEW and a connected EVIDENCE subgraph produced by static analysis of the real source.
Rules:
- Answer ONLY from the provided evidence/overview. NEVER invent files, functions, routes, or tables.
- Cite concrete references as path/to/file.ext:line for every claim.
- If evidence is insufficient, reply exactly: "Unable to determine from repository analysis." and say what to inspect.
- End with a "Confidence: high|medium|low" line reflecting how directly the evidence supports your answer.
- Be concise and structured (short paragraphs + bullets).`;

export function buildChatMessages(index, question, history=[]){
  const { context, evidence } = buildGraphContext(index, question);
  const messages = [
    { role:'system', content: CHAT_SYSTEM },
    { role:'system', content: context },
  ];
  for(const h of (history||[]).slice(-6)) messages.push({ role:h.role, content:h.content });
  messages.push({ role:'user', content: question });
  return { messages, evidence };
}
