/**
 * adapters.js — LanguageAnalyzer registry. Maps a language id to its deep
 * analyzer (which emits the normalized per-file model consumed by symbol-index /
 * lineage / engine). Adding a language = registering an adapter here; the
 * Evidence Graph stays language-independent.
 *
 * Capability levels reported per language:
 *   structural  files/imports/exports/deps        (all tree-sitter languages)
 *   symbol      functions/classes/references
 *   deep        calls + control-flow + data-flow + calculations
 *   fullstack   + frontend/API/backend/database cross-layer
 */
import { analyzeJavaFile } from './java-analyzer.js';
import { analyzeTsFile } from './ts-analyzer.js';

export const ADAPTERS = {
  java: { analyze: (rel, src) => analyzeJavaFile(rel, src), capability: 'fullstack', label: 'Java' },
  typescript: { analyze: (rel, src) => analyzeTsFile(rel, src, 'typescript'), capability: 'fullstack', label: 'TypeScript' },
  tsx: { analyze: (rel, src) => analyzeTsFile(rel, src, 'tsx'), capability: 'fullstack', label: 'TSX' },
  javascript: { analyze: (rel, src) => analyzeTsFile(rel, src, 'javascript'), capability: 'fullstack', label: 'JavaScript' },
};

// languages that get structural/symbol analysis via the universal analyzer but
// not (yet) a deep adapter. Reported honestly in the capability table.
export const STRUCTURAL_LANGS = {
  python: 'Python', go: 'Go', csharp: 'C#', ruby: 'Ruby', php: 'PHP', rust: 'Rust',
  kotlin: 'Kotlin', c: 'C', cpp: 'C++', swift: 'Swift', scala: 'Scala', dart: 'Dart',
};

export function adapterFor(langId) { return ADAPTERS[langId] || null; }
export function deepLanguages() { return Object.keys(ADAPTERS); }

// Build the capability report for a repo from the languages actually present.
export function capabilityReport(languages) {
  const rows = [];
  const seen = new Set();
  for (const l of (languages || [])) {
    const id = l.id || l.label;
    const label = l.label || id;
    let level = 'structural';
    // match by label or id against adapters
    const key = Object.keys(ADAPTERS).find((k) => ADAPTERS[k].label.toLowerCase() === String(label).toLowerCase() || k === l.id);
    if (key) level = ADAPTERS[key].capability;
    else if (Object.values(STRUCTURAL_LANGS).some((v) => v.toLowerCase() === String(label).toLowerCase())) level = 'structural';
    if (seen.has(label)) continue; seen.add(label);
    rows.push({ language: label, level, files: l.files || 0 });
  }
  return rows;
}
