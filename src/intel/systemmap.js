/**
 * systemmap.js — Phase 5 System Map + Why-Graph (ADDITIVE, mechanical).
 *
 * Turns discovered capabilities into a SYSTEM MAP: a graph whose nodes are the
 * systems a product is built from (Authentication, Payroll, Search, ...) rather
 * than files/folders. Edges between systems are inferred from REAL relationships
 * in the knowledge graph (imports, function calls, shared data tables) and every
 * edge carries a business-level WHY, not just "imports X".
 *
 * Also produces the WHY-GRAPH reasons: for each system->system edge we explain
 * why the dependency exists in domain terms (e.g. "Payroll reads Attendance
 * because salary depends on worked hours"), grounded in the shared evidence.
 *
 * Nothing is invented: an edge only exists if members of the two systems are
 * actually connected in the analysis, and its strength is the real edge count.
 */

function lc(s){ return String(s||'').toLowerCase(); }

// Templated domain reasons for common capability pairs. Only used to phrase an
// edge that ALREADY exists mechanically; if no template matches we fall back to
// a factual description of the concrete relationship.
const WHY_TEMPLATES = [
  { from:'payroll', to:'attendance', why:'Payroll needs worked hours and time logs to compute salary.' },
  { from:'payroll', to:'leave', why:'Payroll applies leave and absence data as salary deductions.' },
  { from:'payroll', to:'employee', why:'Payroll runs per employee and reads their compensation details.' },
  { from:'attendance', to:'employee', why:'Attendance records are keyed to individual employees.' },
  { from:'leave', to:'employee', why:'Leave requests belong to employees and affect their balances.' },
  { from:'matching', to:'resume', why:'Matching consumes structured candidate data extracted from resumes.' },
  { from:'matching', to:'ai-features', why:'Matching uses model scoring to rank candidates or items.' },
  { from:'resume', to:'storage', why:'Resume processing reads uploaded files from storage.' },
  { from:'resume', to:'ai-features', why:'Resume parsing relies on models to extract structured fields.' },
  { from:'notifications', to:'email-sms', why:'Notifications are delivered through the email/SMS provider.' },
  { from:'notifications', to:'jobs', why:'Notifications are sent asynchronously via background jobs.' },
  { from:'analytics', to:'logging', why:'Analytics aggregates recorded events and audit logs.' },
  { from:'search', to:'ai-features', why:'Search ranking may use embeddings or model relevance scoring.' },
  { from:'payments', to:'notifications', why:'Payment events trigger receipts and status notifications.' },
  { from:'user-mgmt', to:'auth', why:'User management depends on authentication to identify accounts.' },
  { from:'admin', to:'auth', why:'Administration is gated behind authenticated, privileged access.' },
];

function template(fromId, toId){
  const t = WHY_TEMPLATES.find((x)=>x.from===fromId && x.to===toId);
  return t ? t.why : null;
}

// Phrase a factual reason for an edge from its concrete relationship types.
function factualWhy(fromLabel, toLabel, rel){
  if(rel.writes && rel.reads) return `${fromLabel} reads and writes data shared with ${toLabel}.`;
  if(rel.writes) return `${fromLabel} writes data that ${toLabel} depends on.`;
  if(rel.reads) return `${fromLabel} reads data owned by ${toLabel}.`;
  if(rel.calls) return `${fromLabel} invokes functionality implemented in ${toLabel}.`;
  if(rel.imports) return `${fromLabel} builds on modules provided by ${toLabel}.`;
  return `${fromLabel} is connected to ${toLabel}.`;
}

export function buildSystemMap(index, capResult){
  const caps = capResult.capabilities;
  const fileByPath = new Map(index.files.map((f)=>[f.path,f]));

  // Assign each file to its highest-confidence OWNING capability (business first,
  // then integration/infra/cross-cutting, then technical) so systems are distinct.
  const KIND_RANK = { business:0, integration:1, infrastructure:2, 'cross-cutting':3, technical:4 };
  const ownerOfFile = new Map(); // path -> capId
  const ownerRank = new Map();
  const ranked = caps.slice().sort((a,b)=> (KIND_RANK[a.kind]-KIND_RANK[b.kind]) || (b.confidence-a.confidence));
  for(const cap of ranked){
    for(const p of cap.evidence.files){
      const r = KIND_RANK[cap.kind] - cap.confidence; // lower is stronger owner
      if(!ownerOfFile.has(p) || r < ownerRank.get(p)){ ownerOfFile.set(p, cap.id); ownerRank.set(p, r); }
    }
  }
  const capById = new Map(caps.map((c)=>[c.id,c]));

  // ---- system nodes ----
  const nodes = caps.map((c)=>({
    id:c.id, label:c.label, kind:c.kind, why:c.why, users:c.users,
    confidence:c.confidence, confidenceLabel:c.confidenceLabel,
    files:c.evidence.fileCount, routes:c.evidence.routes.length, tables:c.evidence.tables.slice(0,8),
    loc:c.loc,
  }));

  // ---- edges from real relationships between owning capabilities ----
  const edgeMap = new Map(); // "a->b" -> {imports,calls,reads,writes,count,samples}
  const bump=(from,to,type,sample)=>{
    if(!from||!to||from===to) return;
    const k=from+'->'+to;
    if(!edgeMap.has(k)) edgeMap.set(k,{imports:0,calls:0,reads:0,writes:0,count:0,samples:[]});
    const e=edgeMap.get(k); e[type]=(e[type]||0)+1; e.count++; if(e.samples.length<6)e.samples.push(sample);
  };

  // import edges
  for(const f of index.files){
    const from=ownerOfFile.get(f.path); if(!from) continue;
    for(const imp of (f.imports||[])){
      if(imp.resolved && ownerOfFile.has(imp.resolved)){
        bump(from, ownerOfFile.get(imp.resolved), 'imports', f.path.split('/').pop()+' → '+imp.resolved.split('/').pop());
      }
    }
  }
  // call edges (function call graph)
  const fnById=new Map(index.functions.map((f)=>[f.id,f]));
  for(const fn of index.functions){
    const from=ownerOfFile.get(fn.file); if(!from) continue;
    for(const cid of (fn.resolvedCalls||[])){
      const c=fnById.get(cid); if(!c) continue;
      bump(from, ownerOfFile.get(c.file), 'calls', fn.name+'() → '+c.name+'()');
    }
  }
  // data edges: a system writes a table that another system reads (data hand-off)
  const tableWriters=new Map(), tableReaders=new Map();
  for(const h of (index.dbAccess||[])){
    if(!h.table) continue; const owner=ownerOfFile.get(h.file); if(!owner) continue;
    const write=/write|insert|update|delete|create|save|upsert|ddl/i.test(h.kind+' '+(h.op||''));
    const m = write?tableWriters:tableReaders;
    if(!m.has(h.table)) m.set(h.table,new Set());
    m.get(h.table).add(owner);
  }
  for(const [tbl,writers] of tableWriters){
    const readers = tableReaders.get(tbl)||new Set();
    for(const w of writers){ for(const r of readers){ if(w!==r) bump(r, w, 'reads', `reads "${tbl}" written by ${capById.get(w)?capById.get(w).label:w}`); } }
  }

  const edges=[];
  for(const [k,rel] of edgeMap){
    const [from,to]=k.split('->');
    const fromNode=capById.get(from), toNode=capById.get(to);
    if(!fromNode||!toNode) continue;
    // Only keep meaningful edges (avoid noise from a single stray import).
    if(rel.count<2 && !rel.reads && !rel.writes) continue;
    const why = template(from,to) || factualWhy(fromNode.label, toNode.label, rel);
    edges.push({
      source:from, target:to, why,
      strength:rel.count,
      rels:Object.entries({imports:rel.imports,calls:rel.calls,reads:rel.reads,writes:rel.writes}).filter(([,n])=>n>0).map(([k])=>k),
      templated: !!template(from,to),
      samples:rel.samples.slice(0,4),
    });
  }
  edges.sort((a,b)=>b.strength-a.strength);

  // ---- a suggested "flow" ordering of the primary business systems (a spine) ----
  // Order business systems by dependency (fewest incoming first) to hint at a
  // natural request flow through the product.
  const businessIds = new Set(caps.filter((c)=>c.kind==='business').map((c)=>c.id));
  const indeg=new Map(); businessIds.forEach((id)=>indeg.set(id,0));
  for(const e of edges){ if(businessIds.has(e.source)&&businessIds.has(e.target)) indeg.set(e.target,(indeg.get(e.target)||0)+1); }
  const spine = [...businessIds].sort((a,b)=> (indeg.get(a)-indeg.get(b)) || (capById.get(b).confidence-capById.get(a).confidence))
    .map((id)=>({ id, label:capById.get(id).label }));

  return {
    nodes, edges, spine,
    stats:{ systems:nodes.length, links:edges.length, business:caps.filter((c)=>c.kind==='business').length },
  };
}
