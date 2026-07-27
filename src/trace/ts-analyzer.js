/**
 * ts-analyzer.js — deep TypeScript / TSX / JavaScript / JSX analyzer.
 *
 * Emits the SAME normalized per-file model as java-analyzer.js so the existing
 * language-independent pipeline (symbol-index -> lineage -> engine -> server ->
 * UI) works unchanged and Java + TS can share ONE Evidence Graph:
 *
 *   { path, package, imports[], classes[ {
 *       name, fqn, kind, stereotype, tableName, annotations, extends, implements,
 *       fields[ {name,type,columnName,annotations,visibility,line} ],
 *       methods[ {name,returnType,visibility,annotations,params[],line,endLine,
 *                 locals[], assignments[], calls[], returns[]} ]
 *   } ], apiCalls[], dbAccess[], routes[], framework }
 *
 * Module-scope functions/consts/arrow functions are grouped into a synthetic
 * "module" class so the method/field machinery applies uniformly. React function
 * components are methods; hooks and event handlers are calls; fetch/axios/api-
 * wrapper calls are captured as apiCalls with method+url; Supabase/Prisma/ORM
 * chains are captured as dbAccess with table+op+columns.
 *
 * Uses tree-sitter (a real parser, not regex), matching the rest of the platform.
 */
import { getParser } from '../analyzer/languages.js';

function txt(n, src) { return n ? src.slice(n.startIndex, n.endIndex) : ''; }
function line(n) { return n.startPosition.row + 1; }
function endLine(n) { return n.endPosition.row + 1; }
function field(n, name) { return n && n.childForFieldName ? n.childForFieldName(name) : null; }
function named(n) { const o = []; if (!n) return o; for (let i = 0; i < n.namedChildCount; i++) o.push(n.namedChild(i)); return o; }
function firstOfType(n, t) { if (!n) return null; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c.type === t) return c; } return null; }
function descendants(n, types, out = [], depth = 0) { if (!n || depth > 60) return out; if (types.includes(n.type)) out.push(n); for (let i = 0; i < n.namedChildCount; i++) descendants(n.namedChild(i), types, out, depth + 1); return out; }

const ARITH = { '+': '+', '-': '-', '*': '×', '/': '/', '%': '%' };

// ---- expression description (same shape as java-analyzer.describeExpr) ----
function describeExpr(node, src) {
  if (!node) return null;
  const raw = txt(node, src).replace(/\s+/g, ' ').trim();
  const info = { kind: node.type, raw, refs: [], calls: [], op: null, operands: [] };
  collectRefsCalls(node, src, info);

  let n = node;
  if (n.type === 'parenthesized_expression') { const inner = named(n).find((c) => /expression|identifier|number|call|binary|member|ternary/.test(c.type)); if (inner) n = inner; }

  if (n.type === 'binary_expression') {
    const l = field(n, 'left'), op = field(n, 'operator'), r = field(n, 'right');
    const o = op ? txt(op, src) : null;
    if (o && ARITH[o]) { info.op = ARITH[o]; info.operands = [describeOperand(l, src), describeOperand(r, src)]; }
    else if (o) { info.op = o; info.operands = [describeOperand(l, src), describeOperand(r, src)]; } // logical/compare kept for conditions
  } else if (n.type === 'ternary_expression') {
    const cond = field(n, 'condition'), cons = field(n, 'consequence'), alt = field(n, 'alternative');
    info.op = '?:'; info.ternary = { condition: cond ? txt(cond, src).replace(/\s+/g, ' ') : null, then: cons ? describeOperand(cons, src) : null, else: alt ? describeOperand(alt, src) : null };
    info.operands = [info.ternary.then, info.ternary.else];
  }
  info.operands = info.operands.map((o) => (o == null ? null : String(o).replace(/\s+/g, ' ').trim()));
  return info;
}
function describeOperand(node, src) {
  if (!node) return null;
  if (node.type === 'parenthesized_expression') { const inner = named(node)[0]; if (inner) return describeOperand(inner, src); }
  // Number(x) / parseInt(x) unwrap
  if (node.type === 'call_expression') {
    const fn = field(node, 'function'); const args = field(node, 'arguments');
    if (fn && /^(Number|parseInt|parseFloat|String)$/.test(txt(fn, src)) && args) { const a = named(args)[0]; if (a) return txt(a, src).replace(/\s+/g, ' '); }
  }
  return txt(node, src).replace(/\s+/g, ' ').trim();
}
function collectRefsCalls(node, src, info, depth = 0) {
  if (!node || depth > 50) return;
  if (node.type === 'identifier' || node.type === 'shorthand_property_identifier') {
    const t = txt(node, src); if (t && !info.refs.includes(t)) info.refs.push(t);
  } else if (node.type === 'call_expression') {
    const fn = field(node, 'function');
    if (fn) {
      if (fn.type === 'member_expression') { const prop = field(fn, 'property'); const obj = field(fn, 'object'); info.calls.push({ name: prop ? txt(prop, src) : '?', receiver: obj ? txt(obj, src).replace(/\s+/g, '') : null, line: line(node) }); }
      else info.calls.push({ name: txt(fn, src), receiver: null, line: line(node) });
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) collectRefsCalls(node.namedChild(i), src, info, depth + 1);
}

// ---- method-body walk: locals, assignments, calls, returns w/ conditions ----
function analyzeBody(bodyNode, src, sink) {
  const locals = [], assignments = [], calls = [], returns = [];
  if (!bodyNode) return { locals, assignments, calls, returns };

  const declare = (nameNode, typeNode, valueNode, condition) => {
    if (!nameNode) return;
    if (nameNode.type === 'identifier') {
      const init = valueNode ? describeExpr(valueNode, src) : null;
      // a ternary result is conditional: surface its predicate as the local's
      // condition (parity with Java if/else guarded assignments) so the lineage
      // reports "payableDays = base - 0.5 when worked_hours < HALF_DAY_THRESHOLD".
      const cond = condition || (init && init.ternary && init.ternary.condition) || null;
      locals.push({ name: txt(nameNode, src), type: typeNode ? cleanType(txt(typeNode, src)) : inferType(valueNode, src), line: line(nameNode), init, condition: cond });
      if (valueNode) recordCalls(valueNode, src, calls, condition);
    } else if (nameNode.type === 'object_pattern') {
      // const { salary, days } = employee  -> each becomes a local sourced from the object
      const srcObj = valueNode ? txt(valueNode, src).replace(/\s+/g, '') : null;
      for (const p of named(nameNode)) {
        const key = p.type === 'shorthand_property_identifier_pattern' ? txt(p, src) : (field(p, 'key') ? txt(field(p, 'key'), src) : txt(p, src));
        const val = field(p, 'value'); const localName = val && val.type === 'identifier' ? txt(val, src) : key;
        locals.push({ name: localName, type: null, line: line(p), init: srcObj ? { kind: 'destructure', raw: srcObj + '.' + key, refs: [srcObj], calls: [], op: null, operands: [], property: key, from: srcObj } : null, condition: condition || null });
      }
      if (valueNode) recordCalls(valueNode, src, calls, condition);
    } else if (nameNode.type === 'array_pattern') {
      // const [value, setValue] = useState(...)
      const els = named(nameNode).filter((c) => c.type === 'identifier');
      const initDesc = valueNode ? describeExpr(valueNode, src) : null;
      els.forEach((elm, i) => locals.push({ name: txt(elm, src), type: null, line: line(elm), init: initDesc ? Object.assign({}, initDesc, { tupleIndex: i }) : null, condition: condition || null }));
      if (valueNode) recordCalls(valueNode, src, calls, condition);
    }
  };

  const walk = (node, condition) => {
    if (!node) return;
    switch (node.type) {
      case 'lexical_declaration': case 'variable_declaration': {
        for (const d of named(node).filter((c) => c.type === 'variable_declarator')) {
          declare(field(d, 'name'), field(d, 'type'), field(d, 'value'), condition);
        }
        return;
      }
      case 'expression_statement': {
        const inner = node.namedChild(0);
        if (inner && inner.type === 'assignment_expression') {
          const l = field(inner, 'left'), r = field(inner, 'right');
          assignments.push({ target: l ? txt(l, src).replace(/\s+/g, '') : '?', expr: r ? describeExpr(r, src) : null, line: line(inner), condition: condition || null });
          if (r) recordCalls(r, src, calls, condition);
        } else if (inner && inner.type === 'augmented_assignment_expression') {
          const l = field(inner, 'left'), r = field(inner, 'right'), op = field(inner, 'operator');
          assignments.push({ target: l ? txt(l, src).replace(/\s+/g, '') : '?', expr: r ? describeExpr(r, src) : null, op: op ? txt(op, src) : null, line: line(inner), condition: condition || null });
          if (r) recordCalls(r, src, calls, condition);
        } else if (inner) recordCalls(inner, src, calls, condition);
        return;
      }
      case 'return_statement': {
        const e = node.namedChild(0);
        returns.push({ expr: e ? describeExpr(e, src) : null, line: line(node), condition: condition || null });
        if (e) recordCalls(e, src, calls, condition);
        return;
      }
      case 'if_statement': {
        const cond = field(node, 'condition'); const conseq = field(node, 'consequence'); const alt = field(node, 'alternative');
        const condText = cond ? txt(cond, src).replace(/\s+/g, ' ').replace(/^\(|\)$/g, '') : null;
        walk(conseq, condText);
        if (alt) walk(alt, condText ? '!(' + condText + ')' : null);
        return;
      }
      case 'for_statement': case 'for_in_statement': case 'while_statement': case 'do_statement': {
        walk(field(node, 'body'), condition); return;
      }
      case 'switch_statement': case 'try_statement': {
        for (const c of named(node)) walk(c, condition); return;
      }
      default:
        for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i), condition);
    }
  };
  walk(bodyNode, null);
  return { locals, assignments, calls, returns };
}

function recordCalls(node, src, calls, condition, depth = 0) {
  if (!node || depth > 50) return;
  if (node.type === 'call_expression') {
    const fn = field(node, 'function'); const args = field(node, 'arguments');
    let name = '?', receiver = null;
    if (fn) {
      if (fn.type === 'member_expression') { const prop = field(fn, 'property'); const obj = field(fn, 'object'); name = prop ? txt(prop, src) : '?'; receiver = obj ? txt(obj, src).replace(/\s+/g, '') : null; }
      else { name = txt(fn, src); }
    }
    calls.push({ name, receiver, args: args ? named(args).map((a) => txt(a, src).replace(/\s+/g, ' ').trim()) : [], line: line(node), condition: condition || null, await: node.parent && node.parent.type === 'await_expression' });
  }
  for (let i = 0; i < node.namedChildCount; i++) recordCalls(node.namedChild(i), src, calls, condition, depth + 1);
}

function cleanType(t) { return t ? t.replace(/^:\s*/, '').replace(/\s+/g, ' ').trim() : null; }
function inferType(valueNode, src) {
  if (!valueNode) return null;
  const t = valueNode.type;
  if (t === 'number') return 'number';
  if (t === 'string' || t === 'template_string') return 'string';
  if (t === 'true' || t === 'false') return 'boolean';
  if (t === 'array') return 'array';
  if (t === 'object') return 'object';
  if (t === 'arrow_function' || t === 'function' || t === 'function_expression') return 'function';
  if (t === 'new_expression') { const c = field(valueNode, 'constructor'); return c ? cleanType(txt(c, src)) : null; }
  if (t === 'await_expression') { const inner = valueNode.namedChild(0); return inner ? inferType(inner, src) : null; }
  if (t === 'call_expression') { const fn = field(valueNode, 'function'); if (fn && fn.type === 'identifier' && /^use[A-Z]/.test(txt(fn, src))) return txt(fn, src); }
  return null;
}

// ---- params (incl. destructured + typed) ----
function extractParams(paramsNode, src) {
  if (!paramsNode) return [];
  const out = [];
  for (const p of named(paramsNode)) {
    if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
      const pat = field(p, 'pattern') || firstOfType(p, 'identifier') || firstOfType(p, 'object_pattern') || firstOfType(p, 'array_pattern');
      const typ = field(p, 'type');
      if (pat && pat.type === 'object_pattern') { for (const k of named(pat)) { const nm = k.type.includes('shorthand') ? txt(k, src) : (field(k, 'key') ? txt(field(k, 'key'), src) : txt(k, src)); out.push({ name: nm, type: null, destructured: true }); } }
      else out.push({ name: pat ? txt(pat, src) : txt(p, src), type: typ ? cleanType(txt(typ, src)) : null });
    } else if (p.type === 'identifier') out.push({ name: txt(p, src), type: null });
    else if (p.type === 'object_pattern') { for (const k of named(p)) { const nm = k.type.includes('shorthand') ? txt(k, src) : (field(k, 'key') ? txt(field(k, 'key'), src) : txt(k, src)); out.push({ name: nm, type: null, destructured: true }); } }
  }
  return out;
}

// ---- imports / exports ----
function parseImports(root, src) {
  const imports = [];
  for (const s of named(root)) {
    if (s.type === 'import_statement') {
      const sourceNode = field(s, 'source') || descendants(s, ['string'])[0];
      const source = sourceNode ? txt(sourceNode, src).replace(/^['"`]|['"`]$/g, '') : null;
      const names = [];
      for (const spec of descendants(s, ['import_specifier', 'namespace_import', 'identifier'])) {
        if (spec.type === 'import_specifier') { const nm = field(spec, 'name') || spec.namedChild(0); if (nm) names.push(txt(nm, src)); }
        else if (spec.type === 'identifier' && spec.parent && spec.parent.type === 'import_clause') names.push(txt(spec, src)); // default import
      }
      if (source) imports.push({ source, names, line: line(s) });
    }
  }
  return imports;
}

// ---- framework + stereotype detection from imports/annotations ----
function detectFramework(imports, filePath, src) {
  const sources = imports.map((i) => i.source);
  if (sources.some((s) => /^next(\/|$)/.test(s)) || /\/(app|pages)\//.test(filePath)) return 'next';
  if (sources.some((s) => /^(express|@nestjs|koa|fastify)/.test(s))) return 'express';
  if (sources.some((s) => /^react|^next/.test(s)) || /\.(tsx|jsx)$/.test(filePath)) return 'react';
  if (sources.some((s) => /@supabase/.test(s))) return 'supabase';
  return null;
}

// ---- API call detection (fetch/axios/api-wrappers) ----
function detectApiCalls(method, src) {
  const apis = [];
  for (const c of method.calls) {
    const nm = c.name, recv = (c.receiver || '');
    let httpMethod = null, url = null;
    if (nm === 'fetch') { httpMethod = methodFromArgs(c.args) || 'GET'; url = urlFromArg(c.args[0]); }
    else if (/^(get|post|put|patch|delete)$/i.test(nm) && /axios|api|client|http|\$/.test(recv)) { httpMethod = nm.toUpperCase(); url = urlFromArg(c.args[0]); }
    else if (recv === 'axios' && /^(get|post|put|patch|delete)$/i.test(nm)) { httpMethod = nm.toUpperCase(); url = urlFromArg(c.args[0]); }
    if (url) apis.push({ method: httpMethod, url, line: c.line, args: c.args, callName: nm, receiver: c.receiver });
  }
  return apis;
}
function methodFromArgs(args) {
  const opt = (args || []).join(' ');
  const m = /method\s*:\s*['"`](\w+)['"`]/i.exec(opt);
  return m ? m[1].toUpperCase() : null;
}
function urlFromArg(arg) {
  if (!arg) return null;
  let s = String(arg).trim();
  const m = /^[`'"]([^`'"]+)[`'"]/.exec(s);
  if (m) return m[1];
  // template literal `/api/x/${id}` -> normalize interpolations to *
  const tm = /^`([^`]+)`/.exec(s);
  if (tm) return tm[1].replace(/\$\{[^}]+\}/g, '*');
  return null;
}

// ---- DB access detection (Supabase / Prisma / common ORMs) ----
function detectDbAccess(method, src) {
  const hits = [];
  // NOTE: method chains are emitted outermost-first (e.g. single, eq, select, from),
  // so `from(...)` (which names the table) appears AFTER select/insert in method.calls.
  // Two passes: (1) create a table hit per supabase.from() / prisma model, keyed by line;
  // (2) attach the real op + columns from the select/insert/update/delete call on that line.
  const supaByLine = new Map(); // line -> hit
  for (const c of method.calls) {
    const nm = c.name; const recv = (c.receiver || '');
    if (nm === 'from' && /supabase|client|db|sb/i.test(recv)) {
      const table = strArg(c.args[0]);
      if (table) { const hit = { orm: 'supabase', table, op: 'select', columns: [], line: c.line }; hits.push(hit); supaByLine.set(c.line, hit); }
    }
    // prisma: prisma.employee.findMany/create/update/delete
    if (/^(findMany|findFirst|findUnique|create|createMany|update|updateMany|delete|deleteMany|upsert|count|aggregate)$/.test(nm) && /(?:prisma|db|client)\.\w+$/.test(recv)) {
      const m = /(?:prisma|db|client)\.(\w+)$/.exec(recv);
      if (m) { const hit = { orm: 'prisma', table: m[1], op: nm, columns: objectKeys(c.args[0]), line: c.line }; hits.push(hit); }
    }
  }
  // second pass: assign op + columns to the supabase hit sharing the same line
  for (const c of method.calls) {
    const nm = c.name;
    if (/^(select|insert|update|delete|upsert)$/.test(nm)) {
      const near = supaByLine.get(c.line) || hits.slice().reverse().find((hh) => hh.orm === 'supabase' && Math.abs(hh.line - c.line) <= 6);
      if (near) {
        near.op = nm;
        if (nm === 'select') { const cols = strArg(c.args[0]); if (cols) near.columns = cols.split(',').map((s) => s.trim()).filter((s) => s && s !== '*'); }
        else if (nm === 'insert' || nm === 'update' || nm === 'upsert') { const k = objectKeys(c.args[0]); if (k.length) near.columns = k; }
      }
    } else if (nm === 'rpc' && /supabase|client|db|sb/i.test(c.receiver || '')) {
      hits.push({ orm: 'supabase', table: strArg(c.args[0]), op: 'rpc', columns: [], line: c.line });
    }
  }
  return hits;
}
// extract keys from an object-literal argument string: "{a: x, b, c: y}" -> [a,b,c]
// handles both explicit (`a: x`) and shorthand (`b`) properties.
function objectKeys(arg) {
  if (!arg) return [];
  let s = String(arg).trim();
  const om = /\{([\s\S]*)\}/.exec(s); if (!om) return [];
  const inner = om[1];
  const keys = [];
  let depth = 0, cur = '';
  const flush = () => {
    const part = cur.trim(); cur = '';
    if (!part) return;
    const key = part.split(':')[0].trim().replace(/^\.\.\./, '');
    if (/^[a-zA-Z_$][\w$]*$/.test(key)) keys.push(key);
  };
  for (const ch of inner) {
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) { flush(); continue; }
    cur += ch;
  }
  flush();
  return keys;
}
function strArg(a) { if (!a) return null; const m = /^[`'"]([^`'"]+)[`'"]/.exec(String(a).trim()); return m ? m[1] : null; }

// ---- React component detection ----
function looksLikeComponent(name, method, src) {
  if (!/^[A-Z]/.test(name)) return false;
  // returns JSX
  return method.returns.some((r) => r.expr && /jsx|<[A-Za-z]/.test(r.expr.kind + ' ' + (r.expr.raw || '')));
}

// ---- build a "method" record from a function-ish node ----
function buildMethod(name, node, src, opts = {}) {
  const paramsNode = field(node, 'parameters') || firstOfType(node, 'formal_parameters');
  const retNode = field(node, 'return_type');
  const bodyNode = field(node, 'body') || firstOfType(node, 'statement_block');
  const body = analyzeBody(bodyNode, src);
  // arrow function with expression body: const f = () => expr
  if (!bodyNode && node.type === 'arrow_function') {
    const b = field(node, 'body');
    if (b && b.type !== 'statement_block') body.returns.push({ expr: describeExpr(b, src), line: line(b), condition: null });
  }
  const m = {
    name, isConstructor: name === 'constructor',
    returnType: retNode ? cleanType(txt(retNode, src)) : inferReturn(body, src),
    visibility: opts.visibility || 'public', annotations: opts.annotations || [],
    params: extractParams(paramsNode, src), line: line(node), endLine: endLine(node), col: node.startPosition.column + 1,
    async: /async/.test(txt(node, src).slice(0, 12)),
    ...body,
  };
  m.apiCalls = detectApiCalls(m, src);
  m.dbAccess = detectDbAccess(m, src);
  m.isComponent = looksLikeComponent(name, m, src);
  return m;
}
function inferReturn(body, src) {
  const r = body.returns.find((x) => x.expr && x.expr.type !== undefined);
  if (!r || !r.expr) return 'any';
  return inferType({ type: r.expr.kind }, src) || 'any';
}

// ---- top-level: analyze one TS/TSX/JS file ----
export async function analyzeTsFile(filePath, src, langId) {
  const entry = await getParser(langId || 'typescript');
  if (!entry) return null;
  let tree; try { tree = entry.parser.parse(src); } catch { return null; }
  if (!tree) return null;
  const root = tree.rootNode;
  const imports = parseImports(root, src);
  const framework = detectFramework(imports, filePath, src);
  const pkg = filePath.replace(/\.[^.]+$/, '').replace(/\//g, '.');
  const classes = [];
  const moduleMethods = [];   // top-level functions -> synthetic module class
  const moduleFields = [];    // top-level consts

  const exported = new Set();
  const handleDecl = (node, isExport) => {
    switch (node.type) {
      case 'class_declaration': case 'abstract_class_declaration': {
        classes.push(extractClass(node, src, pkg, filePath, framework));
        break;
      }
      case 'interface_declaration': {
        const nm = field(node, 'name'); const name = nm ? txt(nm, src) : '(anon)';
        const fields = [];
        const body = field(node, 'body') || firstOfType(node, 'object_type') || firstOfType(node, 'interface_body');
        if (body) for (const m of named(body)) { if (m.type === 'property_signature') { const pn = field(m, 'name'); const pt = field(m, 'type'); fields.push({ name: pn ? txt(pn, src) : '?', type: pt ? cleanType(txt(pt, src)) : null, columnName: null, annotations: [], visibility: 'public', line: line(m) }); } }
        classes.push({ name, fqn: pkg + '.' + name, kind: 'interface', stereotype: 'dto', tableName: null, annotations: [], extends: null, implements: [], fields, methods: [], line: line(node), endLine: endLine(node), file: filePath });
        break;
      }
      case 'type_alias_declaration': {
        const nm = field(node, 'name'); const name = nm ? txt(nm, src) : '(anon)';
        const val = field(node, 'value'); const fields = [];
        if (val && (val.type === 'object_type')) for (const m of named(val)) { if (m.type === 'property_signature') { const pn = field(m, 'name'); const pt = field(m, 'type'); fields.push({ name: pn ? txt(pn, src) : '?', type: pt ? cleanType(txt(pt, src)) : null, columnName: null, annotations: [], visibility: 'public', line: line(m) }); } }
        classes.push({ name, fqn: pkg + '.' + name, kind: 'type', stereotype: 'dto', tableName: null, annotations: [], extends: null, implements: [], fields, methods: [], line: line(node), endLine: endLine(node), file: filePath });
        break;
      }
      case 'enum_declaration': {
        const nm = field(node, 'name'); const name = nm ? txt(nm, src) : '(anon)';
        classes.push({ name, fqn: pkg + '.' + name, kind: 'enum', stereotype: null, tableName: null, annotations: [], extends: null, implements: [], fields: [], methods: [], line: line(node), endLine: endLine(node), file: filePath });
        break;
      }
      case 'function_declaration': case 'generator_function_declaration': {
        const nm = field(node, 'name'); if (nm) moduleMethods.push(buildMethod(txt(nm, src), node, src));
        break;
      }
      case 'lexical_declaration': case 'variable_declaration': {
        for (const d of named(node).filter((c) => c.type === 'variable_declarator')) {
          const nameNode = field(d, 'name'); const valueNode = field(d, 'value');
          if (!nameNode) continue;
          if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function' || valueNode.type === 'function_expression')) {
            if (nameNode.type === 'identifier') moduleMethods.push(buildMethod(txt(nameNode, src), valueNode, src));
          } else if (nameNode.type === 'identifier') {
            const typeNode = field(d, 'type');
            moduleFields.push({ name: txt(nameNode, src), type: typeNode ? cleanType(txt(typeNode, src)) : inferType(valueNode, src), columnName: null, annotations: [], visibility: 'public', line: line(d), init: valueNode ? describeExpr(valueNode, src) : null });
          }
        }
        break;
      }
    }
  };

  for (const node of named(root)) {
    if (node.type === 'export_statement') {
      const decl = field(node, 'declaration') || named(node).find((c) => /declaration|lexical/.test(c.type));
      if (decl) handleDecl(decl, true);
    } else handleDecl(node, false);
  }

  // wrap module-scope functions/consts into a synthetic "module" class so the
  // rest of the pipeline (which is class/method oriented) works uniformly.
  if (moduleMethods.length || moduleFields.length) {
    const modName = fileBaseName(filePath);
    const stereotype = moduleStereotype(filePath, framework, moduleMethods);
    classes.unshift({
      name: modName, fqn: pkg, kind: 'module', stereotype, tableName: null, annotations: [],
      extends: null, implements: [], fields: moduleFields, methods: moduleMethods,
      line: 1, endLine: endLine(root), file: filePath, isModule: true, framework,
    });
  }
  // tag react component methods' stereotype at class level too
  for (const c of classes) { if (c.methods.some((m) => m.isComponent)) c.stereotype = c.stereotype || 'component'; }

  tree.delete?.();
  const routes = detectRoutesFromModel(classes, filePath, framework, src);
  const apiCalls = classes.flatMap((c) => c.methods.flatMap((m) => (m.apiCalls || []).map((a) => Object.assign({}, a, { method2: c.fqn + '.' + m.name, methodId: null, file: filePath }))));
  const dbAccess = classes.flatMap((c) => c.methods.flatMap((m) => (m.dbAccess || []).map((d) => Object.assign({}, d, { file: filePath, inMethod: c.fqn + '.' + m.name }))));
  return { path: filePath, package: pkg, imports, classes, framework, routes, apiCalls, dbAccess };
}

function fileBaseName(p) { return p.split('/').pop().replace(/\.[^.]+$/, ''); }
function moduleStereotype(filePath, framework, methods) {
  const p = filePath.toLowerCase();
  if (/controller/.test(p)) return 'controller';
  if (/service/.test(p)) return 'service';
  if (/repositor|dao|\.repo\./.test(p)) return 'repository';
  if (/route|\/api\//.test(p)) return 'controller';
  if (methods.some((m) => m.isComponent)) return 'component';
  if (methods.some((m) => (m.apiCalls || []).length)) return 'api-client';
  if (/\.(tsx|jsx)$/.test(p)) return 'component';
  return null;
}

// ---- ES class extraction ----
function extractClass(node, src, pkg, filePath, framework) {
  const nm = field(node, 'name'); const name = nm ? txt(nm, src) : '(anon)';
  const heritage = descendants(node, ['class_heritage'])[0];
  let ext = null; const impls = [];
  if (heritage) {
    const extClause = firstOfType(heritage, 'extends_clause');
    if (extClause) { const t = extClause.namedChild(0); if (t) ext = txt(t, src); }
    const implClause = firstOfType(heritage, 'implements_clause');
    if (implClause) for (const t of named(implClause)) impls.push(txt(t, src).replace(/<.*>/, ''));
  }
  const decorators = descendants(node, ['decorator']).filter((d) => d.parent === node || (d.parent && d.parent.parent === node)).map((d) => ({ name: txt(d, src).replace(/^@/, '').replace(/\(.*/, ''), args: (txt(d, src).match(/\((.*)\)/s) || [])[1] || '', line: line(d) }));
  const stereotype = decorators.map((a) => ({ Controller: 'controller', RestController: 'controller', Injectable: 'service', Service: 'service', Entity: 'entity', Repository: 'repository', Component: 'component' })[a.name]).find(Boolean) || null;
  const fqn = pkg + '.' + name;
  const fields = []; const methods = [];
  const body = field(node, 'body') || firstOfType(node, 'class_body');
  if (body) for (const m of named(body)) {
    if (m.type === 'public_field_definition' || m.type === 'field_definition' || m.type === 'property_definition') {
      const pn = field(m, 'name'); const pt = field(m, 'type'); const pv = field(m, 'value');
      if (pv && (pv.type === 'arrow_function' || pv.type === 'function')) methods.push(buildMethod(pn ? txt(pn, src) : '?', pv, src));
      else fields.push({ name: pn ? txt(pn, src) : '?', type: pt ? cleanType(txt(pt, src)) : inferType(pv, src), columnName: null, annotations: [], visibility: 'public', line: line(m) });
    } else if (m.type === 'method_definition') {
      const pn = field(m, 'name');
      methods.push(buildMethod(pn ? txt(pn, src) : '?', m, src));
    }
  }
  return { name, fqn, kind: 'class', stereotype, tableName: null, annotations: decorators, extends: ext, implements: impls, fields, methods, line: line(node), endLine: endLine(node), file: filePath };
}

// ---- route detection (Next.js file-based + Express router + decorators) ----
function detectRoutesFromModel(classes, filePath, framework, src) {
  const routes = [];
  const p = filePath.replace(/\\/g, '/');
  // Next app router: app/**/route.ts with exported GET/POST/...
  let m = p.match(/(?:^|\/)(?:src\/)?app\/(.*)\/route\.(ts|js|tsx|jsx)$/);
  if (m) {
    const routePath = '/' + m[1].replace(/\([^)]*\)\//g, '').replace(/\[\.\.\.([^\]]+)\]/g, '*').replace(/\[([^\]]+)\]/g, ':$1');
    for (const c of classes) for (const mm of c.methods) if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(mm.name)) routes.push({ method: mm.name, path: routePath, framework: 'next-app', file: filePath, line: mm.line, handler: c.fqn + '.' + mm.name, evidence: 'VERIFIED_NEXT_ROUTE' });
    if (!routes.length) routes.push({ method: 'GET', path: routePath, framework: 'next-app', file: filePath, line: 1, evidence: 'VERIFIED_NEXT_ROUTE' });
  }
  // Next pages/api
  m = p.match(/(?:^|\/)(?:src\/)?pages\/api\/(.*)\.(ts|js)$/);
  if (m) { const routePath = '/api/' + m[1].replace(/\/index$/, '').replace(/\[([^\]]+)\]/g, ':$1'); routes.push({ method: 'ANY', path: routePath, framework: 'next-pages', file: filePath, line: 1, evidence: 'VERIFIED_NEXT_ROUTE' }); }
  // Express: router.post('/x', handler) — scan calls in module methods
  for (const c of classes) for (const mm of c.methods) for (const call of mm.calls) {
    if (/^(get|post|put|patch|delete|use|all)$/i.test(call.name) && /router|app|route/i.test(call.receiver || '')) {
      const rp = strArg(call.args[0]);
      if (rp && rp.startsWith('/')) routes.push({ method: call.name.toUpperCase(), path: rp, framework: 'express', file: filePath, line: call.line, evidence: 'VERIFIED_HTTP_ROUTE' });
    }
  }
  return routes;
}
