/**
 * languages.js — universal language registry.
 *
 * Maps file extensions to tree-sitter WASM grammars (from tree-sitter-wasms) and
 * holds per-language tree-sitter QUERIES for extracting functions, classes,
 * imports, calls, etc. Everything is grammar-based (no regex parsing). Grammars
 * are loaded lazily and cached.
 */
import { Parser, Language, Query } from 'web-tree-sitter';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const WASM_DIR = path.dirname(require.resolve('tree-sitter-wasms/package.json')) + '/out';

let inited = false;
export async function initParser() {
  if (!inited) {
    await Parser.init();
    inited = true;
  }
}

// language id -> { grammar wasm base name, extensions }
export const LANGUAGES = {
  typescript: { wasm: 'typescript', exts: ['.ts', '.mts', '.cts'], label: 'TypeScript' },
  tsx: { wasm: 'tsx', exts: ['.tsx'], label: 'TSX' },
  javascript: { wasm: 'javascript', exts: ['.js', '.mjs', '.cjs', '.jsx'], label: 'JavaScript' },
  python: { wasm: 'python', exts: ['.py', '.pyi'], label: 'Python' },
  java: { wasm: 'java', exts: ['.java'], label: 'Java' },
  kotlin: { wasm: 'kotlin', exts: ['.kt', '.kts'], label: 'Kotlin' },
  go: { wasm: 'go', exts: ['.go'], label: 'Go' },
  rust: { wasm: 'rust', exts: ['.rs'], label: 'Rust' },
  csharp: { wasm: 'c_sharp', exts: ['.cs'], label: 'C#' },
  php: { wasm: 'php', exts: ['.php'], label: 'PHP' },
  ruby: { wasm: 'ruby', exts: ['.rb'], label: 'Ruby' },
  c: { wasm: 'c', exts: ['.c', '.h'], label: 'C' },
  cpp: { wasm: 'cpp', exts: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], label: 'C++' },
  swift: { wasm: 'swift', exts: ['.swift'], label: 'Swift' },
  dart: { wasm: 'dart', exts: ['.dart'], label: 'Dart' },
  scala: { wasm: 'scala', exts: ['.scala', '.sc'], label: 'Scala' },
  ruby_erb: { wasm: 'embedded_template', exts: ['.erb'], label: 'ERB' },
  lua: { wasm: 'lua', exts: ['.lua'], label: 'Lua' },
  elixir: { wasm: 'elixir', exts: ['.ex', '.exs'], label: 'Elixir' },
  solidity: { wasm: 'solidity', exts: ['.sol'], label: 'Solidity' },
  bash: { wasm: 'bash', exts: ['.sh', '.bash'], label: 'Shell' },
  // data / config (parsed for config extraction, not code graph)
  json: { wasm: 'json', exts: ['.json'], label: 'JSON', data: true },
  yaml: { wasm: 'yaml', exts: ['.yaml', '.yml'], label: 'YAML', data: true },
  toml: { wasm: 'toml', exts: ['.toml'], label: 'TOML', data: true },
  html: { wasm: 'html', exts: ['.html', '.htm'], label: 'HTML', data: true },
  css: { wasm: 'css', exts: ['.css', '.scss', '.sass', '.less'], label: 'CSS', data: true },
  vue: { wasm: 'vue', exts: ['.vue'], label: 'Vue', data: true },
};

const EXT_TO_LANG = {};
for (const [id, def] of Object.entries(LANGUAGES)) {
  for (const ext of def.exts) EXT_TO_LANG[ext] = id;
}

export function languageForFile(filePath) {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(base);
  // special-case extensionless / dotfiles
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return null;
  return EXT_TO_LANG[ext] || null;
}

const grammarCache = new Map(); // langId -> { language, parser }
export async function getParser(langId) {
  if (grammarCache.has(langId)) return grammarCache.get(langId);
  const def = LANGUAGES[langId];
  if (!def) return null;
  await initParser();
  let language;
  try {
    language = await Language.load(path.join(WASM_DIR, `tree-sitter-${def.wasm}.wasm`));
  } catch (e) {
    return null;
  }
  const parser = new Parser();
  parser.setLanguage(language);
  const entry = { language, parser, def };
  grammarCache.set(langId, entry);
  return entry;
}

// Compile a query, caching per (langId, queryText).
const queryCache = new Map();
export function getQuery(langId, entry, text) {
  const key = langId + '::' + text;
  if (queryCache.has(key)) return queryCache.get(key);
  let q = null;
  try {
    q = new Query(entry.language, text);
  } catch (e) {
    q = null; // grammar may not support these node types
  }
  queryCache.set(key, q);
  return q;
}
