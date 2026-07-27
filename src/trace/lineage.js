/**
 * lineage.js — variable / data-flow lineage (backward + forward) over the Java
 * symbol index. THE most important engine: answers "where did this value come
 * from?" and "what happens to this value?" using only verified AST evidence.
 *
 * Backward (origin): for a variable in a method, resolve its defining assignment/
 * declaration, then recursively resolve each input:
 *   - another local/param/field in the same method  -> its own definition
 *   - a parameter                                    -> the argument at each call site
 *   - a method call result                           -> the callee's return expression(s)
 *   - a field of type Entity with @Column            -> the database column
 *   - a getter on an Entity                          -> the backing field -> column
 *
 * Forward (fate): from a definition, find every use:
 *   - reads in later expressions/returns of the same method
 *   - passed as an argument to a call   -> the callee parameter
 *   - returned                          -> callers' receiving variable
 *   - assigned to an Entity setter      -> persisted column (if repository.save)
 *   - assigned to a Response DTO setter -> API response field -> frontend
 *
 * Each hop is an evidence edge with { type, file, line, confidence, detail }.
 */

const CONF = { VERIFIED: 'verified', INFERRED: 'inferred', POSSIBLE: 'possible', UNKNOWN: 'unknown' };

function simpleType(t) { return t ? t.replace(/<.*>/, '').replace(/\[\]/g, '').split('.').pop().trim() : null; }

// find the definition (declaration or assignment) of a var name within a method
function defsOf(method, varName) {
  const defs = [];
  for (const l of method.locals) if (l.name === varName) defs.push({ kind: 'local', line: l.line, type: l.type, expr: l.init, condition: l.condition });
  for (const a of method.assignments) { const tgt = a.target.replace(/^this\./, ''); if (tgt === varName) defs.push({ kind: 'assign', line: a.line, expr: a.expr, condition: a.condition }); }
  return defs;
}
function paramOf(method, varName) { return method.params.find((p) => p.name === varName); }
function fieldOf(cls, varName) { return cls ? cls.fields.find((f) => f.name === varName) : null; }

// resolve a getter call (x.getFoo()) on an entity to its column, if any
function getterColumn(calleeClass, methodName, idx) {
  if (!calleeClass) return null;
  const m = /^get([A-Z]\w*)$/.exec(methodName) || /^is([A-Z]\w*)$/.exec(methodName);
  if (!m) return null;
  const fieldName = m[1][0].toLowerCase() + m[1].slice(1);
  const f = calleeClass.fields.find((x) => x.name === fieldName);
  if (f && f.columnName) return { table: calleeClass.tableName, column: f.columnName, field: fieldName, entity: calleeClass.fqn, fieldSym: f };
  return null;
}

// camelCase -> snake_case (monthlySalary -> monthly_salary)
function toSnake(s) { return String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(); }

// TS: resolve a member-access read (employee.monthlySalary) to a DB column by
// matching the property's snake_case against columns actually SELECTed via
// Supabase/Prisma anywhere in the repo. Evidence: the column literally appears
// in a query's projection, and the accessed property name matches it.
function dbColumnFor(idx, m, expr, token) {
  if (!idx || !expr) return null;
  if (expr.kind !== 'member_expression' && !/\./.test(expr.raw || '')) return null;
  // property = last identifier after the final dot in the raw member access
  const mm = /\.([a-zA-Z_$][\w$]*)\s*$/.exec(String(expr.raw || '').trim());
  if (!mm) return null;
  const prop = mm[1];
  const snake = toSnake(prop);
  const db = idx.dbAccess || [];
  // prefer a select hit whose projection lists this column
  let hit = db.find((d) => /select|find/i.test(d.op || '') && (d.columns || []).includes(snake));
  if (!hit) hit = db.find((d) => (d.columns || []).includes(snake));
  if (hit && hit.table) return { table: hit.table, column: snake };
  return null;
}

/**
 * Backward trace of a variable value.
 * @returns { root, steps:[{from,to,type,file,line,confidence,detail}], formulas:[], origins:[] }
 */
export function traceBackward(idx, methodId, varName, opts = {}) {
  const maxDepth = opts.maxDepth || 40;
  const method = idx.methodsById.get(methodId);
  if (!method) return { error: 'method not found' };
  const cls = idx.typeByFqn.get(method.containingClass);
  const steps = [];
  const formulas = [];
  const origins = [];
  const seen = new Set();

  // resolve one "value token" (a var name or literal) within a method context
  function resolveToken(m, mCls, token, depth, childOf) {
    if (depth > maxDepth) return;
    token = String(token || '').trim();
    if (!token) return;
    // literal number/string -> a constant origin
    if (/^["'0-9]/.test(token) || /^[0-9.]+$/.test(token)) {
      origins.push({ kind: 'constant', value: token, method: m.id, file: m.file });
      return;
    }
    const key = m.id + '::' + token + '::' + depth;
    if (seen.has(m.id + '::' + token)) return; // avoid cycles per method-var
    seen.add(m.id + '::' + token);

    // 1) is it a local/assignment in this method?
    const defs = defsOf(m, token);
    if (defs.length) {
      for (const d of defs) {
        if (d.expr) {
          // record a formula if it's arithmetic
          if (d.expr.op) formulas.push({ result: token, op: d.expr.op, operands: d.expr.operands, raw: d.expr.raw, type: d.type, file: m.file, line: d.line, method: m.id, condition: d.condition });
          // TS: a value read from a Supabase/Prisma query -> DB column origin
          const dbCol = dbColumnFor(idx, m, d.expr, token);
          if (dbCol) { origins.push({ kind: 'column', table: dbCol.table, column: dbCol.column, entity: dbCol.table, file: m.file, line: d.line }); steps.push({ from: token, to: dbCol.table + '.' + dbCol.column, type: 'LOADED_FROM', file: m.file, line: d.line, confidence: CONF.VERIFIED, detail: 'read from ' + dbCol.table + ' via query' }); }
          // the expression's inputs
          const inputs = exprInputs(d.expr);
          for (const inp of inputs) {
            steps.push({ from: token, to: inp, type: 'ASSIGNED_FROM', file: m.file, line: d.line, confidence: CONF.VERIFIED, detail: d.expr.raw, method: m.id });
            resolveToken(m, mCls, inp, depth + 1, token);
          }
          // the expression's calls -> follow return values
          for (const call of (d.expr.calls || [])) followCallReturn(m, mCls, call, token, d.line, depth);
        }
      }
      return;
    }
    // 2) is it a parameter? -> trace the argument at each caller's call site
    const p = paramOf(m, token);
    if (p) {
      const paramIndex = m.params.indexOf(p);
      const callerEdges = incomingCalls(idx, m.id);
      if (!callerEdges.length) {
        origins.push({ kind: 'parameter', name: token, type: p.type, method: m.id, file: m.file, line: m.line, note: 'entry parameter (no in-repo callers)' });
      }
      for (const ce of callerEdges) {
        const callerM = idx.methodsById.get(ce.callerId);
        if (!callerM) continue;
        const arg = (ce.args || [])[paramIndex];
        steps.push({ from: token, to: arg || '(arg ' + paramIndex + ')', type: 'PARAMETER_FLOW', file: callerM.file, line: ce.line, confidence: CONF.VERIFIED, detail: token + ' = argument of ' + callerM.name + '()', method: callerM.id });
        if (arg) resolveToken(callerM, idx.typeByFqn.get(callerM.containingClass), stripArg(arg), depth + 1, token);
      }
      return;
    }
    // 3) is it a field of the containing class?
    const f = fieldOf(mCls, token);
    if (f) {
      if (f.columnName) {
        origins.push({ kind: 'column', table: mCls.tableName, column: f.columnName, field: f.name, entity: mCls.fqn, file: mCls.file, line: f.line });
        steps.push({ from: token, to: mCls.tableName + '.' + f.columnName, type: 'LOADED_FROM', file: mCls.file, line: f.line, confidence: CONF.VERIFIED, detail: '@Column ' + f.columnName });
      } else {
        origins.push({ kind: 'field', name: f.name, type: f.type, entity: mCls.fqn, file: mCls.file, line: f.line });
      }
      return;
    }
    // 4) token like x.getY() handled by expr.calls; a bare unknown -> possible origin
    origins.push({ kind: 'unresolved', name: token, method: m.id, file: m.file, confidence: CONF.POSSIBLE });
  }

  // follow a call's return value to its callee's return expression(s)
  function followCallReturn(m, mCls, call, assignedTo, atLine, depth) {
    const resolved = resolveCallSite(idx, m, mCls, call);
    for (const r of resolved) {
      const callee = idx.methodsById.get(r.calleeId);
      if (!callee) continue;
      const calleeClass = idx.typeByFqn.get(callee.containingClass);
      // getter -> column origin
      const gc = getterColumn(calleeClass, callee.name, idx);
      if (gc) {
        origins.push({ kind: 'column', table: gc.table, column: gc.column, field: gc.field, entity: gc.entity, file: callee.file, line: callee.line });
        steps.push({ from: assignedTo, to: gc.table + '.' + gc.column, type: 'LOADED_FROM', file: callee.file, line: gc.fieldSym.line, confidence: CONF.VERIFIED, detail: callee.name + '() -> @Column ' + gc.column });
        continue;
      }
      steps.push({ from: assignedTo, to: callee.name + '()', type: 'RETURN_FLOW', file: callee.file, line: r.line, confidence: r.confidence >= 0.9 ? CONF.VERIFIED : CONF.INFERRED, detail: 'value returned by ' + callee.containingClass.split('.').pop() + '.' + callee.name + '()', method: callee.id });
      // trace each return expression inside the callee
      for (const ret of callee.returns) {
        if (!ret.expr) continue;
        if (ret.expr.op) formulas.push({ result: callee.name + '()', op: ret.expr.op, operands: ret.expr.operands, raw: ret.expr.raw, file: callee.file, line: ret.line, method: callee.id, condition: ret.condition });
        for (const inp of exprInputs(ret.expr)) resolveToken(callee, calleeClass, inp, depth + 2, assignedTo);
        for (const c2 of (ret.expr.calls || [])) followCallReturn(callee, calleeClass, c2, callee.name + '()', ret.line, depth + 2);
      }
    }
  }

  resolveToken(method, cls, varName, 0, null);
  return {
    direction: 'backward', target: { method: methodId, variable: varName, methodName: method.name, class: method.containingClass, file: method.file },
    steps, formulas, origins,
    summary: summarizeOrigins(origins),
  };
}

/**
 * Forward trace: where does a value go after it is defined here?
 */
export function traceForward(idx, methodId, varName, opts = {}) {
  const maxDepth = opts.maxDepth || 30;
  const method = idx.methodsById.get(methodId);
  if (!method) return { error: 'method not found' };
  const steps = [];
  const sinks = [];
  const seen = new Set();

  function forward(m, mCls, token, depth) {
    if (depth > maxDepth) return;
    const key = m.id + '::' + token;
    if (seen.has(key)) return; seen.add(key);

    // used in later assignments as an input
    for (const a of m.assignments) {
      if (a.expr && exprInputs(a.expr).includes(token)) {
        steps.push({ from: token, to: a.target, type: 'TRANSFORMS', file: m.file, line: a.line, confidence: CONF.VERIFIED, detail: a.expr.raw });
        forward(m, mCls, a.target.replace(/^this\./, ''), depth + 1);
      }
    }
    for (const l of m.locals) {
      if (l.init && exprInputs(l.init).includes(token)) {
        steps.push({ from: token, to: l.name, type: 'TRANSFORMS', file: m.file, line: l.line, confidence: CONF.VERIFIED, detail: l.init.raw });
        forward(m, mCls, l.name, depth + 1);
      }
    }
    // passed as an argument to a call -> callee parameter
    for (const call of m.calls) {
      const argIdx = (call.args || []).findIndex((a) => stripArg(a) === token || a === token);
      if (argIdx < 0) continue;
      const resolved = resolveCallSite(idx, m, mCls, call);
      for (const r of resolved) {
        const callee = idx.methodsById.get(r.calleeId); if (!callee) continue;
        const calleeClass = idx.typeByFqn.get(callee.containingClass);
        // setter on an entity/DTO -> persisted or response field
        const sc = setterColumn(calleeClass, callee.name);
        if (sc) {
          const isEntity = calleeClass.stereotype === 'entity';
          sinks.push({ kind: isEntity ? 'persisted' : 'response-field', table: calleeClass.tableName, column: sc.column, field: sc.field, target: calleeClass.fqn, file: m.file, line: call.line });
          steps.push({ from: token, to: (calleeClass.tableName ? calleeClass.tableName + '.' + sc.column : calleeClass.name + '.' + sc.field), type: isEntity ? 'PERSISTS_TO' : 'ASSIGNED_TO', file: m.file, line: call.line, confidence: CONF.VERIFIED, detail: callee.name + '(' + token + ')' });
          continue;
        }
        const param = callee.params[argIdx];
        if (param) {
          steps.push({ from: token, to: callee.containingClass.split('.').pop() + '.' + callee.name + '(' + param.name + ')', type: 'PASSES_TO', file: m.file, line: call.line, confidence: r.confidence >= 0.9 ? CONF.VERIFIED : CONF.INFERRED, detail: 'argument -> parameter ' + param.name });
          forward(callee, calleeClass, param.name, depth + 1);
        }
      }
    }
    // returned -> callers receive it
    for (const ret of m.returns) {
      if (ret.expr && (exprInputs(ret.expr).includes(token) || ret.expr.raw === token)) {
        steps.push({ from: token, to: m.name + '() return', type: 'RETURNS', file: m.file, line: ret.line, confidence: CONF.VERIFIED, detail: 'returned to callers of ' + m.name + '()' });
        for (const ce of incomingCalls(idx, m.id)) {
          const callerM = idx.methodsById.get(ce.callerId); if (!callerM) continue;
          // find the local that receives this call's result
          const recv = callerM.locals.find((l) => l.init && (l.init.calls || []).some((c) => c.name === m.name));
          if (recv) { sinks.push({ kind: 'return', to: recv.name, method: callerM.id, file: callerM.file, line: recv.line }); forward(callerM, idx.typeByFqn.get(callerM.containingClass), recv.name, depth + 1); }
        }
      }
    }
  }
  forward(method, idx.typeByFqn.get(method.containingClass), varName, 0);
  return { direction: 'forward', target: { method: methodId, variable: varName, methodName: method.name, class: method.containingClass, file: method.file }, steps, sinks, summary: summarizeSinks(sinks) };
}

// ---- helpers ----
function exprInputs(expr) {
  if (!expr) return [];
  // prefer explicit operands, else the collected refs; strip literals
  const set = new Set();
  for (const o of (expr.operands || [])) { if (o && /[a-zA-Z_]/.test(o) && !/^"/.test(o)) set.add(String(o).split('.')[0].replace(/\(.*/, '')); }
  for (const r of (expr.refs || [])) set.add(r);
  return [...set].filter((x) => x && !/^(BigDecimal|RoundingMode|Long|Integer|String|LocalDate|Math)$/.test(x));
}
function stripArg(a) { return String(a || '').replace(/\(.*/, '').split('.')[0].replace(/^["']|["']$/g, '').trim(); }
function setterColumn(cls, methodName) {
  if (!cls) return null;
  const m = /^set([A-Z]\w*)$/.exec(methodName); if (!m) return null;
  const fieldName = m[1][0].toLowerCase() + m[1].slice(1);
  const f = cls.fields.find((x) => x.name === fieldName);
  if (f) return { field: fieldName, column: f.columnName || fieldName };
  return { field: fieldName, column: fieldName };
}
function incomingCalls(idx, methodId) {
  const out = [];
  for (const [callerId, edges] of idx.callGraph) for (const e of edges) if (e.calleeId === methodId) out.push({ callerId, args: e.args, line: e.line });
  return out;
}
function resolveCallSite(idx, method, cls, call) {
  // reuse the call graph edges recorded for this method at this line+name
  const edges = idx.callGraph.get(method.id) || [];
  return edges.filter((e) => e.name === call.name && e.line === call.line);
}
function summarizeOrigins(origins) {
  const cols = origins.filter((o) => o.kind === 'column').map((o) => o.table + '.' + o.column);
  const consts = origins.filter((o) => o.kind === 'constant').map((o) => o.value);
  const params = origins.filter((o) => o.kind === 'parameter').map((o) => o.name);
  return { columns: [...new Set(cols)], constants: [...new Set(consts)], parameters: [...new Set(params)] };
}
function summarizeSinks(sinks) {
  return {
    persisted: sinks.filter((s) => s.kind === 'persisted').map((s) => s.table + '.' + s.column),
    responseFields: sinks.filter((s) => s.kind === 'response-field').map((s) => s.target.split('.').pop() + '.' + s.field),
  };
}
export { CONF };
