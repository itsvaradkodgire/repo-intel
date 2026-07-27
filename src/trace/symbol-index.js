/**
 * symbol-index.js — cross-file Java symbol index + precise (type-aware) call graph.
 *
 * Consumes the per-file output of java-analyzer.js and builds:
 *   symbols        every class/method/field/param with a STABLE id + FQN + types
 *   typeIndex      simpleName/FQN -> class symbol
 *   methodsByClass classFqn -> [method symbols]
 *   callGraph      caller methodId -> [{ calleeId, evidence, confidence }]
 *   diBindings     interface FQN -> [implementing class FQNs]  (Spring DI)
 *   fieldTypes     per class: fieldName -> resolved class FQN (for receiver typing)
 *
 * Call resolution is type-aware:
 *   receiver is `this.x` or `x` where x is a field/param/local of known type T
 *     -> resolve method on T (and, if T is an interface, on its implementations)
 *   receiver is a ClassName (static) -> resolve on that class
 *   no receiver -> resolve on the containing class hierarchy
 * Every resolved edge records HOW it was resolved (evidence) and a confidence.
 */

export function buildSymbolIndex(javaFiles) {
  const classes = [];               // all class symbols
  const typeBySimple = new Map();    // simpleName -> [classSymbol]
  const typeByFqn = new Map();       // fqn -> classSymbol
  const methods = [];                // all method symbols (flat)
  const methodsById = new Map();
  const symbols = [];                // everything clickable

  // ---- 1. materialize class + member symbols with stable ids ----
  for (const jf of javaFiles) {
    for (const c of jf.classes) {
      const classId = 'class:' + c.fqn;
      const classSym = {
        id: classId, kind: c.kind, name: c.name, fqn: c.fqn, file: c.file, line: c.line, endLine: c.endLine,
        stereotype: c.stereotype, annotations: c.annotations, extends: c.extends, implements: c.implements || [],
        tableName: c.tableName, fields: [], methods: [], imports: jf.imports, package: jf.package,
      };
      classes.push(classSym);
      typeByFqn.set(c.fqn, classSym);
      if (!typeBySimple.has(c.name)) typeBySimple.set(c.name, []);
      typeBySimple.get(c.name).push(classSym);
      symbols.push({ id: classId, kind: c.kind, name: c.name, fqn: c.fqn, file: c.file, line: c.line });

      // fields
      for (const f of c.fields) {
        const fid = 'field:' + c.fqn + '#' + f.name;
        const fieldSym = { id: fid, kind: 'field', name: f.name, type: f.type, columnName: f.columnName, annotations: f.annotations, visibility: f.visibility, file: c.file, line: f.line, containingClass: c.fqn, tableName: c.tableName };
        classSym.fields.push(fieldSym);
        symbols.push(fieldSym);
      }
      // methods
      for (const m of c.methods) {
        const sig = m.name + '(' + m.params.map((p) => p.type || '?').join(',') + ')';
        const mid = 'method:' + c.fqn + '#' + sig;
        const methodSym = {
          id: mid, kind: m.isConstructor ? 'constructor' : 'method', name: m.name, signature: sig,
          fqn: c.fqn + '.' + m.name, returnType: m.returnType, visibility: m.visibility, annotations: m.annotations,
          params: m.params, file: c.file, line: m.line, endLine: m.endLine, col: m.col, containingClass: c.fqn,
          containingStereotype: c.stereotype,
          locals: m.locals, assignments: m.assignments, calls: m.calls, returns: m.returns,
        };
        classSym.methods.push(methodSym);
        methods.push(methodSym);
        methodsById.set(mid, methodSym);
        symbols.push({ id: mid, kind: methodSym.kind, name: m.name, signature: sig, fqn: methodSym.fqn, file: c.file, line: m.line, returnType: m.returnType, params: m.params, containingClass: c.fqn });
        // params as symbols
        for (const p of m.params) symbols.push({ id: mid + '/param:' + p.name, kind: 'parameter', name: p.name, type: p.type, file: c.file, line: m.line, containingMethod: mid });
      }
    }
  }

  // ---- 2. DI bindings: interface -> implementations ----
  const diBindings = new Map(); // interfaceFqn -> [implClassSymbol]
  for (const c of classes) {
    for (const iface of c.implements) {
      // resolve iface simple name to a known interface class
      const targets = resolveTypeName(iface, c, typeBySimple, typeByFqn);
      for (const t of targets) {
        if (!diBindings.has(t.fqn)) diBindings.set(t.fqn, []);
        diBindings.get(t.fqn).push(c);
      }
    }
    // also index by simple name for unresolved interfaces
    for (const iface of c.implements) {
      const simple = iface.replace(/<.*>/, '').split('.').pop();
      const key = 'simple:' + simple;
      if (!diBindings.has(key)) diBindings.set(key, []);
      diBindings.get(key).push(c);
    }
  }

  // ---- 3. per-method variable typing: field types + param types + local types ----
  for (const m of methods) {
    m._varTypes = new Map(); // varName -> typeName (simple)
    const cls = typeByFqn.get(m.containingClass);
    if (cls) for (const f of cls.fields) m._varTypes.set(f.name, simpleType(f.type));
    for (const p of m.params) m._varTypes.set(p.name, simpleType(p.type));
    for (const l of m.locals) if (l.type) m._varTypes.set(l.name, simpleType(l.type));
  }

  // ---- 4. type-aware call graph ----
  const callGraph = new Map(); // callerMethodId -> [{calleeId, via, receiver, name, line, confidence, evidence}]
  const callers = new Map();   // calleeMethodId -> [callerMethodId]
  for (const m of methods) {
    const edges = [];
    const cls = typeByFqn.get(m.containingClass);
    for (const call of m.calls) {
      const resolved = resolveCall(call, m, cls, { typeBySimple, typeByFqn, diBindings, methodsById });
      for (const r of resolved) {
        edges.push(r);
        if (!callers.has(r.calleeId)) callers.set(r.calleeId, []);
        callers.get(r.calleeId).push(m.id);
      }
    }
    callGraph.set(m.id, edges);
  }
  // attach reverse
  for (const m of methods) m._callers = callers.get(m.id) || [];

  return {
    classes, methods, symbols, methodsById,
    typeBySimple, typeByFqn, diBindings, callGraph, callers,
    stats: { classes: classes.length, methods: methods.length, fields: symbols.filter((s) => s.kind === 'field').length },
  };
}

// resolve a type name (possibly generic / qualified) to class symbol(s) in scope
function resolveTypeName(typeName, contextClass, typeBySimple, typeByFqn) {
  if (!typeName) return [];
  const simple = typeName.replace(/<.*>/, '').split('.').pop().trim();
  if (typeByFqn.has(typeName)) return [typeByFqn.get(typeName)];
  // try via imports of the context class
  if (contextClass && contextClass.imports) {
    const imp = contextClass.imports.find((i) => i.simpleName === simple);
    if (imp && typeByFqn.has(imp.fqn)) return [typeByFqn.get(imp.fqn)];
  }
  return typeBySimple.get(simple) || [];
}
function simpleType(t) { return t ? t.replace(/<.*>/, '').replace(/\[\]/g, '').split('.').pop().trim() : null; }

// resolve ONE call site to zero+ callee method symbols, with evidence + confidence
function resolveCall(call, method, cls, ctx) {
  const { typeBySimple, typeByFqn, diBindings, methodsById } = ctx;
  const name = call.name;
  const out = [];
  const push = (calleeCls, confidence, via) => {
    if (!calleeCls) return;
    // find a method by name on the class (ignore overload precision for now)
    const mm = calleeCls.methods.filter((x) => x.name === name);
    for (const target of mm) out.push({ calleeId: target.id, calleeClass: calleeCls.fqn, name, receiver: call.receiver, line: call.line, condition: call.condition, confidence, via, args: call.args || [] });
    // if the class is an interface, also resolve to its implementations
    const impls = diBindings.get(calleeCls.fqn) || diBindings.get('simple:' + calleeCls.name) || [];
    for (const impl of impls) {
      const im = impl.methods.filter((x) => x.name === name);
      for (const target of im) out.push({ calleeId: target.id, calleeClass: impl.fqn, name, receiver: call.receiver, line: call.line, condition: call.condition, confidence: Math.max(confidence - 0.1, 0.5), via: via + '+impl', args: call.args || [] });
    }
  };

  let receiver = call.receiver;
  if (receiver) {
    receiver = receiver.replace(/^this\./, '');
    // receiver is a variable of known type?
    const t = method._varTypes && method._varTypes.get(receiver.split('.')[0]);
    if (t) {
      const targets = resolveTypeName(t, cls, typeBySimple, typeByFqn);
      for (const tc of targets) push(tc, 0.95, 'receiver-type:' + t);
      if (out.length) return dedupe(out);
    }
    // receiver is a ClassName (static call)?
    const staticTargets = typeBySimple.get(receiver.split('.')[0]);
    if (staticTargets) { for (const tc of staticTargets) push(tc, 0.8, 'static'); if (out.length) return dedupe(out); }
  } else {
    // no receiver: method on containing class or its supertypes
    if (cls) { push(cls, 0.9, 'self'); if (out.length) return dedupe(out); }
  }
  // fallback: unique method name across the repo (low confidence)
  return dedupe(out);
}
function dedupe(arr) { const seen = new Set(); return arr.filter((e) => { const k = e.calleeId + '@' + e.line; if (seen.has(k)) return false; seen.add(k); return true; }); }
