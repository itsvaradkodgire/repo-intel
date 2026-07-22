/**
 * embeddings.js — offline embedding index (ADDITIVE, Phase 4).
 *
 * Generates lightweight, fully-local embeddings for files, functions, classes,
 * domains, and docs using a hashed bag-of-tokens vector (feature hashing) with
 * sub-token splitting of identifiers. No network, no model download. Supports
 * cosine similarity for semantic-similarity search and as a ranking signal for
 * the Repository Brain's natural-language search. Deterministic + fast enough for
 * large repos (sparse vectors).
 */

const DIM = 512; // hashed feature dimension

// stable string hash (FNV-1a)
function hash(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0); }

// split identifiers into subtokens: camelCase, snake_case, dots, slashes
export function tokenize(text){
  if(!text) return [];
  const raw = String(text).toLowerCase();
  const parts = raw.split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  for(const p of parts){
    out.push(p);
    // split camelCase remnants + digit boundaries
    const sub = p.replace(/([a-z])([0-9])/g,'$1 $2').replace(/([0-9])([a-z])/g,'$1 $2').split(/\s+/);
    for(const s of sub) if(s && s!==p) out.push(s);
  }
  return out.filter((t)=>t.length>=2 && t.length<=30);
}

// build a sparse vector {index: weight} from tokens with simple TF weighting
export function embedTokens(tokens){
  const vec = new Map();
  for(const t of tokens){
    const idx = hash(t)%DIM;
    vec.set(idx,(vec.get(idx)||0)+1);
  }
  // l2 normalize
  let norm=0; for(const v of vec.values()) norm+=v*v; norm=Math.sqrt(norm)||1;
  const out={}; for(const [k,v] of vec) out[k]=v/norm;
  return out;
}

export function embed(text){ return embedTokens(tokenize(text)); }

export function cosine(a,b){
  // a,b are sparse objects {idx:weight} (already normalized)
  let dot=0; const small = Object.keys(a).length<=Object.keys(b).length ? a : b; const big = small===a?b:a;
  for(const k in small){ if(big[k]!=null) dot+=small[k]*big[k]; }
  return dot;
}

/**
 * Build an embedding index over the analysis result. Returns:
 *   items: [{ id, type, label, ref, vec }]
 * Kept compact: file/function/class/domain/route/table docs+names.
 */
export function buildEmbeddingIndex(index){
  const items=[];
  const push=(type,id,label,ref,text)=>{ const toks=tokenize(text); if(!toks.length)return; items.push({ id, type, label, ref, vec:embedTokens(toks) }); };

  for(const f of index.files){
    if(!f.functions && !f.doc) continue;
    const fnNames=(f.functions||[]).map((x)=>x.name).join(' ');
    const clsNames=(f.classes||[]).map((x)=>x.name).join(' ');
    push('file','file:'+f.path, f.path.split('/').pop(), f.path, f.path+' '+(f.doc||'')+' '+fnNames+' '+clsNames);
  }
  for(const fn of index.functions){
    push('function','fn:'+fn.id, fn.name, fn.file+':'+fn.line, fn.name+' '+(fn.doc||'')+' '+(fn.calls||[]).join(' ')+' '+fn.file);
  }
  for(const c of index.classes){
    push('class','class:'+c.id, c.name, c.file+':'+c.line, c.name+' '+(c.doc||'')+' '+c.kind+' '+c.file);
  }
  if(index.semantic){
    for(const d of index.semantic.domains){
      push('domain', d.id, d.label, d.dir, d.label+' '+d.dir+' '+d.keywords.join(' ')+' '+d.tables.join(' '));
    }
  }
  for(const r of index.routes){ push('route','route:'+r.method+' '+r.path, r.method+' '+r.path, r.file, r.method+' '+r.path+' '+r.framework+' '+r.file); }
  for(const t of index.tables){ push('table','table:'+t.name, t.name, t.definedIn||'', t.name+' table '+t.kinds.join(' ')); }
  return { dim:DIM, items };
}

// query the embedding index with a natural-language string
export function semanticSearch(embIndex, query, opts={}){
  const qv = embed(query);
  const limit = opts.limit||20;
  const typeFilter = opts.type||null;
  const scored=[];
  for(const it of embIndex.items){
    if(typeFilter && it.type!==typeFilter) continue;
    const s = cosine(qv, it.vec);
    if(s>0) scored.push({ id:it.id, type:it.type, label:it.label, ref:it.ref, score:Math.round(s*1000)/1000 });
  }
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0,limit);
}

// similarity to a specific item (find related nodes)
export function similarTo(embIndex, id, limit=10){
  const target = embIndex.items.find((x)=>x.id===id);
  if(!target) return [];
  const scored=[];
  for(const it of embIndex.items){
    if(it.id===id) continue;
    const s=cosine(target.vec,it.vec);
    if(s>0.05) scored.push({ id:it.id, type:it.type, label:it.label, ref:it.ref, score:Math.round(s*1000)/1000 });
  }
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0,limit);
}
