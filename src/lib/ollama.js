// Thin client for the Ollama REST API (/api/tags, /api/chat) plus JSON helpers
// for coaxing structured output from local models.

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export const cleanBase = (url) => (url || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, "");

export async function listModels(base, signal) {
  const resp = await fetch(`${cleanBase(base)}/api/tags`, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.models || []).map((m) => m.name);
}

// Ollama's default context window is small; let the user raise it in Settings.
export function modelOptions(settings, extra = {}) {
  const o = { ...extra };
  const ctx = Number(settings?.numCtx);
  if (ctx > 0) o.num_ctx = ctx;
  return o;
}

async function readError(resp) {
  try {
    const t = await resp.text();
    try {
      const j = JSON.parse(t);
      return j.error || t;
    } catch {
      return t;
    }
  } catch {
    return "";
  }
}

export async function chatOnce({ base, model, messages, options, format, signal }) {
  const resp = await fetch(`${cleanBase(base)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, options, ...(format ? { format } : {}) }),
    signal,
  });
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await readError(resp)}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.message?.content || "";
}

// Streams tokens. Buffers partial lines so a JSON object split across network
// chunks is never dropped.
export async function chatStream({ base, model, messages, options, signal, onToken }) {
  const resp = await fetch(`${cleanBase(base)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options }),
    signal,
  });
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await readError(resp)}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";

  const handleLine = (line) => {
    line = line.trim();
    if (!line) return;
    let j;
    try { j = JSON.parse(line); } catch { return; }
    if (j.error) throw new Error(j.error);
    const t = j.message?.content;
    if (t) {
      full += t;
      onToken?.(t, full);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handleLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  handleLine(buf);
  return full;
}

// ─── JSON extraction ───────────────────────────────────────────

function escapeNewlinesInStrings(s) {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

function tryParse(s) {
  try { return JSON.parse(s); } catch {}
  const fixed = escapeNewlinesInStrings(s);
  try { return JSON.parse(fixed); } catch {}
  try { return JSON.parse(fixed.replace(/,\s*([}\]])/g, "$1")); } catch {}
  return undefined;
}

function balancedSlice(s) {
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// Returns the first JSON object/array found in text, or null.
export function extractJson(text) {
  if (!text) return null;
  const s = String(text).replace(/```(?:json)?/gi, "").trim();
  const direct = tryParse(s);
  if (direct !== undefined) return direct;
  const slice = balancedSlice(s);
  if (slice) {
    const parsed = tryParse(slice);
    if (parsed !== undefined) return parsed;
  }
  return null;
}
