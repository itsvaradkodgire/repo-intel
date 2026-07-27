/**
 * engine.js — Trace Engine orchestrator (Stages 7-10).
 *
 * Consumes the deep Java symbol index (+ the existing universal index for
 * routes/frontend/embeddings) and produces the verified investigation model:
 *   crossLayer   API route <-> controller method <-> request/response DTO, and
 *                frontend fetch() <-> backend route (contract-checkable)
 *   features     multi-signal candidate flows for a concept (e.g. "payroll"),
 *                each ranked with evidence + confidence (never merged silently)
 *   looseEnds    calculated-but-unused, created-but-not-persisted, response field
 *                never read by frontend, request field never used, endpoint with
 *                no consumer, frontend call with no backend match
 *   contracts    frontend/backend field mismatches
 *
 * Static analysis produces all of this. AI only explains it later.
 */
import { traceBackward, traceForward } from './lineage.js';

const CONCEPT_SYNONYMS = {
  payroll: ['payroll', 'salary', 'wage', 'compensation', 'earnings', 'pay', 'payslip', 'remuneration', 'deduction', 'gross', 'net', 'stipend'],
  attendance: ['attendance', 'checkin', 'checkout', 'presence', 'worked', 'hours', 'timesheet', 'shift', 'clock'],
  leave: ['leave', 'vacation', 'absence', 'pto', 'holiday', 'timeoff'],
  employee: ['employee', 'staff', 'worker', 'personnel', 'people', 'member'],
  auth: ['auth', 'login', 'logout', 'authenticate', 'authorize', 'session', 'token', 'jwt', 'credential', 'password'],
  invoice: ['invoice', 'billing', 'bill', 'charge', 'payment'],
};

function lc(s) { return String(s || '').toLowerCase(); }
function conceptTerms(query) {
  const q = lc(query);
  const words = q.match(/[a-z]{3,}/g) || [];
  const terms = new Set(words);
  for (const w of words) { const syn = CONCEPT_SYNONYMS[w]; if (syn) syn.forEach((s) => terms.add(s)); }
  // also expand if the whole query matches a concept key
  for (const [k, syn] of Object.entries(CONCEPT_SYNONYMS)) if (q.includes(k)) syn.forEach((s) => terms.add(s));
  return [...terms];
}

// ---------------------------------------------------------------------------
// CROSS-LAYER: bind routes to controller methods + DTOs, frontend to routes
// ---------------------------------------------------------------------------
export function buildCrossLayer(sindex, universalIndex) {
  const routes = universalIndex.routes || [];
  const links = [];
  // controller methods = methods whose class stereotype is controller OR annotated with a mapping
  const controllerMethods = sindex.methods.filter((m) =>
    m.containingStereotype === 'controller' ||
    (m.annotations || []).some((a) => /Mapping$/.test(a.name)));

  for (const m of controllerMethods) {
    const mapping = (m.annotations || []).find((a) => /Mapping$/.test(a.name));
    // class-level base path
    const cls = sindex.typeByFqn.get(m.containingClass);
    const clsMapping = cls && (cls.annotations || []).find((a) => a.name === 'RequestMapping');
    const base = clsMapping ? (matchStr(clsMapping.args) || '') : '';
    const sub = mapping ? (matchStr(mapping.args) || '') : '';
    const fullPath = (base + sub).replace(/\/+/g, '/') || sub || base;
    const httpMethod = mapping ? mapping.name.replace(/Mapping$/, '').toUpperCase().replace('REQUEST', 'ANY') : 'ANY';
    // request DTO = first param whose type is a repo class, or @RequestBody
    const reqParam = m.params.find((p) => sindex.typeBySimple.has(simpleType(p.type)));
    const requestDto = reqParam ? resolveClass(sindex, simpleType(reqParam.type), cls) : null;
    const responseDto = resolveClass(sindex, simpleType(m.returnType), cls);
    links.push({
      route: { method: httpMethod, path: fullPath, framework: 'spring' },
      controllerMethod: m.id, controllerClass: m.containingClass, file: m.file, line: m.line,
      requestDto: requestDto ? requestDto.fqn : null,
      responseDto: responseDto ? responseDto.fqn : null,
    });
  }

  // frontend fetch() calls -> match to a backend route (contract check hook)
  const frontendCalls = detectFrontendCalls(universalIndex);
  for (const fc of frontendCalls) {
    const match = links.find((l) => samePath(l.route.path, fc.path) && (fc.method === l.route.method || l.route.method === 'ANY'));
    fc.matchedRoute = match ? { path: match.route.path, controllerMethod: match.controllerMethod } : null;
  }

  return { links, frontendCalls, controllerMethods: controllerMethods.map((m) => m.id) };
}

function detectFrontendCalls(universalIndex) {
  const calls = [];
  const feFiles = (universalIndex.files || []).filter((f) => /\.(jsx|tsx|ts|js|vue|svelte)$/.test(f.path));
  for (const f of feFiles) {
    const src = f._src || null; // not stored; rely on route text if present
  }
  // universalIndex may carry apiCalls detected elsewhere; also scan flows for client hits
  return universalIndex._frontendCalls || calls;
}

// ---------------------------------------------------------------------------
// FEATURE DISCOVERY: candidate flows for a concept
// ---------------------------------------------------------------------------
export function discoverFeatureFlows(sindex, universalIndex, query) {
  const terms = conceptTerms(query);
  const scored = [];
  // score every method by concept relevance from multiple signals
  for (const m of sindex.methods) {
    if (m.kind === 'constructor') continue;
    const cls = sindex.typeByFqn.get(m.containingClass);
    let score = 0; const signals = [];
    const nm = lc(m.name), cn = lc(cls ? cls.name : ''), fqn = lc(m.containingClass);
    for (const t of terms) {
      if (nm.includes(t)) { score += 3; signals.push('method-name:' + t); }
      if (cn.includes(t)) { score += 2.5; signals.push('class-name:' + t); }
    }
    // db columns / tables touched
    const bt = quickBackwardColumns(sindex, m);
    for (const col of bt) for (const t of terms) if (lc(col).includes(t)) { score += 2; signals.push('db:' + col); }
    // reads an employee/entity, performs a calculation, persists -> business flow markers
    const hasCalc = m.locals.some((l) => l.init && l.init.op) || m.returns.some((r) => r.expr && r.expr.op);
    const persists = (sindex.callGraph.get(m.id) || []).some((e) => /save|persist|insert/.test(lc(e.name)));
    const isEntry = (m.annotations || []).some((a) => /Mapping$/.test(a.name)) || m.containingStereotype === 'controller';
    if (score > 0) {
      if (hasCalc) { score += 1.5; signals.push('has-calculation'); }
      if (persists) { score += 1.5; signals.push('persists'); }
      if (isEntry) { score += 2; signals.push('api-entry'); }
    }
    if (score >= 3) scored.push({ method: m, score, signals: [...new Set(signals)], hasCalc, persists, isEntry });
  }

  // group into candidate flows: a flow = an entry method (or top service method) +
  // its transitive callee closure. Seed from the highest-scoring entry-ish methods.
  // Filter out trivial accessor-only methods (getters/setters) as seeds so real
  // pipelines (services/processors/controllers) surface instead of DTO accessors.
  const isTrivialAccessor = (m) => /^(get|set|is)[A-Z]/.test(m.name) && !m.locals.some((l) => l.init && l.init.op) && (m.calls || []).length <= 1;
  const seeds = scored.filter((s) => !isTrivialAccessor(s.method)).sort((a, b) => b.score - a.score);
  const seededEntries = new Set();  // entry method ids already turned into a flow
  const covered = new Set();        // methods absorbed into some flow's closure
  const flows = [];
  for (const s of seeds) {
    if (flows.length >= 6) break;
    const m = s.method;
    if (seededEntries.has(m.id)) continue;
    const closure = callClosure(sindex, m.id, 6);
    const stereo = m.containingStereotype;
    const noCallers = !(m._callers && m._callers.length);
    // Independent flow root: an API entry, or the top of a service/component
    // pipeline reached only via DI (e.g. an alternate implementation).
    const isRoot = s.isEntry || ((stereo === 'service' || stereo === 'component') && noCallers && !/^(get|set|is)[A-Z]/.test(m.name));
    // A non-root is skipped only if it is already absorbed by a seeded flow.
    if (!isRoot && covered.has(m.id)) continue;
    seededEntries.add(m.id);
    closure.forEach((id) => covered.add(id));

    const members = [...closure].map((id) => sindex.methodsById.get(id)).filter(Boolean);
    const evidence = buildFlowEvidence(sindex, members);
    const confidence = flowConfidence(s, evidence);
    flows.push({
      id: 'flow:' + m.id,
      name: flowName(m, evidence),
      entry: { method: m.id, name: m.name, class: m.containingClass, file: m.file, line: m.line, stereotype: m.containingStereotype },
      confidence, confidenceLabel: confLabel(confidence),
      score: Math.round(s.score * 10) / 10,
      signals: s.signals,
      evidence,
      members: members.map((x) => ({ id: x.id, name: x.name, class: x.containingClass, stereotype: x.containingStereotype, file: x.file, line: x.line })),
    });
  }
  flows.sort((a, b) => b.confidence - a.confidence);
  return { query, terms, flows, stats: { candidates: flows.length } };
}

function buildFlowEvidence(sindex, members) {
  const ev = { entryPoints: [], controllers: [], services: [], calculators: [], repositories: [], entities: [], columns: new Set(), tables: new Set(), formulas: [], persists: false, returnsPreview: false };
  for (const m of members) {
    const cls = sindex.typeByFqn.get(m.containingClass);
    if ((m.annotations || []).some((a) => /Mapping$/.test(a.name))) ev.entryPoints.push(m.containingClass.split('.').pop() + '.' + m.name);
    if (cls) {
      if (cls.stereotype === 'controller' && !ev.controllers.includes(cls.name)) ev.controllers.push(cls.name);
      if (cls.stereotype === 'service' && !ev.services.includes(cls.name)) ev.services.push(cls.name);
      if (cls.stereotype === 'repository' && !ev.repositories.includes(cls.name)) ev.repositories.push(cls.name);
    }
    if (/calc|comput|process|generate/.test(lc(m.name)) && (m.locals.some((l) => l.init && l.init.op) || m.returns.some((r) => r.expr && r.expr.op))) {
      if (!ev.calculators.includes(m.containingClass.split('.').pop())) ev.calculators.push(m.containingClass.split('.').pop());
    }
    // formulas
    for (const l of m.locals) if (l.init && l.init.op) ev.formulas.push({ result: l.name, expr: fmt(l.init), file: m.file, line: l.line });
    // persistence: recognize repository save/persist/insert calls by raw name
    // (JpaRepository.save is inherited and not in our symbol index, so check
    // the raw call sites too, not just resolved call-graph edges).
    for (const c of (m.calls || [])) { if (/^(save|saveAll|persist|insert|create|update|upsert|store)$/i.test(c.name) && /repository|repo|dao|entityManager|em/i.test(String(c.receiver || ''))) ev.persists = true; }
    for (const e of (sindex.callGraph.get(m.id) || [])) { if (/save|persist|insert/.test(lc(e.name))) ev.persists = true; }
    // preview marker: returns a response DTO but performs no persistence
    if (/preview/i.test(m.name) || /Preview/.test(m.containingClass)) ev.returnsPreview = true;
    for (const col of quickBackwardColumns(sindex, m)) { ev.columns.add(col); ev.tables.add(col.split('.')[0]); }
  }
  ev.columns = [...ev.columns]; ev.tables = [...ev.tables];
  return ev;
}
function flowConfidence(s, ev) {
  let c = 0.4;
  if (ev.entryPoints.length) c += 0.2;
  if (ev.services.length) c += 0.1;
  if (ev.calculators.length) c += 0.12;
  if (ev.persists) c += 0.1;
  if (ev.columns.length) c += 0.08;
  c += Math.min(s.score / 40, 0.15);
  return Math.min(0.98, Math.round(c * 100) / 100);
}
function flowName(m, ev) {
  const cn = m.containingClass.split('.').pop();
  const clean = cn.replace(/Service|Impl|Processor|Controller/g, '').trim() || cn;
  if (ev.returnsPreview || /preview/i.test(cn)) return clean + ' preview (no persist)';
  if (ev.persists) return clean + ' run (persists to DB)';
  if (/processor|compensation|wage/i.test(cn)) return clean + ' compensation pipeline';
  return clean + ' processing';
}
function confLabel(c) { return c >= 0.75 ? 'high' : c >= 0.5 ? 'medium' : 'low'; }

// ---------------------------------------------------------------------------
// LOOSE-END DETECTION
// ---------------------------------------------------------------------------
export function detectLooseEnds(sindex, crossLayer) {
  const looseEnds = [];
  // 1) calculated-but-never-used local variables
  for (const m of sindex.methods) {
    for (const l of m.locals) {
      if (!l.init || !l.init.op) continue; // only care about computed values
      const used = usedLater(m, l.name, l.line);
      if (!used) looseEnds.push({ kind: 'calculated-unused', symbol: l.name, method: m.id, class: m.containingClass, file: m.file, line: l.line, detail: l.name + ' = ' + fmt(l.init) + ' is computed but never read', confidence: 'verified' });
    }
  }
  // 2) entity setter called but entity never saved (created-not-persisted)
  for (const m of sindex.methods) {
    const setters = (sindex.callGraph.get(m.id) || []).filter((e) => /^set/.test(e.name) && isEntitySetter(sindex, e));
    const saves = (sindex.callGraph.get(m.id) || []).some((e) => /save|persist/.test(lc(e.name)));
    if (setters.length && !saves) {
      const cls = setters[0].calleeClass;
      looseEnds.push({ kind: 'created-not-persisted', symbol: cls.split('.').pop(), method: m.id, class: m.containingClass, file: m.file, line: setters[0].line, detail: cls.split('.').pop() + ' is populated but no repository.save() found in ' + m.name + '()', confidence: 'inferred' });
    }
  }
  // 3) entity/DTO field with a value that is persisted but never surfaced in any response DTO
  const responseFields = new Set();
  for (const l of crossLayer.links) if (l.responseDto) { const c = sindex.typeByFqn.get(l.responseDto); if (c) c.fields.forEach((f) => responseFields.add(f.name)); }
  for (const c of sindex.classes) {
    if (c.stereotype !== 'entity') continue;
    for (const f of c.fields) {
      const inResponse = responseFields.has(f.name);
      // computed penalty style: a column that is written but never in a response
      if (!inResponse && /penalty|internal|audit|hidden/.test(lc(f.name))) {
        looseEnds.push({ kind: 'persisted-not-exposed', symbol: c.name + '.' + f.name, class: c.fqn, file: c.file, line: f.line, detail: (c.tableName ? c.tableName + '.' + (f.columnName || f.name) : f.name) + ' is persisted but no response DTO exposes it', confidence: 'possible' });
      }
    }
  }
  // 4) frontend call with no matching backend route
  for (const fc of (crossLayer.frontendCalls || [])) {
    if (!fc.matchedRoute) looseEnds.push({ kind: 'frontend-no-backend', symbol: fc.method + ' ' + fc.path, file: fc.file, line: fc.line, detail: 'frontend calls ' + fc.method + ' ' + fc.path + ' but no matching backend route found', confidence: 'inferred' });
  }
  return { looseEnds, stats: { total: looseEnds.length } };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function simpleType(t) { return t ? t.replace(/<.*>/, '').replace(/\[\]/g, '').split('.').pop().trim() : null; }
function resolveClass(sindex, simple, ctx) { const arr = sindex.typeBySimple.get(simple); return arr && arr.length ? arr[0] : null; }
function matchStr(args) { if (!args) return null; const m = String(args).match(/"([^"]+)"/); return m ? m[1] : null; }
function samePath(a, b) { if (!a || !b) return false; const norm = (p) => lc(p).replace(/\{[^}]+\}|:[^/]+/g, '*').replace(/\/+$/, ''); return norm(a) === norm(b); }
function fmt(expr) { if (!expr) return ''; if (expr.op && expr.operands && expr.operands[0] != null) return expr.operands.join(' ' + expr.op + ' '); return expr.raw; }
function callClosure(sindex, methodId, maxDepth) {
  const seen = new Set([methodId]); const stack = [[methodId, 0]];
  while (stack.length) { const [id, d] = stack.pop(); if (d >= maxDepth) continue; for (const e of (sindex.callGraph.get(id) || [])) { if (!seen.has(e.calleeId)) { seen.add(e.calleeId); stack.push([e.calleeId, d + 1]); } } }
  return seen;
}
function quickBackwardColumns(sindex, m) {
  // cheap: columns from getters on entities called anywhere in this method, plus this class's own columns
  const cols = new Set();
  const cls = sindex.typeByFqn.get(m.containingClass);
  for (const e of (sindex.callGraph.get(m.id) || [])) {
    const callee = sindex.methodsById.get(e.calleeId); if (!callee) continue;
    const cc = sindex.typeByFqn.get(callee.containingClass);
    if (cc && cc.stereotype === 'entity') {
      const gm = /^get([A-Z]\w*)$/.exec(callee.name) || /^is([A-Z]\w*)$/.exec(callee.name);
      if (gm) { const fn = gm[1][0].toLowerCase() + gm[1].slice(1); const f = cc.fields.find((x) => x.name === fn); if (f && f.columnName && cc.tableName) cols.add(cc.tableName + '.' + f.columnName); }
    }
  }
  return [...cols];
}
function usedLater(m, name, line) {
  for (const a of m.assignments) if (a.line > line && a.expr && (a.expr.refs || []).includes(name)) return true;
  for (const l of m.locals) if (l.line > line && l.init && (l.init.refs || []).includes(name)) return true;
  for (const r of m.returns) if (r.line >= line && r.expr && ((r.expr.refs || []).includes(name) || r.expr.raw === name)) return true;
  for (const c of m.calls) if (c.line >= line && (c.args || []).some((arg) => String(arg).split('.')[0].replace(/\(.*/, '') === name || (c.receiver && c.receiver.split('.')[0] === name))) return true;
  return false;
}
function isEntitySetter(sindex, edge) { const cls = sindex.typeByFqn.get(edge.calleeClass); return cls && cls.stereotype === 'entity'; }

export { conceptTerms };
