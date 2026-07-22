/**
 * walk.js — repository file discovery + language detection.
 *
 * Walks a directory, skipping VCS/build/vendor dirs and binary/huge files,
 * classifies each file by language, and returns a manifest the analyzer consumes.
 */
import fs from 'fs';
import path from 'path';
import { languageForFile, LANGUAGES } from './languages.js';

const IGNORE_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'vendor', 'dist',
  'build', 'out', '.next', '.nuxt', '.svelte-kit', 'target', 'bin', 'obj',
  '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache',
  'coverage', '.cache', '.gradle', '.idea', '.vscode', 'Pods', '.dart_tool',
  '.terraform', 'vendor', 'deps', '_build', '.next', '.parcel-cache',
  'site-packages', '.expo', 'DerivedData', '.cargo',
]);

const IGNORE_FILE_PATTERNS = [
  /\.min\.(js|css)$/i, /\.map$/i, /\.lock$/i, /-lock\.(json|yaml)$/i,
  /\.(png|jpe?g|gif|svg|ico|webp|bmp|tiff|pdf|zip|gz|tar|rar|7z|mp4|mp3|wav|mov|avi|woff2?|ttf|eot|otf|bin|exe|dll|so|dylib|class|o|a|wasm|pyc|jar|war)$/i,
];

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB per file cap

// Config / metadata files we recognize by name (not tree-sitter code).
export const META_FILES = {
  'package.json': 'npm', 'package-lock.json': 'npm-lock', 'yarn.lock': 'yarn-lock',
  'pnpm-lock.yaml': 'pnpm-lock', 'tsconfig.json': 'tsconfig', 'requirements.txt': 'pip',
  'pyproject.toml': 'python-project', 'setup.py': 'python-setup', 'Pipfile': 'pipenv',
  'go.mod': 'gomod', 'go.sum': 'gosum', 'Cargo.toml': 'cargo', 'Cargo.lock': 'cargo-lock',
  'pom.xml': 'maven', 'build.gradle': 'gradle', 'build.gradle.kts': 'gradle',
  'composer.json': 'composer', 'Gemfile': 'bundler', 'Gemfile.lock': 'bundler-lock',
  '.csproj': 'dotnet', 'pubspec.yaml': 'dart-pub', 'build.sbt': 'sbt',
  'Dockerfile': 'docker', 'docker-compose.yml': 'compose', 'docker-compose.yaml': 'compose',
  '.env': 'env', '.env.example': 'env', '.env.local': 'env', '.env.sample': 'env',
  'Makefile': 'make', 'CMakeLists.txt': 'cmake',
};

function isMetaFile(name) {
  if (META_FILES[name]) return META_FILES[name];
  if (name.endsWith('.csproj')) return 'dotnet';
  if (name.startsWith('.env')) return 'env';
  if (name.startsWith('Dockerfile')) return 'docker';
  return null;
}

const CI_DIRS = ['.github/workflows', '.gitlab-ci.yml', '.circleci', '.travis.yml'];

export function walkRepo(root) {
  const files = [];
  const skipped = { binary: 0, tooBig: 0, ignoredDir: 0 };
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) { skipped.ignoredDir++; continue; }
        stack.push(full);
      } else if (ent.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (IGNORE_FILE_PATTERNS.some((r) => r.test(ent.name))) { skipped.binary++; continue; }
        let size = 0;
        try { size = fs.statSync(full).size; } catch { continue; }
        if (size > MAX_FILE_BYTES) { skipped.tooBig++; continue; }
        const lang = languageForFile(rel);
        const meta = isMetaFile(ent.name);
        files.push({ path: rel, abs: full, size, lang, meta, ext: path.extname(ent.name) });
      }
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

// Aggregate language stats (by code lines, roughly by bytes for speed).
export function detectLanguages(files) {
  const stats = {}; // langId -> { files, bytes }
  for (const f of files) {
    if (!f.lang) continue;
    const def = LANGUAGES[f.lang];
    if (def && def.data) continue; // config formats don't count as "the language"
    stats[f.lang] = stats[f.lang] || { files: 0, bytes: 0, label: def ? def.label : f.lang };
    stats[f.lang].files++;
    stats[f.lang].bytes += f.size;
  }
  const ranked = Object.entries(stats)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.bytes - a.bytes);
  return ranked;
}
