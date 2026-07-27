/**
 * index.js — Trace Engine entry point. Builds the full verified investigation
 * model for a repository and exposes the investigation queries.
 *
 * buildTraceModel(universalIndex, dir): deep-analyzes Java files, builds the
 * symbol index + cross-layer + feature/loose-end analyses, and returns a compact,
 * serializable model attached as index.traceModel (heavy per-method bodies are
 * kept for server-side querying but trimmed from the client payload).
 */
import fs from 'fs';
import path from 'path';
import { analyzeJavaFile } from './java-analyzer.js';
import { adapterFor, deepLanguages, capabilityReport } from './adapters.js';
import { buildSymbolIndex } from './symbol-index.js';
import { buildCrossLayer, discoverFeatureFlows, detectLooseEnds } from './engine.js';
import { traceBackward, traceForward } from './lineage.js';

export async function buildTraceModel(universalIndex, dir) {
  // gather files for every language that has a deep analyzer adapter
  const deep = new Set(deepLanguages());
  const targetFiles = (universalIndex.files || []).filter((f) => deep.has(f.lang));
  const capabilities = capabilityReport(universalIndex.languages || []);
  if (!targetFiles.length) {
    return { available: false, reason: 'no deeply-analyzable files found (deep tracing supports Java, TypeScript, TSX, JavaScript)', languages: (universalIndex.languages || []).map((l) => l.label), capabilities };
  }
  const langFiles = [];
  const dbAccessAll = [];
  const apiCallsAll = [];
  const routesAll = [];
  for (const f of targetFiles) {
    const adapter = adapterFor(f.lang);
    if (!adapter) continue;
    let src;
    try { src = fs.readFileSync(path.join(dir, f.path), 'utf8'); } catch { continue; }
    let r;
    try { r = await adapter.analyze(f.path, src); } catch { r = null; }
    if (!r) continue;
    langFiles.push(r);
    if (r.dbAccess) for (const d of r.dbAccess) dbAccessAll.push(d);
    if (r.apiCalls) for (const a of r.apiCalls) apiCallsAll.push(a);
    if (r.routes) for (const rt of r.routes) routesAll.push(rt);
  }
  if (!langFiles.length) return { available: false, reason: 'files failed to parse', capabilities };

  const sindex = buildSymbolIndex(langFiles);
  // attach cross-file DB/API/route evidence to the symbol index for the engine
  sindex.dbAccess = dbAccessAll;
  sindex.apiCalls = apiCallsAll;
  sindex.tsRoutes = routesAll;
  const crossLayer = buildCrossLayer(sindex, universalIndex);
  const looseEnds = detectLooseEnds(sindex, crossLayer);

  return {
    available: true,
    _sindex: sindex,               // kept server-side for querying (not serialized to client)
    crossLayer,
    looseEnds: looseEnds.looseEnds,
    capabilities,
    languages: [...new Set(langFiles.map((f) => f.classes[0] && f.classes[0].framework).filter(Boolean))],
    stats: {
      classes: sindex.stats.classes, methods: sindex.stats.methods, fields: sindex.stats.fields,
      routes: crossLayer.links.length + routesAll.length, looseEnds: looseEnds.looseEnds.length,
      controllers: sindex.classes.filter((c) => c.stereotype === 'controller').length,
      services: sindex.classes.filter((c) => c.stereotype === 'service').length,
      repositories: sindex.classes.filter((c) => c.stereotype === 'repository').length,
      entities: sindex.classes.filter((c) => c.stereotype === 'entity').length,
      components: sindex.classes.filter((c) => c.stereotype === 'component').length,
      dbAccess: dbAccessAll.length, apiCalls: apiCallsAll.length,
    },
    // clickable symbol catalog (trimmed) for the UI
    symbols: sindex.symbols.filter((s) => ['class', 'interface', 'method', 'field', 'entity', 'record', 'module', 'type', 'enum'].includes(s.kind) || s.containingClass)
      .map((s) => ({ id: s.id, kind: s.kind, name: s.name, fqn: s.fqn, file: s.file, line: s.line, returnType: s.returnType, containingClass: s.containingClass })),
  };
}

// ---- investigation queries (run server-side against the retained sindex) ----
export function investigateFeature(model, query) {
  if (!model || !model.available) return { error: 'trace model unavailable' };
  const res = discoverFeatureFlows(model._sindex, model._universalIndex || {}, query);
  return res;
}

export function explainCalculation(model, methodId, variable) {
  if (!model || !model.available) return { error: 'trace model unavailable' };
  const back = traceBackward(model._sindex, methodId, variable);
  // assemble a clean calculation explanation
  const inputs = collectInputs(model._sindex, methodId, variable, back);
  return {
    variable, method: methodId,
    inputs,
    formulas: dedupeFormulas(back.formulas),
    origins: back.summary,
    steps: back.steps,
    conditions: collectConditions(back),
  };
}

export function traceVariable(model, methodId, variable, direction) {
  if (!model || !model.available) return { error: 'trace model unavailable' };
  if (direction === 'forward') return traceForward(model._sindex, methodId, variable);
  return traceBackward(model._sindex, methodId, variable);
}

export function getMethodDetail(model, methodId) {
  if (!model || !model.available) return null;
  const m = model._sindex.methodsById.get(methodId);
  if (!m) return null;
  const edges = model._sindex.callGraph.get(m.id) || [];
  return {
    id: m.id, name: m.name, signature: m.signature, class: m.containingClass, file: m.file, line: m.line, endLine: m.endLine,
    returnType: m.returnType, params: m.params, annotations: m.annotations, stereotype: m.containingStereotype,
    calls: edges.map((e) => ({ to: e.calleeId, name: e.name, class: e.calleeClass, line: e.line, confidence: e.confidence, via: e.via })),
    callers: (m._callers || []).map((id) => { const c = model._sindex.methodsById.get(id); return c ? { id, name: c.name, class: c.containingClass, file: c.file, line: c.line } : null; }).filter(Boolean),
    locals: m.locals.map((l) => ({ name: l.name, type: l.type, line: l.line, expr: l.init ? l.init.raw : null, isFormula: !!(l.init && l.init.op), condition: l.condition })),
    returns: m.returns.map((r) => ({ line: r.line, expr: r.expr ? r.expr.raw : null, condition: r.condition })),
  };
}

function collectInputs(sindex, methodId, variable, back) {
  const m = sindex.methodsById.get(methodId);
  const inputs = [];
  const seen = new Set();
  // inputs = params + fields + locals referenced by the formulas leading to `variable`
  for (const f of back.formulas) {
    for (const o of (f.operands || [])) {
      if (!o || /^[0-9."]/.test(o)) continue;
      const name = String(o).split('.')[0].replace(/\(.*/, '');
      if (seen.has(name)) continue; seen.add(name);
      const p = m.params.find((x) => x.name === name);
      const cls = sindex.typeByFqn.get(m.containingClass);
      const fld = cls && cls.fields.find((x) => x.name === name);
      const loc = m.locals.find((x) => x.name === name);
      inputs.push({ name, type: p ? p.type : (fld ? fld.type : (loc ? loc.type : null)), kind: p ? 'parameter' : fld ? 'field' : loc ? 'local' : 'ref' });
    }
  }
  return inputs;
}
function dedupeFormulas(formulas) {
  const seen = new Set(); const out = [];
  for (const f of formulas) {
    const text = f.result + ' = ' + ((f.operands && f.operands[0] != null) ? f.operands.join(' ' + f.op + ' ') : f.raw);
    if (seen.has(text)) continue; seen.add(text);
    out.push({ result: f.result, op: f.op, operands: f.operands, text, file: f.file, line: f.line, condition: f.condition });
  }
  return out;
}
function collectConditions(back) {
  const set = new Set();
  for (const f of back.formulas) if (f.condition) set.add(f.condition);
  for (const s of back.steps) if (s.condition) set.add(s.condition);
  return [...set];
}
