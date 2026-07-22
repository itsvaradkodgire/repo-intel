/**
 * generators.js — prompt builders for AI-generated pages (ADDITIVE).
 *
 * Each generator assembles a grounded prompt from the static-analysis index +
 * mechanical semantic layer, then the server streams the model's completion. The
 * model only ever explains facts already computed; it cannot invent structure.
 * Every generator instructs the model to cite file references and to admit gaps.
 */
import { buildRepoOverview } from './grounding.js';
import { buildGraphContext } from './context-builder.js';

const GROUND_RULE = `Ground every statement in the provided analysis. Cite files as path:line. If something is not in the data, say "Unable to determine from repository analysis." Do not invent files, functions, routes, or tables.`;

// compact structured facts block reused by generators
function facts(index){
  const c = index.manifest.counts;
  const s = index.semantic;
  const lines = [buildRepoOverview(index)];
  if(s){
    lines.push('');
    lines.push('MODULES/DOMAINS:');
    for(const d of s.domains.slice(0,14)) lines.push(`- ${d.label} [${d.kind}]: ${d.fileCount} files, ${d.loc} LOC${d.routes?`, ${d.routes} routes`:''}${d.tables.length?`, tables: ${d.tables.slice(0,6).join(', ')}`:''} (dir: ${d.dir})`);
    lines.push('');
    lines.push('SUBSYSTEMS (layers): '+s.subsystems.map((x)=>`${x.layer}(${x.files})`).join(', '));
    lines.push('CRITICAL MODULES (by graph centrality): '+s.criticalModules.slice(0,10).map((m)=>`${m.path} (fan-in ${m.fanIn})`).join('; '));
    lines.push('RISK AREAS: '+s.riskAreas.slice(0,8).map((r)=>`${r.path} (${r.reasons.join('; ')})`).join(' | '));
    lines.push('HEALTH: overall '+s.health.overall+'/100; '+s.health.scores.map((x)=>x.label+' '+x.value).join(', '));
  }
  // top routes + tables
  if(index.routes.length) lines.push('SAMPLE ROUTES: '+index.routes.slice(0,15).map((r)=>r.method+' '+r.path).join(', '));
  if(index.tables.length) lines.push('DB TABLES: '+index.tables.slice(0,20).map((t)=>t.name).join(', '));
  const jobs = (index.jobs||[]);
  if(jobs.length) lines.push('BACKGROUND JOBS: '+[...new Set(jobs.map((j)=>j.kind))].join(', '));
  return lines.join('\n');
}

// ---- Repository Overview (multi-section) ----
export function overviewMessages(index){
  return [
    { role:'system', content: `You are a principal engineer writing an onboarding brief for a codebase you analyzed statically. ${GROUND_RULE}` },
    { role:'system', content: facts(index) },
    { role:'user', content:
`Write a Repository Overview with these markdown sections (use ## headers):
## In Plain English
## Architecture Summary
## Business Domains
## Technology Stack
## Request Lifecycle
## Data Flow
## Database Summary
## Extension Points
## Risk Analysis

Be specific and cite files. Keep each section tight (a short paragraph or bullets). If a section has no evidence, write "Unable to determine from repository analysis."` },
  ];
}

// ---- Learn Repository: explain one learning-path step ----
export function mentorStepMessages(index, step){
  const domain = index.semantic?.domains.find((d)=>d.id===step.id);
  const files = domain ? domain.files.slice(0,15) : [];
  const fileDocs = files.map((p)=>{ const f=index.files.find((x)=>x.path===p); return f ? `- ${p}${f.doc?`: ${f.doc}`:''} (${(f.functions||[]).slice(0,6).map((fn)=>fn.name).join(', ')})` : `- ${p}`; }).join('\n');
  return [
    { role:'system', content: `You are a mentor onboarding a new developer to one module of a codebase. ${GROUND_RULE}` },
    { role:'system', content: facts(index) + `\n\nMODULE "${step.label}" (dir: ${step.dir}) FILES:\n${fileDocs}` },
    { role:'user', content: `Teach me the "${step.label}" module as if I just joined the team. Cover: what it does, its key files/functions, how it connects to the rest of the system, and one thing to watch out for. Cite files. Keep it under ~250 words.` },
  ];
}

// ---- Explain (page-level, multiple modes) ----
const MODE_INSTRUCTIONS = {
  beginner: 'Explain for a junior developer new to this codebase. Avoid jargon; define terms. Focus on the big picture and what things do.',
  senior: 'Explain for an experienced engineer. Be dense and precise. Focus on design decisions, contracts, and edge cases.',
  architecture: 'Explain from an architecture perspective: layering, boundaries, coupling, data flow, and how responsibilities are separated.',
  performance: 'Explain from a performance perspective: hot paths, complexity, repeated/N+1 database access, large modules, and potential bottlenecks visible in the analysis.',
  security: 'Explain from a security perspective: authentication/authorization touchpoints, input validation, data exposure, and any risky patterns flagged in the analysis.',
};

export function explainMessages(index, subject, mode='beginner'){
  const instr = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.beginner;
  const { context } = buildGraphContext(index, subject.query || subject.title || '');
  return [
    { role:'system', content: `You explain parts of a codebase. ${instr} ${GROUND_RULE}` },
    { role:'system', content: context + '\n\nSUBJECT: ' + describeSubject(subject) },
    { role:'user', content: `Explain "${subject.title}" (${subject.kind}). ${instr} Cite files as path:line. End with "Confidence: high|medium|low".` },
  ];
}

function describeSubject(s){
  if(s.kind==='file') return `FILE ${s.title}`;
  if(s.kind==='function') return `FUNCTION ${s.title}`;
  if(s.kind==='table') return `DB TABLE ${s.title}`;
  if(s.kind==='route') return `API ROUTE ${s.title}`;
  if(s.kind==='domain') return `MODULE ${s.title}`;
  return s.title||'';
}

// ---- Commit Intelligence: explain a structural diff ----
export function commitMessages(index, diff, base, head){
  const summary = {
    base, head, risk: diff.riskLabel,
    routesAdded: diff.routes.added, routesRemoved: diff.routes.removed,
    filesAdded: diff.files.added.length, filesRemoved: diff.files.removed.length, filesChanged: diff.files.changed.length,
    fnsAdded: diff.functions.added.length, fnsRemoved: diff.functions.removed.length,
    tablesAdded: diff.tables.added, tablesRemoved: diff.tables.removed,
    depsAdded: diff.dependencies.added, depsRemoved: diff.dependencies.removed, depsChanged: diff.dependencies.changed,
    deltas: diff.deltas,
  };
  return [
    { role:'system', content: `You are a staff engineer reviewing a diff between two versions of a repository, using a STRUCTURED diff from static analysis (not raw patches). ${GROUND_RULE}` },
    { role:'system', content: 'STRUCTURED DIFF ('+base+' -> '+head+'):\n'+JSON.stringify(summary, null, 1) },
    { role:'user', content:
`Summarize this change set with markdown sections:
## What changed
## Why it matters
## Risk & breaking changes
## Architecture impact
## Business impact
Base your reasoning only on the diff. Removed routes/tables and removed public functions are the highest-risk signals. Be concise.` },
  ];
}

// ---- Phase 3: Semantic graph narration + node reasoning ----
const GRAPH_MODES = {
  beginner: 'Explain for someone new to the codebase; avoid jargon.',
  intermediate: 'Explain for a mid-level engineer.',
  senior: 'Explain for a senior engineer; be dense and precise about design.',
  architecture: 'Explain from an architecture standpoint: layers, boundaries, data flow, coupling.',
  security: 'Explain from a security standpoint: trust boundaries, auth, validation, exposure.',
  performance: 'Explain from a performance standpoint: hot paths, coupling, data access.',
};

function graphContext(index, visibleIds){
  const sg = index.semanticGraph;
  if(!sg) return 'No semantic graph available.';
  const nm = new Map(sg.nodes.map((n)=>[n.id,n]));
  const lines = [];
  lines.push('SEMANTIC GRAPH (current view):');
  for(const id of (visibleIds||[]).slice(0,60)){
    const n = nm.get(id); if(!n) continue;
    lines.push(`- ${n.kind.toUpperCase()} "${n.label}"`+(n.files!=null?` (${n.files} files`:'')+(n.routes?`, ${n.routes} routes`:'')+((n.tables&&n.tables.length)?`, tables: ${n.tables.slice(0,5).join(', ')}`:'')+(n.files!=null?')':'')+(n.layers?` [layers: ${n.layers.join(', ')}]`:''));
  }
  // edges among visible
  const vis = new Set(visibleIds||[]);
  const nearest = (x)=>{ let cur=nm.get(x); while(cur){ if(vis.has(cur.id))return cur.id; cur=cur.parent?nm.get(cur.parent):null; } return null; };
  const agg = new Map();
  for(const e of sg.edges){ const s=nearest(e.source), t=nearest(e.target); if(!s||!t||s===t)continue; const k=s+'|'+e.verb+'|'+t; agg.set(k,(agg.get(k)||0)+(e.count||1)); }
  lines.push('RELATIONSHIPS:');
  [...agg.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40).forEach(([k,c])=>{ const [s,v,t]=k.split('|'); const sn=nm.get(s),tn=nm.get(t); lines.push(`- ${sn?sn.label:s} ${v} ${tn?tn.label:t} (x${c})`); });
  return lines.join('\n');
}

export function graphStoryMessages(index, visibleIds, mode='beginner', layer='all', intent=null){
  const instr = GRAPH_MODES[mode] || GRAPH_MODES.beginner;
  return [
    { role:'system', content: `You narrate an interactive software knowledge graph to a developer. ${instr} ${GROUND_RULE} Every sentence must correspond to a real node/edge in the provided graph; reference node labels explicitly.` },
    { role:'system', content: graphContext(index, visibleIds) + (layer!=='all'?`\n(Current layer filter: ${layer})`:'') + (intent?`\n(Current intent view: ${intent})`:'') },
    { role:'user', content: `Give a short guided tour of this graph view (${mode} mode). Explain what the main modules are, how data/requests flow between them, and which parts are most important. Reference node labels. 5-9 sentences. End with "Confidence: high|medium|low".` },
  ];
}

export function graphNodeMessages(index, nodeId, nodeKind, label, path){
  // gather local evidence for the node
  const sg = index.semanticGraph;
  const nm = sg ? new Map(sg.nodes.map((n)=>[n.id,n])) : new Map();
  const n = nm.get(nodeId);
  let ev = `NODE: ${nodeKind} "${label}"`;
  if(n){
    const chain=[]; let cur=n; while(cur){chain.unshift(cur.label);cur=cur.parent?nm.get(cur.parent):null;}
    ev += `\nPath in graph: ${chain.join(' > ')}`;
    if(n.files!=null) ev+=`\nFiles: ${n.files}, LOC: ${n.loc||'?'}`;
    if(n.tables&&n.tables.length) ev+=`\nTables: ${n.tables.join(', ')}`;
    if(n.layers) ev+=`\nLayers: ${n.layers.join(', ')}`;
    if(n.metric) ev+=`\nFan-in: ${n.metric.fanIn}, fan-out: ${n.metric.fanOut}, complexity: ${n.metric.complexity}, criticality: ${Math.round((n.metric.h_criticality||0)*100)}%`;
    // incoming/outgoing semantic edges
    const outs=sg.edges.filter((e)=>e.source===nodeId).slice(0,8).map((e)=>`${e.verb} ${nm.get(e.target)?nm.get(e.target).label:e.target}`);
    const ins=sg.edges.filter((e)=>e.target===nodeId).slice(0,8).map((e)=>`${nm.get(e.source)?nm.get(e.source).label:e.source} ${e.verb} it`);
    if(outs.length) ev+=`\nOutgoing: ${outs.join('; ')}`;
    if(ins.length) ev+=`\nIncoming: ${ins.join('; ')}`;
  }
  if(path){
    const f = index.files.find((x)=>x.path===path);
    if(f){ ev+=`\nFile purpose: ${f.doc||'(no header doc)'}`; ev+=`\nFunctions: ${(f.functions||[]).slice(0,10).map((x)=>x.name).join(', ')}`; }
  }
  return [
    { role:'system', content: `You explain one node of a repository knowledge graph. ${GROUND_RULE} Cover: purpose, responsibilities, business meaning, technical meaning, criticality, and what depends on it.` },
    { role:'system', content: ev },
    { role:'user', content: `Explain "${label}". Structure: Purpose, Responsibilities (bullets), Why it's connected here, Criticality. Reference concrete evidence. Under 180 words. End with "Confidence: high|medium|low".` },
  ];
}
