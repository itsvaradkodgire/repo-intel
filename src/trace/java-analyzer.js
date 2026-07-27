/**
 * java-analyzer.js — Phase (Trace Engine) deep Java/Spring symbol + body analyzer.
 *
 * A structural tree-sitter walk (not queries) over each Java file that extracts,
 * with source locations, everything the tracing engine needs BELOW the function
 * level:
 *   package, imports
 *   classes/interfaces/enums/records: annotations, extends, implements, Spring
 *     stereotype (controller/service/repository/entity/component), JPA table
 *   fields: name, declared type, annotations, @Column name, visibility
 *   methods/constructors: return type, params (name+type), visibility, annotations
 *   method bodies: local variable declarations (name, type, initializer expr),
 *     assignments, method invocations (with receiver + args), return statements,
 *     and the enclosing control-flow condition of each of these.
 *
 * Everything is grammar-based and carries file:line so nothing is asserted
 * without evidence. This is the reference deep implementation for Java; other
 * languages keep their existing shallower extraction.
 */
import { getParser } from '../analyzer/languages.js';

const STEREOTYPE_ANNOTATIONS = {
  RestController: 'controller', Controller: 'controller',
  Service: 'service', Repository: 'repository', Component: 'component',
  Entity: 'entity', Configuration: 'configuration',
};

function txt(node, src) { return node ? src.slice(node.startIndex, node.endIndex) : ''; }
function line(node) { return node.startPosition.row + 1; }
function endLine(node) { return node.endPosition.row + 1; }
function col(node) { return node.startPosition.column + 1; }

// child by field name (tree-sitter-java uses fields like name/type/body/...)
function field(node, name) { return node.childForFieldName ? node.childForFieldName(name) : null; }
function namedChildren(node) { const out = []; for (let i = 0; i < node.namedChildCount; i++) out.push(node.namedChild(i)); return out; }
function childrenOfType(node, type) { return namedChildren(node).filter((c) => c.type === type); }
function firstOfType(node, type) { for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c.type === type) return c; } return null; }

// ---- annotations ----
function parseAnnotations(modifiersNode, src) {
  if (!modifiersNode) return [];
  const anns = [];
  for (const c of namedChildren(modifiersNode)) {
    if (c.type === 'annotation' || c.type === 'marker_annotation') {
      const nameNode = field(c, 'name') || firstOfType(c, 'identifier') || c.namedChild(0);
      const name = nameNode ? txt(nameNode, src).replace(/^@/, '') : '';
      const argsNode = field(c, 'arguments');
      const args = argsNode ? txt(argsNode, src) : '';
      anns.push({ name, args, line: line(c) });
    }
  }
  return anns;
}
function visibilityOf(modifiersNode, src) {
  if (!modifiersNode) return 'package';
  const t = txt(modifiersNode, src);
  if (/\bpublic\b/.test(t)) return 'public';
  if (/\bprivate\b/.test(t)) return 'private';
  if (/\bprotected\b/.test(t)) return 'protected';
  return 'package';
}
// @Column(name = "x") -> x  ;  @Table(name = "y") -> y
function annotationArg(anns, annName, key) {
  const a = anns.find((x) => x.name === annName);
  if (!a || !a.args) return null;
  const re = new RegExp(key + '\\s*=\\s*"([^"]+)"');
  const m = a.args.match(re);
  if (m) return m[1];
  const bare = a.args.match(/^\s*\(?\s*"([^"]+)"/);
  return bare ? bare[1] : null;
}

// ---- expression classification (for data-flow + calculation extraction) ----
// Returns a compact, source-derived description of an expression node.
function describeExpr(node, src) {
  if (!node) return null;
  const raw = txt(node, src).replace(/\s+/g, ' ').trim();
  const info = { kind: node.type, raw, refs: [], calls: [], op: null, operands: [] };
  collectRefsAndCalls(node, src, info);

  if (node.type === 'binary_expression') {
    const l = field(node, 'left'), op = field(node, 'operator'), r = field(node, 'right');
    info.op = op ? txt(op, src) : null;
    info.operands = [describeOperand(l, src), describeOperand(r, src)];
  } else if (node.type === 'method_invocation') {
    // chained arithmetic via BigDecimal: a.divide(b) / a.multiply(b) / a.subtract(b) / a.add(b)
    const nm = field(node, 'name'); const obj = field(node, 'object'); const args = field(node, 'arguments');
    const method = nm ? txt(nm, src) : '';
    const ARITH = { divide: '/', multiply: '×', subtract: '-', add: '+' };
    if (ARITH[method] && obj) {
      info.op = ARITH[method];
      const argList = args ? namedChildren(args) : [];
      info.operands = [describeOperand(obj, src), argList.length ? describeOperand(argList[0], src) : null];
    }
  }
  return info;
}
function describeOperand(node, src) {
  if (!node) return null;
  // unwrap BigDecimal.valueOf(x) / new BigDecimal("x") to the inner token
  if (node.type === 'method_invocation') {
    const nm = field(node, 'name'); const args = field(node, 'arguments');
    if (nm && txt(nm, src) === 'valueOf' && args) { const a = namedChildren(args)[0]; if (a) return txt(a, src).replace(/\s+/g, ' '); }
    // a chained arithmetic operand: keep as raw
  }
  if (node.type === 'object_creation_expression') {
    const args = field(node, 'arguments'); if (args) { const a = namedChildren(args)[0]; if (a) return txt(a, src).replace(/^["']|["']$/g, ''); }
  }
  return txt(node, src).replace(/\s+/g, ' ').trim();
}
function collectRefsAndCalls(node, src, info, depth = 0) {
  if (!node || depth > 40) return;
  if (node.type === 'identifier') {
    const t = txt(node, src);
    if (t && !info.refs.includes(t)) info.refs.push(t);
    return;
  }
  if (node.type === 'method_invocation') {
    const nm = field(node, 'name'); const obj = field(node, 'object');
    if (nm) info.calls.push({ name: txt(nm, src), receiver: obj ? txt(obj, src) : null, line: line(node) });
    // still descend into object + args to capture nested refs
  }
  for (let i = 0; i < node.namedChildCount; i++) collectRefsAndCalls(node.namedChild(i), src, info, depth + 1);
}

// ---- method body walk: locals, assignments, calls, returns, with conditions ----
function analyzeBody(bodyNode, src, ctx) {
  const locals = [];      // {name, type, line, init: describeExpr, condition}
  const assignments = []; // {target, expr: describeExpr, line, condition}
  const calls = [];       // {name, receiver, args:[raw], line, condition}
  const returns = [];     // {expr: describeExpr, line, condition}
  if (!bodyNode) return { locals, assignments, calls, returns };

  const walk = (node, condition) => {
    if (!node) return;
    switch (node.type) {
      case 'local_variable_declaration': {
        const typeNode = field(node, 'type');
        const typeName = typeNode ? txt(typeNode, src) : null;
        for (const d of childrenOfType(node, 'variable_declarator')) {
          const nameNode = field(d, 'name');
          const valueNode = field(d, 'value');
          locals.push({
            name: nameNode ? txt(nameNode, src) : '?',
            type: typeName, line: line(d),
            init: valueNode ? describeExpr(valueNode, src) : null,
            condition: condition || null,
          });
          if (valueNode) recordCallsIn(valueNode, src, calls, condition);
        }
        return;
      }
      case 'expression_statement': {
        const inner = node.namedChild(0);
        if (inner && inner.type === 'assignment_expression') {
          const l = field(inner, 'left'), r = field(inner, 'right');
          assignments.push({ target: l ? txt(l, src).replace(/\s+/g, '') : '?', expr: r ? describeExpr(r, src) : null, line: line(inner), condition: condition || null });
          if (r) recordCallsIn(r, src, calls, condition);
        } else if (inner) {
          recordCallsIn(inner, src, calls, condition);
        }
        return;
      }
      case 'return_statement': {
        const e = node.namedChild(0);
        returns.push({ expr: e ? describeExpr(e, src) : null, line: line(node), condition: condition || null });
        if (e) recordCallsIn(e, src, calls, condition);
        return;
      }
      case 'if_statement': {
        const cond = field(node, 'condition');
        const conseq = field(node, 'consequence');
        const alt = field(node, 'alternative');
        const condText = cond ? txt(cond, src).replace(/\s+/g, ' ').replace(/^\(|\)$/g, '') : null;
        walk(conseq, condText);
        if (alt) walk(alt, condText ? '!(' + condText + ')' : null);
        return;
      }
      case 'for_statement': case 'enhanced_for_statement': case 'while_statement': case 'do_statement': {
        const body = field(node, 'body');
        walk(body, condition);
        return;
      }
      case 'switch_expression': case 'switch_statement': {
        for (const c of namedChildren(node)) walk(c, condition);
        return;
      }
      case 'try_statement': {
        for (const c of namedChildren(node)) walk(c, condition);
        return;
      }
      default: {
        for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i), condition);
      }
    }
  };
  walk(bodyNode, null);
  return { locals, assignments, calls, returns };
}

function recordCallsIn(node, src, calls, condition, depth = 0) {
  if (!node || depth > 40) return;
  if (node.type === 'method_invocation') {
    const nm = field(node, 'name'); const obj = field(node, 'object'); const args = field(node, 'arguments');
    calls.push({
      name: nm ? txt(nm, src) : '?',
      receiver: obj ? txt(obj, src).replace(/\s+/g, '') : null,
      args: args ? namedChildren(args).map((a) => txt(a, src).replace(/\s+/g, ' ').trim()) : [],
      line: line(node), condition: condition || null,
    });
  }
  for (let i = 0; i < node.namedChildCount; i++) recordCallsIn(node.namedChild(i), src, calls, condition, depth + 1);
}

// ---- class member extraction ----
function extractClass(node, src, pkg, filePath) {
  const kindMap = { class_declaration: 'class', interface_declaration: 'interface', enum_declaration: 'enum', record_declaration: 'record' };
  const kind = kindMap[node.type] || 'class';
  const nameNode = field(node, 'name');
  const name = nameNode ? txt(nameNode, src) : '(anonymous)';
  const modifiers = firstOfType(node, 'modifiers');
  const annotations = parseAnnotations(modifiers, src);
  const stereotype = annotations.map((a) => STEREOTYPE_ANNOTATIONS[a.name]).find(Boolean) || null;

  // extends / implements
  let ext = null; const impls = [];
  const superclass = field(node, 'superclass');
  if (superclass) { const ti = firstOfType(superclass, 'type_identifier') || superclass.namedChild(0); if (ti) ext = txt(ti, src); }
  const interfaces = field(node, 'interfaces') || firstOfType(node, 'super_interfaces');
  if (interfaces) {
    const list = firstOfType(interfaces, 'type_list') || interfaces;
    for (const t of namedChildren(list)) { const tt = txt(t, src).replace(/<.*>/, ''); if (tt && tt !== ',') impls.push(tt); }
  }
  // records: implicit fields from parameters
  const fqn = pkg ? pkg + '.' + name : name;
  const tableName = annotationArg(annotations, 'Table', 'name') || (stereotype === 'entity' ? snake(name) : null);

  const fields = [];
  const methods = [];
  const body = field(node, 'body') || firstOfType(node, 'class_body') || firstOfType(node, 'interface_body') || firstOfType(node, 'enum_body');

  // record header parameters become fields
  const recordParams = field(node, 'parameters');
  if (kind === 'record' && recordParams) {
    for (const p of childrenOfType(recordParams, 'formal_parameter')) {
      const pt = field(p, 'type'); const pn = field(p, 'name');
      fields.push({ name: pn ? txt(pn, src) : '?', type: pt ? txt(pt, src) : null, annotations: [], columnName: null, visibility: 'private', line: line(p) });
    }
  }

  if (body) {
    for (const m of namedChildren(body)) {
      if (m.type === 'field_declaration') {
        const mods = firstOfType(m, 'modifiers');
        const anns = parseAnnotations(mods, src);
        const typeNode = field(m, 'type');
        const typeName = typeNode ? txt(typeNode, src) : null;
        for (const d of childrenOfType(m, 'variable_declarator')) {
          const dn = field(d, 'name');
          fields.push({
            name: dn ? txt(dn, src) : '?', type: typeName, annotations: anns,
            columnName: annotationArg(anns, 'Column', 'name'),
            visibility: visibilityOf(mods, src), line: line(d),
          });
        }
      } else if (m.type === 'method_declaration' || m.type === 'constructor_declaration') {
        const mods = firstOfType(m, 'modifiers');
        const anns = parseAnnotations(mods, src);
        const isCtor = m.type === 'constructor_declaration';
        const mn = field(m, 'name');
        const retNode = field(m, 'type');
        const params = extractParams(field(m, 'parameters') || firstOfType(m, 'formal_parameters'), src);
        const mbody = field(m, 'body');
        const bodyInfo = analyzeBody(mbody, src, { fqn });
        methods.push({
          name: mn ? txt(mn, src) : name, isConstructor: isCtor,
          returnType: isCtor ? name : (retNode ? txt(retNode, src) : 'void'),
          visibility: visibilityOf(mods, src), annotations: anns,
          params, line: line(m), endLine: endLine(m), col: col(m),
          ...bodyInfo,
        });
      }
    }
  }

  return { name, fqn, kind, stereotype, annotations, extends: ext, implements: impls, tableName, fields, methods, line: line(node), endLine: endLine(node), file: filePath };
}

function extractParams(paramsNode, src) {
  if (!paramsNode) return [];
  const out = [];
  for (const p of namedChildren(paramsNode)) {
    if (p.type === 'formal_parameter' || p.type === 'spread_parameter') {
      const pt = field(p, 'type'); const pn = field(p, 'name');
      out.push({ name: pn ? txt(pn, src) : '?', type: pt ? txt(pt, src) : null });
    }
  }
  return out;
}

function snake(s) { return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(); }

// ---- top-level: analyze one Java file ----
export async function analyzeJavaFile(filePath, src) {
  const entry = await getParser('java');
  if (!entry) return null;
  let tree;
  try { tree = entry.parser.parse(src); } catch { return null; }
  if (!tree) return null;
  const root = tree.rootNode;

  let pkg = null;
  const imports = [];
  const classes = [];
  const walkTop = (node) => {
    for (const c of namedChildren(node)) {
      if (c.type === 'package_declaration') { pkg = txt(c, src).replace(/^package\s+/, '').replace(/;$/, '').trim(); }
      else if (c.type === 'import_declaration') {
        const raw = txt(c, src).replace(/^import\s+(static\s+)?/, '').replace(/;$/, '').trim();
        imports.push({ fqn: raw, simpleName: raw.split('.').pop() });
      }
      else if (c.type === 'class_declaration' || c.type === 'interface_declaration' || c.type === 'enum_declaration' || c.type === 'record_declaration') {
        classes.push(extractClass(c, src, pkg, filePath));
      }
    }
  };
  walkTop(root);
  tree.delete?.();
  return { path: filePath, package: pkg, imports, classes };
}
