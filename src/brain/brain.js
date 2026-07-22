/**
 * brain.js — the Repository Brain (ADDITIVE, Phase 4).
 *
 * The central, persistent intelligence layer. It OWNS a repository's derived
 * knowledge and is the single source of truth every feature queries. Backward
 * compatible: it wraps the existing analysis index (never replaces it) and adds
 * embeddings, insights, timeline, AI memory, plugin contributions, change
 * history, and incremental update. Persisted to disk so it survives restarts and
 * is only recomputed for affected parts.
 *
 * Layout:  <cache>/brain/<id>/
 *    index.json         (the analysis index — reused from Phase 1-3)
 *    hashes.json        (path -> content hash, for incremental diff)
 *    embeddings.json    (offline embedding index)
 *    insights.json      (ranked insight lists)
 *    timeline.json      (sampled commit evolution)
 *    plugins.json       (merged plugin contributions)
 *    memory/*.txt       (AI summaries/explanations, from Phase 3 too)
 *    history.jsonl      (append-only change log)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildEmbeddingIndex, semanticSearch, similarTo } from './embeddings.js';
import { computeInsights } from './insights.js';
import { buildTimeline } from './timeline.js';
import { runPlugins, listPlugins } from './plugins.js';
import { snapshotHashes, diffSnapshots, reparse, hashesFromSnapshot } from './incremental.js';

const CACHE_ROOT = process.env.REPO_INTEL_CACHE || path.join(os.homedir(), '.repo-intel-cache');
const BRAIN_ROOT = path.join(CACHE_ROOT, 'brain');

function brainDir(id){ if(!id || typeof id !== 'string') return null; return path.join(BRAIN_ROOT, id); }
function readJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function writeJson(p, obj){ try { fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p, JSON.stringify(obj)); } catch {} }

// In-process cache of loaded brains (id -> brain object).
const LOADED = new Map();

/**
 * Initialize (or load) the Brain for an analyzed index. Called right after
 * analysis. Builds embeddings/insights/plugins if missing, persists them, and
 * records the initial change-history entry. Idempotent + incremental.
 */
export async function initBrain(id, index, dir){
  const dbase = brainDir(id);
  fs.mkdirSync(dbase, { recursive: true });
  // persist index (already done by server, but keep brain self-contained)
  writeJson(path.join(dbase,'index.json'), index);

  // embeddings
  let embeddings = readJson(path.join(dbase,'embeddings.json'));
  if(!embeddings){ embeddings = buildEmbeddingIndex(index); writeJson(path.join(dbase,'embeddings.json'), embeddings); }

  // plugins (merged contributions)
  let plugins = readJson(path.join(dbase,'plugins.json'));
  if(!plugins){ plugins = runPlugins(index); writeJson(path.join(dbase,'plugins.json'), plugins); }

  // insights (needs git dir; may be empty without git)
  let insights = readJson(path.join(dbase,'insights.json'));
  if(!insights){ insights = await computeInsights(index, dir); writeJson(path.join(dbase,'insights.json'), insights); }

  // hashes snapshot for incremental
  if(dir && !fs.existsSync(path.join(dbase,'hashes.json'))){
    try { const snap = snapshotHashes(dir); writeJson(path.join(dbase,'hashes.json'), hashesFromSnapshot(snap)); } catch {}
  }

  // change history: record init once
  const histPath = path.join(dbase,'history.jsonl');
  if(!fs.existsSync(histPath)){
    appendHistory(id, { at:new Date().toISOString(), event:'init', files:index.manifest.counts.files, functions:index.manifest.counts.functions });
  }

  const brain = { id, dir, index, embeddings, plugins, insights,
    stats:{ files:index.manifest.counts.files, functions:index.manifest.counts.functions, embeddingItems:embeddings.items.length, plugins:plugins.ran.length } };
  LOADED.set(id, brain);
  return brainSummary(brain);
}

export function loadBrain(id){
  if(LOADED.has(id)) return LOADED.get(id);
  const dbase = brainDir(id);
  if(!dbase) return null;
  const index = readJson(path.join(dbase,'index.json'));
  if(!index) return null;
  const brain = {
    id, dir:index.source && index.source.brainDir || null, index,
    embeddings: readJson(path.join(dbase,'embeddings.json')),
    plugins: readJson(path.join(dbase,'plugins.json')),
    insights: readJson(path.join(dbase,'insights.json')),
  };
  LOADED.set(id, brain);
  return brain;
}

export function brainSummary(brain){
  const idx = brain.index;
  return {
    id: brain.id,
    repo: (idx.source && idx.source.input) || idx.manifest.root,
    git: idx.source && idx.source.git,
    counts: idx.manifest.counts,
    stored: {
      knowledgeGraph: idx.graph ? idx.graph.stats : null,
      semanticGraph: idx.semanticGraph ? idx.semanticGraph.stats : null,
      domains: idx.semantic ? idx.semantic.domains.length : 0,
      embeddings: brain.embeddings ? brain.embeddings.items.length : 0,
      plugins: brain.plugins ? brain.plugins.ran : [],
      pluginNodes: brain.plugins ? brain.plugins.nodes.length : 0,
      insights: brain.insights ? Object.keys(brain.insights).filter((k)=>Array.isArray(brain.insights[k])).length : 0,
      memory: memoryCount(brain.id),
      history: historyCount(brain.id),
    },
    available: listPlugins(),
    generatedAt: idx.manifest.generatedAt,
  };
}

// ---- semantic search (Brain-first) ----
// Returns lexical + embedding hybrid results directly from the Brain. Only if
// the caller wants an AI narrative do they call the AI layer separately.
export function brainSearch(id, query, opts={}){
  const brain = loadBrain(id);
  if(!brain) return { error:'brain not found' };
  const emb = brain.embeddings ? semanticSearch(brain.embeddings, query, { limit: opts.limit||24 }) : [];
  // lexical exact-ish matches from the index for precision
  const q = query.toLowerCase();
  const lex = [];
  const seen = new Set(emb.map((e)=>e.id));
  brain.index.files.forEach((f)=>{ if(f.path.toLowerCase().includes(q)&&!seen.has('file:'+f.path)) lex.push({id:'file:'+f.path,type:'file',label:f.path.split('/').pop(),ref:f.path,score:0.5}); });
  brain.index.routes.forEach((r)=>{ if((r.path+' '+r.method).toLowerCase().includes(q)&&!seen.has('route:'+r.method+' '+r.path)) lex.push({id:'route:'+r.method+' '+r.path,type:'route',label:r.method+' '+r.path,ref:r.file,score:0.5}); });
  brain.index.tables.forEach((t)=>{ if(t.name.toLowerCase().includes(q)&&!seen.has('table:'+t.name)) lex.push({id:'table:'+t.name,type:'table',label:t.name,ref:t.definedIn||'',score:0.5}); });
  const results = emb.concat(lex).slice(0, opts.limit||24);
  return { query, results, source:'repository-brain' };
}

export function brainSimilar(id, nodeId, limit=10){
  const brain = loadBrain(id);
  if(!brain || !brain.embeddings) return { error:'brain not found' };
  return { id:nodeId, similar: similarTo(brain.embeddings, nodeId, limit) };
}

// ---- insights / timeline (persisted, recomputed only when stale) ----
export function getInsights(id){
  const brain = loadBrain(id);
  if(!brain) return null;
  return brain.insights || readJson(path.join(brainDir(id),'insights.json'));
}
export async function getTimeline(id, dir){
  const dbase = brainDir(id);
  let tl = readJson(path.join(dbase,'timeline.json'));
  if(!tl && dir){ tl = await buildTimeline(dir); writeJson(path.join(dbase,'timeline.json'), tl); }
  return tl || { available:false, points:[] };
}

// ---- incremental reindex ----
export async function reindex(id, dir){
  const brain = loadBrain(id);
  if(!brain) return { error:'brain not found' };
  const dbase = brainDir(id);
  const prevHashes = readJson(path.join(dbase,'hashes.json')) || {};
  let snap; try { snap = snapshotHashes(dir); } catch(e){ return { error:'cannot read repo dir: '+e.message }; }
  const diff = diffSnapshots(prevHashes, snap);
  const changed = diff.added.concat(diff.modified);
  if(!changed.length && !diff.deleted.length){
    return { changed:0, added:0, modified:0, deleted:0, note:'no changes detected', unchanged:diff.unchanged };
  }
  // re-parse only changed code files
  const fresh = await reparse(dir, changed, snap);
  const freshByPath = new Map(fresh.map((r)=>[r.path,r]));
  // patch the index file records in place (affected only)
  const idx = brain.index;
  const byPath = new Map(idx.files.map((f)=>[f.path,f]));
  for(const p of diff.deleted){ byPath.delete(p); }
  for(const [p,rec] of freshByPath){ byPath.set(p, Object.assign(byPath.get(p)||{}, rec)); }
  idx.files = [...byPath.values()];
  // recompute embeddings for affected items only (cheap: rebuild whole small index)
  brain.embeddings = buildEmbeddingIndex(idx);
  writeJson(path.join(dbase,'embeddings.json'), brain.embeddings);
  writeJson(path.join(dbase,'hashes.json'), hashesFromSnapshot(snap));
  writeJson(path.join(dbase,'index.json'), idx);
  // invalidate stale derived caches (insights/timeline) so they recompute lazily
  try { fs.unlinkSync(path.join(dbase,'insights.json')); } catch {}
  brain.insights = await computeInsights(idx, dir);
  writeJson(path.join(dbase,'insights.json'), brain.insights);
  appendHistory(id, { at:new Date().toISOString(), event:'reindex', added:diff.added.length, modified:diff.modified.length, deleted:diff.deleted.length });
  LOADED.set(id, brain);
  return { changed:changed.length, added:diff.added.length, modified:diff.modified.length, deleted:diff.deleted.length, unchanged:diff.unchanged, reparsed:fresh.length };
}

// ---- change history ----
export function appendHistory(id, entry){
  try { fs.mkdirSync(brainDir(id),{recursive:true}); fs.appendFileSync(path.join(brainDir(id),'history.jsonl'), JSON.stringify(entry)+'\n'); } catch {}
}
export function getHistory(id){
  try { return fs.readFileSync(path.join(brainDir(id),'history.jsonl'),'utf8').split('\n').filter(Boolean).map((l)=>JSON.parse(l)); } catch { return []; }
}
function historyCount(id){ try { return fs.readFileSync(path.join(brainDir(id),'history.jsonl'),'utf8').split('\n').filter(Boolean).length; } catch { return 0; } }

// ---- AI memory (unified with Phase 3 brain cache) ----
function memDir(id){ return path.join(brainDir(id),'memory'); }
function memCountDir(dir){ try { return fs.readdirSync(dir).length; } catch { return 0; } }
function memoryCount(id){ return memCountDir(memDir(id)) + memCountDir(brainDir(id)); }
export function memoryList(id){
  const out=[];
  try {
    for(const f of fs.readdirSync(brainDir(id))){
      if(f.endsWith('.txt')){ out.push({ key:f.replace('.txt',''), bytes: fs.statSync(path.join(brainDir(id),f)).size }); }
    }
  } catch {}
  return out;
}
export function clearMemory(id){
  let n=0;
  try { for(const f of fs.readdirSync(brainDir(id))){ if(f.endsWith('.txt')){ fs.unlinkSync(path.join(brainDir(id),f)); n++; } } } catch {}
  appendHistory(id, { at:new Date().toISOString(), event:'clear-memory', cleared:n });
  return { cleared:n };
}

export function getPlugins(id){ const b=loadBrain(id); return b?b.plugins:null; }
