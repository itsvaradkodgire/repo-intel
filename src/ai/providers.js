/**
 * providers.js — provider-agnostic AI abstraction.
 *
 * A single interface { listModels(), chat(messages, opts) } implemented by a set
 * of adapters. New providers are added by registering an adapter; core logic never
 * changes. AI is OPTIONAL: nothing here runs unless the user supplies a config.
 *
 * Built-in adapters:
 *   - openai-compatible : OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral,
 *                         LM Studio, and any /v1/chat/completions endpoint.
 *   - anthropic         : Claude Messages API.
 *   - gemini            : Google Generative Language API.
 *   - ollama            : local Ollama (/api/chat, /api/tags).
 *
 * Model discovery is attempted per provider; if unavailable the UI lets the user
 * type a model name.
 */

const DEFAULT_BASE = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  lmstudio: 'http://localhost:1234/v1',
  ollama: 'http://localhost:11434',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

// which adapter handles a given provider id
function adapterFor(providerId) {
  if (providerId === 'anthropic') return 'anthropic';
  if (providerId === 'gemini') return 'gemini';
  if (providerId === 'ollama') return 'ollama';
  return 'openai'; // everything else speaks the OpenAI-compatible dialect
}

export function resolveConfig(cfg = {}) {
  const provider = cfg.provider || 'openai';
  const adapter = adapterFor(provider);
  const baseUrl = (cfg.baseUrl || DEFAULT_BASE[provider] || DEFAULT_BASE.openai).replace(/\/$/, '');
  return {
    provider, adapter, baseUrl,
    apiKey: cfg.apiKey || '',
    model: cfg.model || '',
    temperature: cfg.temperature != null ? cfg.temperature : 0.2,
    maxTokens: cfg.maxTokens != null ? cfg.maxTokens : 1024,
    topP: cfg.topP != null ? cfg.topP : undefined,
    stream: cfg.stream !== false,
  };
}

// ---- model discovery -------------------------------------------------------
export async function listModels(cfg) {
  const c = resolveConfig(cfg);
  try {
    if (c.adapter === 'openai') {
      const res = await fetch(`${c.baseUrl}/models`, { headers: authHeaders(c) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const models = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
      return { ok: true, models };
    }
    if (c.adapter === 'ollama') {
      const res = await fetch(`${c.baseUrl}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return { ok: true, models: (j.models || []).map((m) => m.name) };
    }
    if (c.adapter === 'gemini') {
      const res = await fetch(`${c.baseUrl}/v1beta/models?key=${encodeURIComponent(c.apiKey)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return { ok: true, models: (j.models || []).map((m) => (m.name || '').replace(/^models\//, '')).filter(Boolean) };
    }
    if (c.adapter === 'anthropic') {
      // Anthropic added /v1/models; try it, fall back to a static list.
      try {
        const res = await fetch(`${c.baseUrl}/v1/models`, { headers: anthropicHeaders(c) });
        if (res.ok) { const j = await res.json(); return { ok: true, models: (j.data || []).map((m) => m.id) }; }
      } catch { /* fall through */ }
      return { ok: true, models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'] };
    }
  } catch (e) {
    return { ok: false, error: e.message, models: [] };
  }
  return { ok: false, error: 'unsupported', models: [] };
}

function authHeaders(c) {
  const h = { 'Content-Type': 'application/json' };
  if (c.apiKey) h['Authorization'] = `Bearer ${c.apiKey}`;
  return h;
}
function anthropicHeaders(c) {
  return { 'Content-Type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' };
}

// ---- chat (streaming) ------------------------------------------------------
/**
 * chat(cfg, messages, onDelta) -> { text }
 * messages: [{ role: 'system'|'user'|'assistant', content }]
 * onDelta(textChunk) called as tokens stream (if streaming enabled + supported).
 */
export async function chat(cfg, messages, onDelta) {
  const c = resolveConfig(cfg);
  if (!c.model) throw new Error('No model configured');
  if (c.adapter === 'openai') return openaiChat(c, messages, onDelta);
  if (c.adapter === 'ollama') return ollamaChat(c, messages, onDelta);
  if (c.adapter === 'anthropic') return anthropicChat(c, messages, onDelta);
  if (c.adapter === 'gemini') return geminiChat(c, messages, onDelta);
  throw new Error('Unsupported provider');
}

async function openaiChat(c, messages, onDelta) {
  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST', headers: authHeaders(c),
    body: JSON.stringify({ model: c.model, messages, temperature: c.temperature, ...(c.topP != null ? { top_p: c.topP } : {}), max_tokens: c.maxTokens, stream: c.stream }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (!c.stream) { const j = await res.json(); return { text: j.choices?.[0]?.message?.content || '' }; }
  return streamSSE(res, (data) => {
    try { const j = JSON.parse(data); return j.choices?.[0]?.delta?.content || ''; } catch { return ''; }
  }, onDelta);
}

async function ollamaChat(c, messages, onDelta) {
  const res = await fetch(`${c.baseUrl}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: c.model, messages, stream: c.stream, options: { temperature: c.temperature } }),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  if (!c.stream) { const j = await res.json(); return { text: j.message?.content || '' }; }
  // ollama streams newline-delimited JSON
  let full = '';
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      try { const j = JSON.parse(line); const d = j.message?.content || ''; if (d) { full += d; onDelta && onDelta(d); } } catch {}
    }
  }
  return { text: full };
}

async function anthropicChat(c, messages, onDelta) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const res = await fetch(`${c.baseUrl}/v1/messages`, {
    method: 'POST', headers: anthropicHeaders(c),
    body: JSON.stringify({ model: c.model, system, messages: msgs, max_tokens: c.maxTokens, temperature: c.temperature, stream: c.stream }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (!c.stream) { const j = await res.json(); return { text: (j.content || []).map((b) => b.text || '').join('') }; }
  return streamSSE(res, (data) => {
    try { const j = JSON.parse(data); if (j.type === 'content_block_delta') return j.delta?.text || ''; } catch {} return '';
  }, onDelta);
}

async function geminiChat(c, messages, onDelta) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = { contents, generationConfig: { temperature: c.temperature, maxOutputTokens: c.maxTokens } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const url = `${c.baseUrl}/v1beta/models/${encodeURIComponent(c.model)}:${c.stream ? 'streamGenerateContent' : 'generateContent'}?key=${encodeURIComponent(c.apiKey)}${c.stream ? '&alt=sse' : ''}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (!c.stream) { const j = await res.json(); return { text: (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('') }; }
  return streamSSE(res, (data) => {
    try { const j = JSON.parse(data); return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''); } catch { return ''; }
  }, onDelta);
}

// shared SSE stream reader
async function streamSSE(res, extract, onDelta) {
  let full = '';
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return { text: full };
      const delta = extract(data);
      if (delta) { full += delta; onDelta && onDelta(delta); }
    }
  }
  return { text: full };
}

export const PROVIDER_PRESETS = [
  { id: 'openai', label: 'OpenAI', base: DEFAULT_BASE.openai, needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', base: DEFAULT_BASE.openrouter, needsKey: true },
  { id: 'groq', label: 'Groq', base: DEFAULT_BASE.groq, needsKey: true },
  { id: 'together', label: 'Together AI', base: DEFAULT_BASE.together, needsKey: true },
  { id: 'deepseek', label: 'DeepSeek', base: DEFAULT_BASE.deepseek, needsKey: true },
  { id: 'mistral', label: 'Mistral', base: DEFAULT_BASE.mistral, needsKey: true },
  { id: 'anthropic', label: 'Anthropic (Claude)', base: DEFAULT_BASE.anthropic, needsKey: true },
  { id: 'gemini', label: 'Google Gemini', base: DEFAULT_BASE.gemini, needsKey: true },
  { id: 'ollama', label: 'Ollama (local)', base: DEFAULT_BASE.ollama, needsKey: false },
  { id: 'lmstudio', label: 'LM Studio (local)', base: DEFAULT_BASE.lmstudio, needsKey: false },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', base: '', needsKey: false },
];
