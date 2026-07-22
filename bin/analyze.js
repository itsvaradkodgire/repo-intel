#!/usr/bin/env node
/**
 * bin/analyze.js — CLI entry: analyze a repo (URL or path) and write the index.
 *
 *   node bin/analyze.js <url|path> [--ref <branch|tag|sha>] [--out <dir>]
 */
import { ingest } from '../src/analyzer/ingest.js';
import { analyzeRepo } from '../src/analyzer/analyze.js';
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ref') args.ref = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--depth') args.depth = Number(argv[++i]);
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input) {
    console.error('Usage: node bin/analyze.js <git-url|local-path> [--ref <ref>] [--out <dir>]');
    process.exit(1);
  }
  const log = (m) => console.error('[repo-intel] ' + m);
  const ing = await ingest(input, { ref: args.ref, onLog: log });
  const index = await analyzeRepo(ing.dir, { onLog: log });
  index.source = { input: ing.input, source: ing.source, git: ing.meta };

  const outDir = args.out || path.join(process.cwd(), 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
  log(`wrote ${path.join(outDir, 'index.json')} (${(fs.statSync(path.join(outDir, 'index.json')).size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(JSON.stringify(index.manifest.counts, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
