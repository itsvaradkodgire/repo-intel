/**
 * capabilities.js — Phase 5 Domain Discovery Engine (ADDITIVE, mechanical).
 *
 * Infers WHAT each part of the repo does and WHY it exists by matching the
 * capability taxonomy against real static-analysis evidence: file/dir names,
 * function & class names, HTTP routes, DB tables, dependencies, env vars.
 *
 * Never relies on folder names alone. Every capability that surfaces carries:
 *   - the concrete evidence that triggered it (files/routes/tables/deps/symbols)
 *   - a confidence score in 0..1 and a confidence word (confident/likely/possibly)
 *   - the files that implement it, and the domains (from Phase 2) it spans
 *
 * If nothing matches with enough evidence, the capability is simply omitted
 * (we never assert a feature that the code does not support).
 */
import { CAPABILITIES, SIGNAL_WEIGHTS, confidenceLabel } from './taxonomy.js';

function lc(s){ return String(s||'').toLowerCase(); }
function baseTokens(p){ return lc(p).replace(/\.[^./]+$/,'').split(/[\/_\-.]+/).filter(Boolean); }
function isTestPath(p){ return /(^|\/)(tests?|specs?|__tests__|e2e|fixtures?|examples?|mocks?|benchmarks?)(\/|$)|\.(test|spec)\.|_test\.|test_/.test(lc(p)); }

// Match a set of needle substrings against a haystack string; return matched needles.
function hits(needles, haystack){
  const out=[]; const hay=lc(haystack);
  for(const n of (needles||[])){ if(hay.includes(lc(n))) out.push(n); }
  return out;
}

export function discoverCapabilities(index){
  const codeFiles = index.files.filter((f)=>f.functions);
  const fileByPath = new Map(index.files.map((f)=>[f.path,f]));

  // Pre-index evidence for fast matching.
  const fnNames = index.functions.map((f)=>({ name:lc(f.name), file:f.file }));
  const clsNames = index.classes.map((c)=>({ name:lc(c.name), file:c.file }));
  const routes = index.routes||[];
  const tables = index.tables||[];
  const deps = (index.dependencies||[]).map((d)=>lc(d.name));
  const envNames = (index.env||[]).map((e)=>lc(e.name));

  // domain lookup (Phase 2) to attach domains to capabilities
  const domains = (index.semantic && index.semantic.domains) || [];
  const domainOfFile = new Map();
  for(const d of domains){ for(const p of d.files) domainOfFile.set(p, d); }

  const results=[];
  for(const cap of CAPABILITIES){
    const sig = cap.signals||{};
    const evidence = { files:new Set(), implFiles:new Set(), testFiles:new Set(), routes:[], tables:[], deps:[], symbols:[], env:[] };
    let score=0;
    // record a file as evidence, weighting implementation files far above tests
    const addFile=(p,pts)=>{ if(!p) return; evidence.files.add(p); if(isTestPath(p)){ evidence.testFiles.add(p); score += pts*0.15; } else { evidence.implFiles.add(p); score += pts; } };

    // ---- name signal: file/dir basename tokens ----
    if(sig.name){
      for(const f of index.files){
        const toks = new Set([...baseTokens(f.path.split('/').pop()), ...f.path.split('/').map(lc)]);
        const matched = (sig.name).filter((n)=>toks.has(lc(n)));
        if(matched.length){ addFile(f.path, SIGNAL_WEIGHTS.name * Math.min(matched.length,2)); }
      }
    }
    // ---- symbol signal: function/class names (substring, weaker) ----
    if(sig.symbol){
      const seen=new Set();
      for(const fn of fnNames){
        const m = hits(sig.symbol, fn.name);
        if(m.length && !seen.has(fn.file+fn.name)){ seen.add(fn.file+fn.name); if(!isTestPath(fn.file)) evidence.symbols.push(fn.name); addFile(fn.file, SIGNAL_WEIGHTS.symbol); }
        if(evidence.symbols.length>=40) break;
      }
      for(const c of clsNames){
        const m = hits(sig.symbol, c.name);
        if(m.length){ if(!isTestPath(c.file)) evidence.symbols.push(c.name); addFile(c.file, SIGNAL_WEIGHTS.symbol); }
        if(evidence.symbols.length>=60) break;
      }
    }
    // ---- route signal ----
    if(sig.route){
      for(const r of routes){
        const m = hits(sig.route, r.path);
        if(m.length){ if(!isTestPath(r.file)) evidence.routes.push(r.method+' '+r.path); addFile(r.file, SIGNAL_WEIGHTS.route); }
      }
    }
    // ---- table signal ----
    if(sig.table){
      for(const t of tables){
        const m = hits(sig.table, t.name);
        if(m.length){ evidence.tables.push(t.name); score += SIGNAL_WEIGHTS.table;
          for(const p of (t.writtenBy||[]).concat(t.readBy||[])) { evidence.files.add(p); if(!isTestPath(p)) evidence.implFiles.add(p); } }
      }
    }
    // ---- dependency signal (strong: a library dedicated to the capability) ----
    if(sig.dep){
      for(const d of deps){
        const m = hits(sig.dep, d);
        if(m.length){ evidence.deps.push(d); score += SIGNAL_WEIGHTS.dep; }
      }
    }
    // ---- env signal ----
    if(sig.env){
      for(const e of envNames){
        const m = hits(sig.env, e);
        if(m.length){ evidence.env.push(e); score += SIGNAL_WEIGHTS.env; }
      }
    }

    // A capability needs at least a couple of independent IMPLEMENTATION evidence points.
    const implCount = evidence.implFiles.size;
    const evCount = implCount + evidence.routes.length + evidence.tables.length + evidence.deps.length;
    const distinctSignals = [implCount>0, evidence.routes.length>0, evidence.tables.length>0, evidence.deps.length>0, evidence.symbols.length>0, evidence.env.length>0].filter(Boolean).length;
    // Omit capabilities that only appear in tests/fixtures (referenced, not implemented).
    if(score<=0 || evCount<2 || (implCount===0 && evidence.deps.length===0)) continue;

    // Normalize score to 0..1. Calibrated so a couple of strong signals -> "likely",
    // multiple corroborating signals -> "confident". Dependencies and routes/tables
    // (which are semantically specific) push confidence up faster than raw names.
    const specificBoost = (evidence.deps.length?0.25:0) + (evidence.tables.length?0.12:0) + (evidence.routes.length?0.12:0) + (distinctSignals>=3?0.15:0);
    let conf = 1 - Math.exp(-score/9);
    conf = Math.min(0.98, conf*0.7 + specificBoost);
    // require more than a single flimsy name hit to ever be "confident"
    if(distinctSignals<2) conf = Math.min(conf, 0.4);
    // if evidence is dominated by tests, cap confidence (feature is referenced, not clearly owned)
    const implShare = evidence.files.size ? implCount/evidence.files.size : 1;
    if(implShare<0.34) conf = Math.min(conf, 0.45);

    const files=[...(evidence.implFiles.size?evidence.implFiles:evidence.files)];
    const capDomains = new Set();
    for(const p of files){ const d=domainOfFile.get(p); if(d) capDomains.add(d.id); }

    results.push({
      id: cap.id, label: cap.label, kind: cap.kind, why: cap.why, users: cap.users||[],
      confidence: Math.round(conf*100)/100,
      confidenceLabel: confidenceLabel(conf),
      score: Math.round(score*10)/10,
      signals: distinctSignals,
      evidence: {
        files: files.slice(0,60),
        fileCount: files.length,
        testOnly: implCount===0,
        routes: [...new Set(evidence.routes)].slice(0,20),
        tables: [...new Set(evidence.tables)].slice(0,20),
        deps: [...new Set(evidence.deps)].slice(0,20),
        symbols: [...new Set(evidence.symbols)].slice(0,24),
        env: [...new Set(evidence.env)].slice(0,12),
      },
      domains:[...capDomains],
      loc: files.reduce((s,p)=>s+((fileByPath.get(p)||{}).loc||0),0),
    });
  }

  results.sort((a,b)=> (b.confidence-a.confidence) || (b.evidence.fileCount-a.evidence.fileCount));

  // Split by kind for convenient consumption.
  const byKind = {};
  for(const r of results){ (byKind[r.kind]=byKind[r.kind]||[]).push(r); }

  return {
    capabilities: results,
    business: byKind['business']||[],
    integration: byKind['integration']||[],
    infrastructure: byKind['infrastructure']||[],
    crossCutting: byKind['cross-cutting']||[],
    technical: byKind['technical']||[],
    stats: {
      total: results.length,
      business: (byKind['business']||[]).length,
      confident: results.filter((r)=>r.confidence>=0.75).length,
    },
  };
}
