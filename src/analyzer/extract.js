/**
 * extract.js — per-file symbol extraction using tree-sitter.
 *
 * For each code file, runs the language's queries to collect functions, classes,
 * imports (with resolved sources when possible), and call sites. Also computes a
 * cyclomatic-complexity estimate per function by counting decision nodes, and a
 * per-function set of calls (by walking the subtree). Everything is grammar-based.
 */
import { getParser, LANGUAGES } from './languages.js';
import { QUERIES } from './queries.js';
import { Query } from 'web-tree-sitter';

// node types that add a decision branch, across languages (superset; harmless if absent)
const BRANCH_TYPES = new Set([
  'if_statement', 'if_expression', 'for_statement', 'for_expression', 'for_in_statement',
  'while_statement', 'while_expression', 'do_statement', 'case', 'when', 'catch_clause',
  'catch', 'conditional_expression', 'ternary_expression', 'match_arm', 'switch_section',
  'else_clause', 'elif_clause', 'guard_statement', 'rescue',
]);
const BOOLEAN_OPS = new Set(['&&', '||', '??', 'and', 'or']);

function lineOf(node) { return node.startPosition.row + 1; }
function endLineOf(node) { return node.endPosition.row + 1; }

function nodeText(node, src) {
  return src.slice(node.startIndex, node.endIndex);
}

// find the enclosing function node for a given position (by walking captured defs)
function complexityOf(node) {
  let complexity = 1;
  const walk = (n) => {
    if (BRANCH_TYPES.has(n.type)) complexity++;
    if (n.type === 'binary_expression' || n.type === 'boolean_operator') {
      // count boolean sub-operators
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && BOOLEAN_OPS.has(c.type)) complexity++;
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i));
  };
  walk(node);
  return complexity;
}

// collect call names within a subtree using the language's call query
function callsWithin(defNode, callQuery, src) {
  if (!callQuery) return [];
  const names = new Set();
  try {
    const caps = callQuery.captures(defNode);
    for (const c of caps) {
      if (c.name === 'call.name') {
        const t = nodeText(c.node, src);
        if (t && t.length < 80) names.add(t);
      }
    }
  } catch { /* ignore */ }
  return [...names];
}

// leading doc comment (line comments or block above the node)
function leadingDoc(node, src) {
  let prev = node.previousSibling;
  const comments = [];
  while (prev && (prev.type === 'comment' || prev.type === 'line_comment' || prev.type === 'block_comment' || prev.type === 'expression_statement' && false)) {
    comments.unshift(nodeText(prev, src));
    prev = prev.previousSibling;
    if (comments.length > 8) break;
  }
  if (!comments.length) return undefined;
  const text = comments.join('\n')
    .replace(/\/\*\*?|\*\/|^\s*\*\s?|^\s*\/\/\s?|^\s*#\s?/gm, '')
    .split('\n').map((l) => l.trim()).filter(Boolean).join(' ').trim();
  return text ? text.slice(0, 400) : undefined;
}

export async function extractFile(file, src) {
  const langId = file.lang;
  const def = LANGUAGES[langId];
  if (!def || def.data) return null;
  const entry = await getParser(langId);
  if (!entry) return null;
  const qdef = QUERIES[langId];
  if (!qdef) return null;

  let tree;
  try {
    tree = entry.parser.parse(src);
  } catch { return null; }
  if (!tree) return null;

  const root = tree.rootNode;
  const lines = src.split('\n');
  const loc = lines.length;

  const compile = (text) => {
    if (!text || !text.trim()) return null;
    try { return new Query(entry.language, text); } catch { return null; }
  };
  const fnQuery = compile(qdef.functions);
  const classQuery = compile(qdef.classes);
  const importQuery = compile(qdef.imports);
  const callQuery = compile(qdef.calls);

  const functions = [];
  const classes = [];
  const imports = [];
  let hasParseError = root.hasError;

  // ---- functions ----
  if (fnQuery) {
    // group captures by their @fn.def node
    const byDef = new Map();
    for (const c of fnQuery.captures(root)) {
      if (c.name === 'fn.def') {
        if (!byDef.has(c.node.id)) byDef.set(c.node.id, { def: c.node, name: null });
      } else if (c.name === 'fn.name') {
        // attach to nearest enclosing def captured
        for (const [, v] of byDef) {
          if (v.def.startIndex <= c.node.startIndex && v.def.endIndex >= c.node.endIndex && !v.name) {
            v.name = c.node; break;
          }
        }
      }
    }
    for (const { def: dnode, name } of byDef.values()) {
      const nm = name ? nodeText(name, src) : '(anonymous)';
      functions.push({
        name: nm,
        line: lineOf(dnode),
        endLine: endLineOf(dnode),
        loc: endLineOf(dnode) - lineOf(dnode) + 1,
        complexity: complexityOf(dnode),
        calls: callsWithin(dnode, callQuery, src),
        doc: leadingDoc(dnode, src),
        async: /\basync\b/.test(nodeText(dnode, src).slice(0, 40)),
      });
    }
  }

  // ---- classes / types ----
  if (classQuery) {
    const byDef = new Map();
    for (const c of classQuery.captures(root)) {
      if (c.name === 'class.def') {
        if (!byDef.has(c.node.id)) byDef.set(c.node.id, { def: c.node, name: null });
      } else if (c.name === 'class.name') {
        for (const [, v] of byDef) {
          if (v.def.startIndex <= c.node.startIndex && v.def.endIndex >= c.node.endIndex && !v.name) {
            v.name = c.node; break;
          }
        }
      }
    }
    for (const { def: dnode, name } of byDef.values()) {
      classes.push({
        name: name ? nodeText(name, src) : '(anonymous)',
        kind: dnode.type.replace(/_(declaration|definition|item|specifier|spec)$/,''),
        line: lineOf(dnode),
        endLine: endLineOf(dnode),
        loc: endLineOf(dnode) - lineOf(dnode) + 1,
        doc: leadingDoc(dnode, src),
      });
    }
  }

  // ---- imports ----
  if (importQuery) {
    const byImp = new Map();
    for (const c of importQuery.captures(root)) {
      if (c.name === 'import') {
        if (!byImp.has(c.node.id)) byImp.set(c.node.id, { node: c.node, source: null });
      } else if (c.name === 'import.source') {
        for (const [, v] of byImp) {
          if (v.node.startIndex <= c.node.startIndex && v.node.endIndex >= c.node.endIndex && !v.source) {
            v.source = nodeText(c.node, src).replace(/^['"`]|['"`]$/g, ''); break;
          }
        }
      }
    }
    for (const { node, source } of byImp.values()) {
      const raw = nodeText(node, src).replace(/\s+/g, ' ').trim().slice(0, 200);
      imports.push({ source: source || extractImportSource(raw), raw, line: lineOf(node) });
    }
  }

  // top-level call sites (for repos w/o clear functions)
  const allCalls = new Set();
  if (callQuery) {
    for (const c of callQuery.captures(root)) {
      if (c.name === 'call.name') {
        const t = nodeText(c.node, src);
        if (t && t.length < 80) allCalls.add(t);
      }
    }
  }

  const docText = fileDoc(root, src);
  tree.delete?.();

  return {
    path: file.path,
    lang: langId,
    loc,
    sloc: lines.filter((l) => l.trim() && !/^\s*(\/\/|#|\*|\/\*)/.test(l)).length,
    size: file.size,
    functions,
    classes,
    imports,
    calls: [...allCalls],
    hasParseError,
    complexity: functions.reduce((s, f) => s + f.complexity, 0),
    doc: docText,
  };
}

// best-effort module string out of an import statement's raw text
function extractImportSource(raw) {
  const m = raw.match(/['"]([^'"]+)['"]/);
  if (m) return m[1];
  const m2 = raw.match(/(?:from|import|use|using|require)\s+([\w./:\\-]+)/i);
  return m2 ? m2[1] : undefined;
}

function fileDoc(root, src) {
  // first leading comment (or run of comments) at the top of the file
  let n = root.child(0);
  const parts = [];
  while (n && (n.type === 'comment' || n.type.includes('comment'))) {
    parts.push(nodeText(n, src));
    n = n.nextSibling;
    if (parts.length > 10) break;
  }
  if (!parts.length) return undefined;
  const text = parts.join('\n')
    .replace(/\/\*\*?|\*\/|^\s*\*\s?|^\s*\/\/\s?|^\s*#\s?/gm, '')
    .split('\n').map((l) => l.trim()).filter(Boolean).join(' ').trim();
  return text ? text.slice(0, 400) : undefined;
}
