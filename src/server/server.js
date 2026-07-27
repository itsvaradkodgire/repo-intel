/**
 * server.js — local application server for the Repository Intelligence Platform.
 *
 * Endpoints:
 *   GET  /                         -> web app (SPA)
 *   POST /api/analyze              -> { input, ref? } start analysis; streams SSE progress + final index
 *   GET  /api/index/:id            -> cached full index JSON
 *   GET  /api/refs?id=             -> branches/tags/commits for a cached repo
 *   POST /api/compare              -> { input, baseRef, headRef } -> structured diff
 *   POST /api/ai/models            -> { config } -> discovered models
 *   POST /api/ai/chat              -> { id, question, history, config } -> SSE grounded answer
 *
 * AI is optional. API keys are sent per-request from the browser and used only to
 * call the provider server-side (never persisted). Nothing calls AI unless a
 * config with a model is supplied.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { ingest, gitRefs } from '../analyzer/ingest.js';
import { analyzeRepo } from '../analyzer/analyze.js';
import { compareIndexes } from '../analyzer/compare.js';
import { listModels, chat, PROVIDER_PRESETS, resolveConfig } from '../ai/providers.js';
import { buildMessages } from '../ai/grounding.js';
import { buildChatMessages } from '../ai/context-builder.js';
import { overviewMessages, mentorStepMessages, explainMessages, commitMessages, graphStoryMessages, graphNodeMessages } from '../ai/generators.js';
import { impactOfFile, impactOfFunction, impactOfTable, traceData, traceRequest, traceFlow } from '../analyzer/trace.js';
import { initBrain, loadBrain, brainSummary, brainSearch, brainSimilar, getInsights, getTimeline, reindex, getHistory, memoryList, clearMemory, getPlugins } from '../brain/brain.js';
import { answerIntent, conversationalMap } from '../intel/intent.js';
import { productOverviewMessages, systemStoryMessages, tourStopMessages, journeyMessages, whyEdgeMessages, intentNarrativeMessages, scorecardMessages } from '../ai/intel-generators.js';
import { buildTraceModel, investigateFeature, explainCalculation, traceVariable, getMethodDetail } from '../trace/index.js';
import { capabilityReport } from '../trace/adapters.js';
import { traceExplainMessages } from '../ai/trace-generators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '../../web');
const CACHE = new Map(); // id -> { index, dir }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function sseInit(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
}
function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
function idFor(input, ref) { return crypto.createHash('sha1').update(input + '@' + (ref || '')).digest('hex').slice(0, 12); }

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  const full = path.join(WEB_DIR, rel);
  if (!full.startsWith(WEB_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    // SPA fallback
    const idx = path.join(WEB_DIR, 'index.html');
    if (fs.existsSync(idx)) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(idx)); }
    return send(res, 404, { error: 'not found' });
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

async function handleAnalyze(req, res) {
  sseInit(res);
  let body;
  try { body = await readBody(req); } catch { sseSend(res, 'error', { message: 'bad request' }); return res.end(); }
  const { input, ref } = body;
  if (!input) { sseSend(res, 'error', { message: 'input required' }); return res.end(); }
  const id = idFor(input, ref);
  try {
    sseSend(res, 'progress', { message: 'Resolving repository...' });
    const ing = await ingest(input, { ref, onLog: (m) => sseSend(res, 'progress', { message: m }) });
    const index = await analyzeRepo(ing.dir, { onLog: (m) => sseSend(res, 'progress', { message: m }) });
    index.source = { input: ing.input, source: ing.source, git: ing.meta, id, brainDir: ing.dir };
    CACHE.set(id, { index, dir: ing.dir, input });
    // persist to disk cache for reload
    try {
      const cdir = path.join(process.env.REPO_INTEL_CACHE || path.join(process.env.HOME, '.repo-intel-cache'), 'indexes');
      fs.mkdirSync(cdir, { recursive: true });
      fs.writeFileSync(path.join(cdir, id + '.json'), JSON.stringify(index));
    } catch {}
    // Phase 4: initialize the Repository Brain (embeddings, insights, plugins,
    // change history). Non-blocking for the response; runs right after 'done'.
    sseSend(res, 'progress', { message: 'Waking the Repository Brain...' });
    try { const summary = await initBrain(id, index, ing.dir); sseSend(res, 'brain', summary.stored); } catch (e) { sseSend(res, 'progress', { message: 'brain init skipped: ' + e.message }); }
    sseSend(res, 'done', { id, manifest: index.manifest, git: ing.meta });
  } catch (e) {
    sseSend(res, 'error', { message: e.message });
  }
  res.end();
}

function getCached(id) {
  if (CACHE.has(id)) return CACHE.get(id).index;
  try {
    const p = path.join(process.env.REPO_INTEL_CACHE || path.join(process.env.HOME, '.repo-intel-cache'), 'indexes', id + '.json');
    if (fs.existsSync(p)) { const index = JSON.parse(fs.readFileSync(p, 'utf8')); CACHE.set(id, { index }); return index; }
  } catch {}
  return null;
}

async function handleAiModels(req, res) {
  const body = await readBody(req);
  const result = await listModels(body.config || {});
  send(res, 200, result);
}

async function handleAiChat(req, res) {
  const body = await readBody(req);
  const { id, question, history, config } = body;
  const index = getCached(id);
  if (!index) return send(res, 404, { error: 'index not found; analyze first' });
  if (!config || !config.model) return send(res, 400, { error: 'AI not configured' });
  // Phase 2: graph-aware context builder (falls back safely to lexical evidence).
  const { messages, evidence } = buildChatMessages(index, question, history || []);
  sseInit(res);
  sseSend(res, 'evidence', evidence.map((e) => ({ type: e.type, title: e.title, ref: e.ref, relation: e.relation })));
  try {
    await chat({ ...config, stream: true }, messages, (delta) => sseSend(res, 'delta', { text: delta }));
    sseSend(res, 'done', {});
  } catch (e) {
    sseSend(res, 'error', { message: e.message });
  }
  res.end();
}

// ---- Phase 2 additive handlers ----
async function handleAiTest(req, res) {
  const body = await readBody(req);
  const cfg = resolveConfig(body.config || {});
  try {
    // a models fetch is the cheapest liveness probe; if unavailable, do a tiny chat
    const models = await listModels(body.config || {});
    if (models.ok) return send(res, 200, { ok: true, models: models.models.slice(0, 50), detail: `${models.models.length} models available` });
    if (!cfg.model) return send(res, 200, { ok: false, error: models.error || 'model list unavailable; set a model and try a chat probe' });
    // fallback: 1-token chat
    let got = '';
    await chat({ ...body.config, stream: false, maxTokens: 5 }, [{ role: 'user', content: 'ping' }], (d) => { got += d; });
    return send(res, 200, { ok: true, detail: 'chat probe succeeded' });
  } catch (e) {
    return send(res, 200, { ok: false, error: e.message });
  }
}

async function handleAiGenerate(req, res) {
  const body = await readBody(req);
  const { id, kind, config, subject, mode, step } = body;
  const index = getCached(id);
  if (!index) return send(res, 404, { error: 'index not found' });
  if (!config || !config.model) return send(res, 400, { error: 'AI not configured' });
  let messages;
  if (kind === 'overview') messages = overviewMessages(index);
  else if (kind === 'mentor') messages = mentorStepMessages(index, step);
  else if (kind === 'explain') messages = explainMessages(index, subject, mode);
  else return send(res, 400, { error: 'unknown kind' });
  sseInit(res);
  try {
    await chat({ ...config, stream: true, maxTokens: config.maxTokens || 1600 }, messages, (d) => sseSend(res, 'delta', { text: d }));
    sseSend(res, 'done', {});
  } catch (e) { sseSend(res, 'error', { message: e.message }); }
  res.end();
}

// ---- Phase 3: Repository Brain — an incremental cache of AI node/graph
// explanations keyed by (indexId + kind + subject). Persisted to disk so it
// survives restarts and is only recomputed when the node/model changes.
const BRAIN_DIR = path.join(process.env.REPO_INTEL_CACHE || path.join(process.env.HOME, '.repo-intel-cache'), 'brain');
function brainKey(id, parts) { return crypto.createHash('sha1').update(id + '|' + parts.join('|')).digest('hex').slice(0, 16); }
function brainGet(id, parts) {
  try { const p = path.join(BRAIN_DIR, id, brainKey(id, parts) + '.txt'); if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch {}
  return null;
}
function brainPut(id, parts, text) {
  try { const d = path.join(BRAIN_DIR, id); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, brainKey(id, parts) + '.txt'), text); } catch {}
}

async function handleAiGraph(req, res) {
  const body = await readBody(req);
  const { id, kind, config } = body;
  const index = getCached(id);
  if (!index) return send(res, 404, { error: 'index not found' });
  if (!config || !config.model) return send(res, 400, { error: 'AI not configured' });
  let messages, cacheParts = null;
  if (kind === 'story') {
    messages = graphStoryMessages(index, body.visible || [], body.mode, body.layer, body.intent);
  } else if (kind === 'node') {
    messages = graphNodeMessages(index, body.nodeId, body.nodeKind, body.label, body.path);
    cacheParts = ['node', body.nodeId, config.model]; // stable -> Repository Brain cache
  } else {
    return send(res, 400, { error: 'unknown graph kind' });
  }
  if (cacheParts) {
    const cached = brainGet(id, cacheParts);
    if (cached) { sseInit(res); sseSend(res, 'delta', { text: cached }); sseSend(res, 'cached', { cached: true }); sseSend(res, 'done', {}); return res.end(); }
  }
  sseInit(res);
  let acc = '';
  try {
    await chat({ ...config, stream: true, maxTokens: config.maxTokens || 900 }, messages, (d) => { acc += d; sseSend(res, 'delta', { text: d }); });
    if (cacheParts && acc.trim()) brainPut(id, cacheParts, acc);
    sseSend(res, 'done', {});
  } catch (e) { sseSend(res, 'error', { message: e.message }); }
  res.end();
}

async function handleImpact(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  const kind = url.searchParams.get('kind');
  const target = url.searchParams.get('target');
  const index = getCached(id);
  if (!index) return send(res, 404, { error: 'index not found' });
  let result = null;
  if (kind === 'file') result = impactOfFile(index, target);
  else if (kind === 'function') result = impactOfFunction(index, target);
  else if (kind === 'table') result = impactOfTable(index, target);
  return result ? send(res, 200, result) : send(res, 404, { error: 'target not found' });
}

async function handleTrace(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  const kind = url.searchParams.get('kind');
  const index = getCached(id);
  if (!index) return send(res, 404, { error: 'index not found' });
  let result = null;
  if (kind === 'data') result = traceData(index, url.searchParams.get('table'));
  else if (kind === 'request') result = traceRequest(index, url.searchParams.get('method'), url.searchParams.get('path'), url.searchParams.get('file'));
  else if (kind === 'flow') result = traceFlow(index, url.searchParams.get('flow'));
  return result ? send(res, 200, result) : send(res, 404, { error: 'trace target not found' });
}

// ---- Phase 5: Intent & Business Intelligence endpoints ----
async function handleIntel(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return send(res, 400, { error: 'id query param required' });
  const index = getCached(id);
  if (!index) return send(res, 404, { error: 'index not found' });
  if (!index.intel) return send(res, 404, { error: 'intel not available (re-analyze to build the intelligence layer)' });
  const section = url.searchParams.get('section');
  if (section && index.intel[section] !== undefined) return send(res, 200, index.intel[section]);
  return send(res, 200, index.intel);
}

async function handleIntelQuery(req, res) {
  const body = await readBody(req);
  const { id, query, mode } = body;
  if (!id) return send(res, 400, { error: 'id required' });
  const index = getCached(id);
  if (!index) return send(res, 404, { error: 'index not found' });
  if (!index.intel) return send(res, 404, { error: 'intel not available' });
  if (!query || !query.trim()) return send(res, 400, { error: 'query required' });
  const intel = index.intel;
  if (mode === 'map') {
    return send(res, 200, conversationalMap(index, intel.capabilities, intel.systemMap, query));
  }
  return send(res, 200, answerIntent(index, intel.capabilities, intel.systemMap, query));
}

async function handleAiIntel(req, res) {
  const body = await readBody(req);
  const { id, kind, config } = body;
  const index = getCached(id);
  if (!index) return send(res, 404, { error: 'index not found' });
  if (!index.intel) return send(res, 404, { error: 'intel not available' });
  if (!config || !config.model) return send(res, 400, { error: 'AI not configured' });
  const intel = index.intel;
  let messages, cacheParts = null;
  if (kind === 'product') { messages = productOverviewMessages(intel); }
  else if (kind === 'story') { messages = systemStoryMessages(intel, body.systemId); cacheParts = ['intel-story', body.systemId, config.model]; }
  else if (kind === 'tour') { messages = tourStopMessages(intel, body.systemId); cacheParts = ['intel-tour', body.systemId, config.model]; }
  else if (kind === 'journey') { messages = journeyMessages(intel, body.journeyId); cacheParts = ['intel-journey', body.journeyId, config.model]; }
  else if (kind === 'why') { messages = whyEdgeMessages(intel, body.source, body.target); cacheParts = ['intel-why', body.source, body.target, config.model]; }
  else if (kind === 'scorecard') { messages = scorecardMessages(intel); }
  else if (kind === 'intent') {
    const result = answerIntent(index, intel.capabilities, intel.systemMap, body.query || '');
    messages = intentNarrativeMessages(intel, result);
  } else return send(res, 400, { error: 'unknown intel kind' });
  if (!messages) return send(res, 404, { error: 'intel subject not found' });
  if (cacheParts) {
    const cached = brainGet(id, cacheParts);
    if (cached) { sseInit(res); sseSend(res, 'delta', { text: cached }); sseSend(res, 'cached', { cached: true }); sseSend(res, 'done', {}); return res.end(); }
  }
  sseInit(res);
  let acc = '';
  try {
    await chat({ ...config, stream: true, maxTokens: config.maxTokens || 1200 }, messages, (d) => { acc += d; sseSend(res, 'delta', { text: d }); });
    if (cacheParts && acc.trim()) brainPut(id, cacheParts, acc);
    sseSend(res, 'done', {});
  } catch (e) { sseSend(res, 'error', { message: e.message }); }
  res.end();
}

// ---- Trace Engine endpoints (verified code investigation) ----
// The full queryable model (with method bodies + Maps) is heavy and not
// serialized to disk; rebuild + cache it in memory on demand from the repo dir.
const TRACE_MODELS = new Map(); // id -> model (with live _sindex)
async function getTraceModel(id) {
  if (TRACE_MODELS.has(id)) return TRACE_MODELS.get(id);
  const index = getCached(id);
  if (!index) return null;
  const dir = brainDirFor(id);
  if (!dir) return null;
  const model = await buildTraceModel(index, dir);
  model._universalIndex = index;
  TRACE_MODELS.set(id, model);
  return model;
}

async function handleTraceSummary(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return send(res, 400, { error: 'id query param required' });
  const index = getCached(id);
  if (!index) return send(res, 404, { error: 'index not found' });
  // prefer the serialized summary on the index; fall back to (re)building
  let summary = index.trace;
  if (!summary || summary.available === undefined) {
    const m = await getTraceModel(id);
    summary = m ? { available: m.available, stats: m.stats, crossLayer: m.crossLayer, looseEnds: m.looseEnds, symbols: m.symbols, capabilities: m.capabilities } : { available: false };
  }
  // ensure the capability report is always present for the UI (derive if missing)
  if (summary && summary.capabilities === undefined) {
    try { summary = { ...summary, capabilities: capabilityReport(index.languages || []) }; } catch { /* non-fatal */ }
  }
  return send(res, 200, summary);
}

async function handleTraceInvestigate(req, res) {
  const body = await readBody(req);
  const { id, query } = body;
  if (!id || !query) return send(res, 400, { error: 'id and query required' });
  const model = await getTraceModel(id);
  if (!model) return send(res, 404, { error: 'index not found' });
  if (!model.available) return send(res, 200, { available: false, reason: model.reason });
  return send(res, 200, { available: true, ...investigateFeature(model, query) });
}

async function handleTraceExplain(req, res) {
  const body = await readBody(req);
  const { id, method, variable } = body;
  if (!id || !method || !variable) return send(res, 400, { error: 'id, method, variable required' });
  const model = await getTraceModel(id);
  if (!model || !model.available) return send(res, 404, { error: 'trace unavailable' });
  return send(res, 200, explainCalculation(model, method, variable));
}

async function handleTraceVariable(req, res) {
  const body = await readBody(req);
  const { id, method, variable, direction } = body;
  if (!id || !method || !variable) return send(res, 400, { error: 'id, method, variable required' });
  const model = await getTraceModel(id);
  if (!model || !model.available) return send(res, 404, { error: 'trace unavailable' });
  return send(res, 200, traceVariable(model, method, variable, direction || 'backward'));
}

async function handleTraceMethod(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  const method = url.searchParams.get('method');
  if (!id || !method) return send(res, 400, { error: 'id and method required' });
  const model = await getTraceModel(id);
  if (!model || !model.available) return send(res, 404, { error: 'trace unavailable' });
  const d = getMethodDetail(model, method);
  return d ? send(res, 200, d) : send(res, 404, { error: 'method not found' });
}

async function handleTraceSource(req, res) {
  // return a source-code range for evidence display (file:line inspection)
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  const file = url.searchParams.get('file');
  const from = Math.max(1, parseInt(url.searchParams.get('from') || '1', 10));
  const to = parseInt(url.searchParams.get('to') || String(from + 30), 10);
  if (!id || !file) return send(res, 400, { error: 'id and file required' });
  const dir = brainDirFor(id);
  if (!dir) return send(res, 404, { error: 'repo dir unavailable' });
  try {
    const full = path.join(dir, file);
    if (!full.startsWith(path.resolve(dir))) return send(res, 400, { error: 'invalid path' });
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const slice = lines.slice(from - 1, to);
    return send(res, 200, { file, from, to: from - 1 + slice.length, lines: slice });
  } catch (e) { return send(res, 404, { error: 'file not found' }); }
}

async function handleAiTraceExplain(req, res) {
  const body = await readBody(req);
  const { id, kind, config } = body;
  const model = await getTraceModel(id);
  if (!model || !model.available) return send(res, 404, { error: 'trace unavailable' });
  if (!config || !config.model) return send(res, 400, { error: 'AI not configured' });
  let payload;
  if (kind === 'calculation') payload = explainCalculation(model, body.method, body.variable);
  else if (kind === 'flow') { const r = investigateFeature(model, body.query || ''); payload = r.flows.find((f) => f.id === body.flowId) || r.flows[0]; }
  else if (kind === 'variable') payload = traceVariable(model, body.method, body.variable, body.direction || 'backward');
  else return send(res, 400, { error: 'unknown kind' });
  const messages = traceExplainMessages(kind, payload, body);
  if (!messages) return send(res, 404, { error: 'nothing to explain' });
  sseInit(res);
  try {
    await chat({ ...config, stream: true, maxTokens: config.maxTokens || 1000 }, messages, (d) => sseSend(res, 'delta', { text: d }));
    sseSend(res, 'done', {});
  } catch (e) { sseSend(res, 'error', { message: e.message }); }
  res.end();
}

// ---- Phase 4: Repository Brain endpoints ----
function brainDirFor(id) { const c = CACHE.get(id); if (c && c.dir) return c.dir; const idx = getCached(id); return idx && idx.source && idx.source.brainDir; }

async function handleBrain(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return send(res, 400, { error: 'id query param required' });
  let brain = loadBrain(id);
  if (!brain) {
    const idx = getCached(id);
    if (!idx) return send(res, 404, { error: 'index not found' });
    await initBrain(id, idx, brainDirFor(id));
    brain = loadBrain(id);
  }
  return send(res, 200, brainSummary(brain));
}
async function handleBrainSearch(req, res) {
  const body = await readBody(req);
  const { id, query, limit } = body;
  if (!id) return send(res, 400, { error: 'id required' });
  if (!getCached(id)) return send(res, 404, { error: 'index not found' });
  if (!loadBrain(id)) await initBrain(id, getCached(id), brainDirFor(id));
  return send(res, 200, brainSearch(id, query || '', { limit: limit || 24 }));
}
async function handleBrainInsights(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return send(res, 400, { error: 'id query param required' });
  if (!getCached(id)) return send(res, 404, { error: 'index not found' });
  if (!loadBrain(id)) await initBrain(id, getCached(id), brainDirFor(id));
  const ins = getInsights(id);
  return ins ? send(res, 200, ins) : send(res, 404, { error: 'insights unavailable' });
}
async function handleBrainTimeline(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return send(res, 400, { error: 'id query param required' });
  const dir = brainDirFor(id);
  if (!dir) return send(res, 404, { error: 'repo working dir not available (needs a git clone)' });
  const tl = await getTimeline(id, dir);
  return send(res, 200, tl);
}
async function handleBrainReindex(req, res) {
  const body = await readBody(req);
  const { id } = body;
  if (!id) return send(res, 400, { error: 'id required' });
  const dir = brainDirFor(id);
  if (!dir) return send(res, 404, { error: 'repo working dir not available' });
  if (!loadBrain(id)) { const idx = getCached(id); if (!idx) return send(res, 404, { error: 'index not found' }); await initBrain(id, idx, dir); }
  const result = await reindex(id, dir);
  const brain = loadBrain(id);
  if (brain && CACHE.has(id)) CACHE.get(id).index = brain.index;
  return send(res, 200, result);
}
async function handleBrainMemory(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return send(res, 400, { error: 'id query param required' });
  if (req.method === 'DELETE') return send(res, 200, clearMemory(id));
  return send(res, 200, { memory: memoryList(id), history: getHistory(id).slice(-60) });
}
async function handleBrainSimilar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return send(res, 400, { error: 'id query param required' });
  if (!loadBrain(id)) { const idx = getCached(id); if (idx) await initBrain(id, idx, brainDirFor(id)); }
  return send(res, 200, brainSimilar(id, url.searchParams.get('node'), Number(url.searchParams.get('limit')) || 10));
}
async function handleBrainPlugins(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return send(res, 400, { error: 'id query param required' });
  if (!loadBrain(id)) { const idx = getCached(id); if (idx) await initBrain(id, idx, brainDirFor(id)); }
  const pl = getPlugins(id);
  return pl ? send(res, 200, pl) : send(res, 404, { error: 'plugins unavailable' });
}

async function handleCommitIntel(req, res) {
  const body = await readBody(req);
  const { input, baseRef, headRef, config } = body;
  if (!input || !baseRef || !headRef) return send(res, 400, { error: 'input, baseRef, headRef required' });
  const ingA = await ingest(input, { ref: baseRef });
  const a = await analyzeRepo(ingA.dir); a.source = { git: ingA.meta };
  const ingB = await ingest(input, { ref: headRef });
  const b = await analyzeRepo(ingB.dir); b.source = { git: ingB.meta };
  const diff = compareIndexes(a, b);
  if (!config || !config.model) return send(res, 200, { diff, ai: null });
  const messages = commitMessages(b, diff, baseRef, headRef);
  sseInit(res);
  sseSend(res, 'diff', diff);
  try {
    await chat({ ...config, stream: true, maxTokens: 1200 }, messages, (d) => sseSend(res, 'delta', { text: d }));
    sseSend(res, 'done', {});
  } catch (e) { sseSend(res, 'error', { message: e.message }); }
  res.end();
}

async function handleCompare(req, res) {
  const body = await readBody(req);
  const { input, baseRef, headRef } = body;
  if (!input || !baseRef || !headRef) return send(res, 400, { error: 'input, baseRef, headRef required' });
  const ingA = await ingest(input, { ref: baseRef });
  const a = await analyzeRepo(ingA.dir); a.source = { git: ingA.meta };
  const ingB = await ingest(input, { ref: headRef });
  const b = await analyzeRepo(ingB.dir); b.source = { git: ingB.meta };
  send(res, 200, { base: baseRef, head: headRef, diff: compareIndexes(a, b) });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method === 'POST' && p === '/api/analyze') return await handleAnalyze(req, res);
    if (req.method === 'GET' && p.startsWith('/api/index/')) {
      const index = getCached(p.split('/').pop());
      return index ? send(res, 200, index) : send(res, 404, { error: 'not found' });
    }
    if (req.method === 'GET' && p === '/api/refs') {
      const id = url.searchParams.get('id');
      const entry = CACHE.get(id);
      if (!entry || !entry.dir) return send(res, 404, { error: 'repo not cached' });
      return send(res, 200, await gitRefs(entry.dir));
    }
    if (req.method === 'POST' && p === '/api/compare') return await handleCompare(req, res);
    if (req.method === 'GET' && p === '/api/providers') return send(res, 200, { providers: PROVIDER_PRESETS });
    if (req.method === 'POST' && p === '/api/ai/models') return await handleAiModels(req, res);
    if (req.method === 'POST' && p === '/api/ai/test') return await handleAiTest(req, res);
    if (req.method === 'POST' && p === '/api/ai/chat') return await handleAiChat(req, res);
    if (req.method === 'POST' && p === '/api/ai/generate') return await handleAiGenerate(req, res);
    if (req.method === 'POST' && p === '/api/ai/graph') return await handleAiGraph(req, res);
    if (req.method === 'GET' && p === '/api/impact') return await handleImpact(req, res);
    if (req.method === 'GET' && p === '/api/trace') return await handleTrace(req, res);
    if (req.method === 'POST' && p === '/api/commit-intel') return await handleCommitIntel(req, res);
    if (req.method === 'GET' && p === '/api/brain') return await handleBrain(req, res);
    if (req.method === 'POST' && p === '/api/brain/search') return await handleBrainSearch(req, res);
    if (req.method === 'GET' && p === '/api/brain/insights') return await handleBrainInsights(req, res);
    if (req.method === 'GET' && p === '/api/brain/timeline') return await handleBrainTimeline(req, res);
    if (req.method === 'POST' && p === '/api/brain/reindex') return await handleBrainReindex(req, res);
    if ((req.method === 'GET' || req.method === 'DELETE') && p === '/api/brain/memory') return await handleBrainMemory(req, res);
    if (req.method === 'GET' && p === '/api/brain/similar') return await handleBrainSimilar(req, res);
    if (req.method === 'GET' && p === '/api/brain/plugins') return await handleBrainPlugins(req, res);
    if (req.method === 'GET' && p === '/api/intel') return await handleIntel(req, res);
    if (req.method === 'POST' && p === '/api/intel/query') return await handleIntelQuery(req, res);
    if (req.method === 'POST' && p === '/api/ai/intel') return await handleAiIntel(req, res);
    if (req.method === 'GET' && p === '/api/trace2') return await handleTraceSummary(req, res);
    if (req.method === 'POST' && p === '/api/trace2/investigate') return await handleTraceInvestigate(req, res);
    if (req.method === 'POST' && p === '/api/trace2/explain') return await handleTraceExplain(req, res);
    if (req.method === 'POST' && p === '/api/trace2/variable') return await handleTraceVariable(req, res);
    if (req.method === 'GET' && p === '/api/trace2/method') return await handleTraceMethod(req, res);
    if (req.method === 'GET' && p === '/api/trace2/source') return await handleTraceSource(req, res);
    if (req.method === 'POST' && p === '/api/ai/trace') return await handleAiTraceExplain(req, res);
    if (req.method === 'GET') return serveStatic(req, res, p);
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

const PORT = process.env.PORT || 4477;
// Safety nets: a single bad request must never take down the platform.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.stack || err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack || err);
});
server.listen(PORT, () => {
  console.log(`\n  Repository Intelligence Platform`);
  console.log(`  → http://localhost:${PORT}\n`);
});
