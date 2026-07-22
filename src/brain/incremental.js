/**
 * incremental.js — incremental re-analysis (ADDITIVE, Phase 4).
 *
 * Given a previously analyzed working dir + its index, detects which files
 * changed (by content hash), re-parses ONLY those, and returns the set of
 * added/modified/deleted files plus fresh per-file records. The Brain applies
 * these patches and recomputes only the affected derived data. This avoids a
 * full rebuild on small changes. Non-blocking: callers run it in the background.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { walkRepo } from '../analyzer/walk.js';
import { extractFile } from '../analyzer/extract.js';
import { LANGUAGES } from '../analyzer/languages.js';

function fileHash(abs){
  try { const buf = fs.readFileSync(abs); return crypto.createHash('sha1').update(buf).digest('hex').slice(0,16); } catch { return null; }
}

// Build a path->hash map from a fresh walk (cheap; only stats + hashes code files).
export function snapshotHashes(dir){
  const { files } = walkRepo(dir);
  const map = new Map();
  for(const f of files){ map.set(f.path, { hash:fileHash(f.abs), abs:f.abs, lang:f.lang, meta:f.meta, ext:f.ext, size:f.size }); }
  return map;
}

/**
 * Diff a fresh snapshot against a stored one.
 * prevHashes: { path: hash }  (persisted alongside the index)
 * Returns { added:[], modified:[], deleted:[], unchanged:number }
 */
export function diffSnapshots(prevHashes, snap){
  const added=[], modified=[], deleted=[]; let unchanged=0;
  const prevPaths = new Set(Object.keys(prevHashes||{}));
  for(const [p, info] of snap){
    if(!prevPaths.has(p)) added.push(p);
    else if(prevHashes[p]!==info.hash) modified.push(p);
    else unchanged++;
  }
  for(const p of prevPaths){ if(!snap.has(p)) deleted.push(p); }
  return { added, modified, deleted, unchanged };
}

// Re-parse a set of paths into fresh file records (code files only get AST).
export async function reparse(dir, paths, snap){
  const records = [];
  for(const p of paths){
    const info = snap.get(p);
    if(!info) continue;
    let src; try { src = fs.readFileSync(info.abs,'utf8'); } catch { continue; }
    const def = LANGUAGES[info.lang];
    if(def && !def.data){
      const rec = await extractFile({ path:p, lang:info.lang, size:info.size, ext:info.ext }, src);
      if(rec) records.push(rec);
    }
  }
  return records;
}

export function hashesFromSnapshot(snap){
  const out={}; for(const [p,info] of snap) out[p]=info.hash; return out;
}
