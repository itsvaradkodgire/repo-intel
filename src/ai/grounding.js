/**
 * grounding.js — retrieval + context assembly for grounded AI.
 *
 * Turns a natural-language question into a compact, evidence-backed context drawn
 * ONLY from the repository index (files, functions, routes, tables, graph). The
 * model is instructed to answer strictly from this context and to say "Unable to
 * determine from repository analysis." when the evidence is absent. Retrieval is a
 * lightweight lexical scorer over the index (no embeddings needed, fully offline).
 */

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'and', 'or', 'how', 'does', 'do', 'what', 'where', 'which', 'this', 'that', 'for', 'on', 'with', 'i', 'it', 'explain', 'me', 'like', 'work', 'works', 'used', 'use', 'uses', 'get', 'show', 'find', 'happens', 'if', 'delete', 'file']);

function tokens(s) {
  return (s || '').toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) || [];
}

export function buildRepoOverview(index) {
  const c = index.manifest.counts;
  const langs = index.languages.slice(0, 6).map((l) => `${l.label} (${l.files} files)`).join(', ');
  const topDeps = index.dependencies.filter((d) => d.scope === 'runtime').slice(0, 20).map((d) => d.name).join(', ');
  const frameworks = [...new Set(index.routes.map((r) => r.framework))].join(', ');
  return [
    `Repository: ${index.source?.input || index.manifest.root}`,
    `Languages: ${langs}`,
    `Size: ${c.files} files, ${c.loc} LOC, ${c.functions} functions, ${c.classes} classes`,
    `APIs: ${c.routes} routes${frameworks ? ` (${frameworks})` : ''}. Database tables referenced: ${c.tables}.`,
    `Runtime dependencies (sample): ${topDeps || 'none detected'}`,
    `Inferred business flows: ${index.flows.map((f) => f.name).slice(0, 12).join(', ')}`,
  ].join('\n');
}

// Rank index items against the query; return a mixed evidence set with locations.
export function retrieve(index, query, limit = 14) {
  const qt = tokens(query).filter((t) => !STOP.has(t));
  const qset = new Set(qt);
  if (!qt.length) return [];

  const score = (text, boost = 1) => {
    if (!text) return 0;
    const tt = tokens(text);
    let s = 0;
    for (const t of tt) if (qset.has(t)) s += 1;
    // phrase bonus
    if (qt.length > 1 && text.toLowerCase().includes(query.toLowerCase())) s += 5;
    return s * boost;
  };

  const items = [];
  // functions
  for (const fn of index.functions) {
    const s = score(fn.name, 3) + score(fn.file, 1) + score(fn.doc, 1.5) + score((fn.calls || []).join(' '), 0.5);
    if (s > 0) items.push({ type: 'function', score: s, ref: fn.file + ':' + fn.line, title: fn.name, obj: fn });
  }
  // files (by path + doc)
  for (const f of index.files) {
    const s = score(f.path, 2) + score(f.doc, 1.5);
    if (s > 0) items.push({ type: 'file', score: s, ref: f.path, title: f.path.split('/').pop(), obj: f });
  }
  // routes
  for (const r of index.routes) {
    const s = score(r.path, 3) + score(r.file, 1) + score(r.method, 1);
    if (s > 0) items.push({ type: 'route', score: s, ref: r.file, title: r.method + ' ' + r.path, obj: r });
  }
  // tables
  for (const t of index.tables) {
    const s = score(t.name, 3);
    if (s > 0) items.push({ type: 'table', score: s, ref: t.definedIn || (t.writtenBy[0] || t.readBy[0]), title: t.name, obj: t });
  }
  // classes
  for (const cl of index.classes) {
    const s = score(cl.name, 3) + score(cl.file, 1) + score(cl.doc, 1);
    if (s > 0) items.push({ type: 'class', score: s, ref: cl.file + ':' + cl.line, title: cl.name, obj: cl });
  }
  // flows
  for (const fl of index.flows) {
    const s = score(fl.name, 3) + score(fl.trigger, 1);
    if (s > 0) items.push({ type: 'flow', score: s, ref: fl.entry, title: fl.name, obj: fl });
  }
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, limit);
}

// Build a grounded context block from retrieved evidence.
export function buildContext(index, query) {
  const evidence = retrieve(index, query);
  const lines = [];
  lines.push('=== REPOSITORY OVERVIEW ===');
  lines.push(buildRepoOverview(index));
  lines.push('');
  lines.push('=== RELEVANT EVIDENCE (from static analysis) ===');
  if (!evidence.length) lines.push('(no directly matching symbols found)');
  for (const e of evidence) {
    if (e.type === 'function') {
      const fn = e.obj;
      lines.push(`FUNCTION ${fn.name}() at ${fn.file}:${fn.line} — complexity ${fn.complexity}, ${fn.loc} LOC` +
        (fn.doc ? `\n  doc: ${fn.doc}` : '') +
        (fn.calls?.length ? `\n  calls: ${fn.calls.slice(0, 10).join(', ')}` : '') +
        (fn.calledBy?.length ? `\n  called by: ${fn.calledBy.length} function(s)` : ''));
    } else if (e.type === 'file') {
      const f = e.obj;
      const fns = (f.functions || []).slice(0, 8).map((x) => x.name).join(', ');
      lines.push(`FILE ${f.path} — ${f.lang || ''}, ${f.loc} LOC` + (f.doc ? `\n  purpose: ${f.doc}` : '') + (fns ? `\n  functions: ${fns}` : ''));
    } else if (e.type === 'route') {
      const r = e.obj;
      lines.push(`API ROUTE ${r.method} ${r.path} — defined in ${r.file} (${r.framework})`);
    } else if (e.type === 'table') {
      const t = e.obj;
      lines.push(`DB TABLE ${t.name} — read by ${t.readBy.length} file(s), written by ${t.writtenBy.length} file(s)` + (t.definedIn ? `, defined in ${t.definedIn}` : ''));
    } else if (e.type === 'class') {
      const cl = e.obj;
      lines.push(`CLASS/TYPE ${cl.name} (${cl.kind}) at ${cl.file}:${cl.line}` + (cl.doc ? `\n  doc: ${cl.doc}` : ''));
    } else if (e.type === 'flow') {
      const fl = e.obj;
      lines.push(`BUSINESS FLOW ${fl.name} — trigger: ${fl.trigger}; steps: ${fl.steps.map((s) => s.label).join(' -> ')}; writes: ${fl.tablesWritten.join(', ') || 'none'}`);
    }
  }
  return { context: lines.join('\n'), evidence };
}

export const SYSTEM_PROMPT = `You are a senior software engineer helping a developer understand a codebase.
You are given a REPOSITORY OVERVIEW and RELEVANT EVIDENCE produced by static analysis of the actual source code.
Rules:
- Answer ONLY using the provided evidence and overview. Do not invent files, functions, routes, or behavior.
- Always cite concrete references in the form path/to/file.ext:line when you make a claim.
- If the evidence does not contain the answer, reply exactly: "Unable to determine from repository analysis." and suggest what to inspect.
- Be concise and structured. Prefer short paragraphs and bullet points.
- When asked "what breaks if I delete X", reason from the imports/callers/edges in the evidence.`;

export function buildMessages(index, question, history = []) {
  const { context, evidence } = buildContext(index, question);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: context },
  ];
  for (const h of history.slice(-6)) messages.push({ role: h.role, content: h.content });
  messages.push({ role: 'user', content: question });
  return { messages, evidence };
}
