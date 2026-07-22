/**
 * resolve.js — resolve each file's import sources to in-repo file paths.
 *
 * Language-agnostic resolution:
 *  - relative imports ('./x', '../y') resolved against the importer's dir with a
 *    set of candidate extensions + index files;
 *  - Go/Java/Python style dotted or slashed package paths matched against known
 *    repo files by suffix;
 *  - anything unresolved is treated as external (kept as-is for the deps view).
 * Adds `resolved` (in-repo path or null) and `external` flags to each import, and
 * fills `importedBy` reverse edges on each file record.
 */
import path from 'path';

const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.c', '.cpp', '.h', '.hpp', '.swift', '.dart', '.scala', '.ex', '.exs', '.lua'];
const INDEX_NAMES = ['index', 'mod', '__init__', 'main'];

export function resolveImports(files) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const pathSet = new Set(files.map((f) => f.path));
  // suffix index: last-2-segments -> [paths] for dotted/slashed matching
  const suffixIndex = new Map();
  for (const f of files) {
    const noExt = f.path.replace(/\.[^./]+$/, '');
    const segs = noExt.split('/');
    for (let n = 1; n <= Math.min(3, segs.length); n++) {
      const key = segs.slice(-n).join('/');
      if (!suffixIndex.has(key)) suffixIndex.set(key, []);
      suffixIndex.get(key).push(f.path);
    }
  }

  for (const f of files) {
    f.importedBy = f.importedBy || [];
  }

  for (const f of files) {
    if (!f.imports) continue;
    for (const imp of f.imports) {
      imp.resolved = null;
      imp.external = false;
      const src = imp.source;
      if (!src) { imp.external = true; continue; }

      if (src.startsWith('.')) {
        const resolved = resolveRelative(f.path, src, pathSet);
        imp.resolved = resolved;
        if (!resolved) imp.external = true;
      } else {
        // try suffix match for package-style imports (go/java/py dotted)
        const norm = src.replace(/\\/g, '/').replace(/^@[\w-]+\//, '');
        const dotted = norm.replace(/\./g, '/');
        let hit = matchSuffix(dotted, suffixIndex) || matchSuffix(norm, suffixIndex);
        if (hit && hit !== f.path) imp.resolved = hit;
        else imp.external = true;
      }
      if (imp.resolved && byPath.has(imp.resolved)) {
        const target = byPath.get(imp.resolved);
        if (!target.importedBy.includes(f.path)) target.importedBy.push(f.path);
      }
    }
  }
}

function resolveRelative(fromPath, spec, pathSet) {
  const baseDir = path.posix.dirname(fromPath);
  let target = path.posix.normalize(path.posix.join(baseDir, spec));
  target = target.replace(/^(\.\.\/)+/, ''); // clamp escapes to repo root-ish
  // exact
  if (pathSet.has(target)) return target;
  // with extensions
  for (const ext of CODE_EXTS) if (pathSet.has(target + ext)) return target + ext;
  // as directory index
  for (const idx of INDEX_NAMES) for (const ext of CODE_EXTS) {
    const c = path.posix.join(target, idx + ext);
    if (pathSet.has(c)) return c;
  }
  // strip an existing extension then retry (e.g. import './x.js' -> x.ts)
  const noExt = target.replace(/\.[^./]+$/, '');
  for (const ext of CODE_EXTS) if (pathSet.has(noExt + ext)) return noExt + ext;
  return null;
}

function matchSuffix(spec, suffixIndex) {
  const segs = spec.split('/').filter(Boolean);
  for (let n = Math.min(3, segs.length); n >= 1; n--) {
    const key = segs.slice(-n).join('/');
    const hits = suffixIndex.get(key);
    if (hits && hits.length === 1) return hits[0]; // unambiguous only
  }
  return null;
}
