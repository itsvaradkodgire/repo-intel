/**
 * analyze.js — the orchestrator. Produces the complete repository index +
 * knowledge graph from a working directory. Everything is derived from the AST
 * extraction and the detectors; nothing is invented.
 *
 * Output shape (the "index") is consumed by both the offline web app and the AI
 * grounding layer:
 *   { manifest, files[], functions[], classes[], imports (edges), graph, routes,
 *     db, env, security, deps, infra, jobs, flows, metrics, languages }
 */
import fs from 'fs';
import path from 'path';
import { walkRepo, detectLanguages } from './walk.js';
import { extractFile } from './extract.js';
import { LANGUAGES } from './languages.js';
import { detectRoutes, detectDbAccess, detectEnvVars, detectSecurity } from './detectors.js';
import { parseManifest, detectInfra, detectJobs } from './config.js';
import { resolveImports } from './resolve.js';
import { buildGraph } from './graph.js';
import { computeMetrics } from './metrics.js';
import { inferFlows } from './flows.js';
import { buildSemantic } from './semantic.js';
import { buildSemanticGraph } from './semantic-graph.js';

export async function analyzeRepo(dir, opts = {}) {
  const log = opts.onLog || (() => {});
  const t0 = Date.now();
  log('Walking repository...');
  const { files, skipped } = walkRepo(dir);
  log(`  ${files.length} files (skipped ${skipped.binary} binary, ${skipped.tooBig} large)`);

  const langStats = detectLanguages(files);
  log(`  languages: ${langStats.slice(0, 6).map((l) => `${l.label} (${l.files})`).join(', ')}`);

  const fileRecords = [];
  const allFunctions = [];
  const allClasses = [];
  const routes = [];
  const dbHits = [];
  const envVars = [];
  const security = [];
  const deps = [];
  const infra = [];
  const jobs = [];
  const manifests = [];

  let parsed = 0;
  for (const file of files) {
    let src;
    try { src = fs.readFileSync(file.abs, 'utf8'); } catch { continue; }
    if (src.includes('\u0000')) continue; // binary sniff

    // manifests / infra / config always processed by name
    if (file.meta) {
      const man = parseManifest(file, src);
      if (man) { manifests.push(man); for (const d of man.deps) deps.push({ ...d, from: file.path, ecosystem: man.ecosystem }); }
    }
    const inf = detectInfra(file);
    if (inf) infra.push(inf);

    const def = LANGUAGES[file.lang];
    const isCode = def && !def.data;

    // detectors run on any text file (routes/db/env/security are cross-language)
    if (isCode || file.ext === '.sql' || file.meta === 'env' || def) {
      for (const r of detectRoutes(file, src)) routes.push(r);
      for (const d of detectDbAccess(file, src)) dbHits.push(d);
      for (const e of detectEnvVars(file, src)) envVars.push(e);
      for (const s of detectSecurity(file, src)) security.push(s);
      for (const j of detectJobs(file, src)) jobs.push(j);
    }

    // AST extraction for code files
    if (isCode) {
      const rec = await extractFile(file, src);
      if (rec) {
        fileRecords.push(rec);
        for (const fn of rec.functions) allFunctions.push({ ...fn, file: rec.path, lang: rec.lang, id: `${rec.path}::${fn.name}#${fn.line}` });
        for (const c of rec.classes) allClasses.push({ ...c, file: rec.path, lang: rec.lang, id: `${rec.path}::${c.name}` });
        parsed++;
        if (parsed % 200 === 0) log(`  parsed ${parsed} code files...`);
      } else {
        // still record the file (unparsed) so it appears in the tree
        fileRecords.push(minimalRecord(file, src));
      }
    } else if (def && def.data) {
      fileRecords.push(minimalRecord(file, src));
    } else if (file.meta) {
      fileRecords.push(minimalRecord(file, src));
    }
  }
  log(`  extracted ${allFunctions.length} functions, ${allClasses.length} classes from ${parsed} files`);

  // resolve import edges to in-repo files
  log('Resolving imports...');
  resolveImports(fileRecords);

  // build knowledge graph + reverse indexes
  log('Building knowledge graph...');
  const graph = buildGraph({ files: fileRecords, functions: allFunctions, classes: allClasses, routes, dbHits, deps, envVars, infra, jobs });

  // metrics
  log('Computing metrics...');
  const metrics = computeMetrics({ files: fileRecords, functions: allFunctions, classes: allClasses, graph });

  // business flows
  log('Inferring business flows...');
  const flows = inferFlows({ files: fileRecords, functions: allFunctions, routes, dbHits, graph });

  // dedupe dbHits into tables
  const tables = summarizeTables(dbHits, fileRecords);

  const langOut = langStats.map((l) => ({ id: l.id, label: l.label, files: l.files, bytes: l.bytes }));

  const manifest = {
    generatedAt: new Date().toISOString(),
    root: dir,
    tookMs: Date.now() - t0,
    counts: {
      files: fileRecords.length,
      codeFiles: parsed,
      functions: allFunctions.length,
      classes: allClasses.length,
      routes: dedupeRoutes(routes).length,
      tables: tables.length,
      envVars: uniqueBy(envVars, 'name').length,
      dependencies: uniqueBy(deps, 'name').length,
      securityFindings: security.length,
      languages: langOut.length,
      flows: flows.length,
      loc: fileRecords.reduce((s, f) => s + (f.loc || 0), 0),
    },
  };

  const result = {
    manifest,
    languages: langOut,
    files: fileRecords,
    functions: allFunctions,
    classes: allClasses,
    routes: dedupeRoutes(routes),
    tables,
    dbAccess: dbHits,
    env: uniqueBy(envVars, 'name'),
    security,
    dependencies: dedupeDependencies(deps),
    manifests,
    infra,
    jobs,
    flows,
    graph,
    metrics,
  };

  // ---- Phase 2 (additive): mechanical semantic layer ----
  log('Building semantic layer...');
  try {
    result.semantic = buildSemantic(result);
  } catch (e) {
    log('  semantic layer failed (non-fatal): ' + e.message);
    result.semantic = null;
  }

  // ---- Phase 3 (additive): mechanical semantic graph engine ----
  log('Building semantic graph...');
  try {
    result.semanticGraph = result.semantic ? buildSemanticGraph(result) : null;
  } catch (e) {
    log('  semantic graph failed (non-fatal): ' + e.message);
    result.semanticGraph = null;
  }

  return result;
}

function minimalRecord(file, src) {
  const loc = src.split('\n').length;
  return { path: file.path, lang: file.lang || 'other', loc, sloc: loc, size: file.size, functions: [], classes: [], imports: [], calls: [], complexity: 0, meta: file.meta || null };
}

function dedupeRoutes(routes) {
  const seen = new Set(); const out = [];
  for (const r of routes) { const k = r.method + ' ' + r.path + ' ' + r.file; if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}
function uniqueBy(arr, key) {
  const seen = new Set(); const out = [];
  for (const x of arr) { if (!seen.has(x[key])) { seen.add(x[key]); out.push(x); } }
  return out;
}
function dedupeDependencies(deps) {
  const map = new Map();
  for (const d of deps) {
    const k = d.ecosystem + ':' + d.name;
    if (!map.has(k)) map.set(k, { name: d.name, version: d.version, scope: d.scope, ecosystem: d.ecosystem, from: d.from });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeTables(dbHits, files) {
  const tables = new Map();
  for (const h of dbHits) {
    if (!h.table) continue;
    const name = h.table;
    if (!tables.has(name)) tables.set(name, { name, kinds: new Set(), readBy: new Set(), writtenBy: new Set(), definedIn: null, accesses: 0 });
    const t = tables.get(name);
    t.kinds.add(h.kind);
    t.accesses++;
    const write = /write|insert|update|delete|create|save|upsert/i.test(h.kind + ' ' + (h.op || ''));
    if (h.kind === 'ddl-table') t.definedIn = h.file;
    if (write) t.writtenBy.add(h.file); else t.readBy.add(h.file);
  }
  return [...tables.values()].map((t) => ({
    name: t.name, kinds: [...t.kinds], definedIn: t.definedIn,
    readBy: [...t.readBy], writtenBy: [...t.writtenBy], accesses: t.accesses,
  })).sort((a, b) => b.accesses - a.accesses);
}
