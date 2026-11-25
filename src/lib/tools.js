// Real tools for Agent mode, workflow Tool nodes and the swarm.
//
//  web_search    Wikipedia API (or your own SearXNG instance, see Settings)
//  read_file     agent workspace (virtual file system in browser storage)
//  write_file    agent workspace
//  list_files    agent workspace
//  execute_code  JavaScript in a sandboxed Web Worker
//  summarize     the selected Ollama model
//  analyze_data  the selected Ollama model

import { chatOnce, extractJson, modelOptions } from "./ollama";
import { formatSandboxResult, runInSandbox } from "./sandbox";
import { vfsList, vfsRead, vfsWrite } from "./vfs";

export const TOOL_DEFS = [
  { name: "web_search", desc: "Search the web (Wikipedia, or SearXNG if configured) and return top results", params: ["query"] },
  { name: "read_file", desc: "Read a file from the agent workspace", params: ["path"] },
  { name: "write_file", desc: "Write a file to the agent workspace", params: ["path", "content"] },
  { name: "list_files", desc: "List files in the agent workspace", params: [] },
  { name: "execute_code", desc: "Run JavaScript in a sandbox. Use console.log and return; no network access", params: ["code"] },
  { name: "summarize", desc: "Summarize a long text", params: ["text"] },
  { name: "analyze_data", desc: "Answer a question about data (CSV, JSON or text)", params: ["data", "question"] },
];

const clip = (s, n = 4000) => (s.length > n ? s.slice(0, n) + "\n…[truncated]" : s);
const asText = (v) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 2));

// ─── web search ────────────────────────────────────────────────
async function searchWikipedia(query, signal) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&generator=search" +
    `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=4&prop=extracts%7Cinfo&inprop=url` +
    "&exintro=1&explaintext=1&exchars=500&exlimit=max&format=json&origin=*";
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`Wikipedia HTTP ${resp.status}`);
  const data = await resp.json();
  const pages = Object.values(data.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  if (!pages.length) return `No results found for "${query}".`;
  return pages
    .map((p, i) => `${i + 1}. ${p.title}: ${(p.extract || "").replace(/\s+/g, " ").trim()}\n   ${p.fullurl || ""}`)
    .join("\n");
}

async function searchSearx(base, query, signal) {
  const url = `${base.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`SearXNG HTTP ${resp.status}`);
  const data = await resp.json();
  const results = (data.results || []).slice(0, 5);
  if (!results.length) return `No results found for "${query}".`;
  return results.map((r, i) => `${i + 1}. ${r.title}: ${(r.content || "").slice(0, 300)}\n   ${r.url}`).join("\n");
}

export async function webSearch(query, settings, signal) {
  if (!query) throw new Error("web_search needs a 'query'");
  if (settings?.searxUrl) {
    try {
      return await searchSearx(settings.searxUrl, query, signal);
    } catch {
      /* fall back to Wikipedia */
    }
  }
  return searchWikipedia(query, signal);
}

// ─── dispatcher ────────────────────────────────────────────────
// ctx: { base, model, settings, signal }
export async function runTool(name, params = {}, ctx = {}) {
  const p = params && typeof params === "object" ? params : {};
  try {
    switch (name) {
      case "web_search":
        return clip(await webSearch(asText(p.query || p.q), ctx.settings, ctx.signal));
      case "read_file":
        return clip(vfsRead(p.path));
      case "write_file": {
        const path = vfsWrite(p.path, asText(p.content));
        return `Wrote ${asText(p.content).length} characters to ${path}`;
      }
      case "list_files": {
        const files = vfsList();
        return files.length ? files.join("\n") : "(workspace is empty)";
      }
      case "execute_code": {
        const lang = String(p.language || "javascript").toLowerCase();
        if (!/^(js|javascript|node)$/.test(lang)) {
          return `ERROR: only JavaScript can run in the browser sandbox (got "${lang}"). Rewrite the code in JavaScript.`;
        }
        const res = await runInSandbox(asText(p.code), {}, 5000);
        return clip(formatSandboxResult(res));
      }
      case "summarize": {
        const text = asText(p.text);
        if (!text) return "ERROR: summarize needs 'text'";
        return clip(
          await chatOnce({
            base: ctx.base,
            model: ctx.model,
            signal: ctx.signal,
            options: modelOptions(ctx.settings, { temperature: 0.2 }),
            messages: [
              { role: "system", content: "Summarize the user's text in a few clear sentences. Keep every number and name that matters." },
              { role: "user", content: text.slice(0, 12000) },
            ],
          })
        );
      }
      case "analyze_data": {
        const data = asText(p.data);
        if (!data) return "ERROR: analyze_data needs 'data'";
        return clip(
          await chatOnce({
            base: ctx.base,
            model: ctx.model,
            signal: ctx.signal,
            options: modelOptions(ctx.settings, { temperature: 0.2 }),
            messages: [
              { role: "system", content: "You are a careful data analyst. Answer the question using only the data given. Show key numbers." },
              { role: "user", content: `DATA:\n${data.slice(0, 12000)}\n\nQUESTION: ${asText(p.question) || "Summarize the main patterns."}` },
            ],
          })
        );
      }
      default:
        return `ERROR: unknown tool "${name}". Available: ${TOOL_DEFS.map((t) => t.name).join(", ")}`;
    }
  } catch (e) {
    if (e.name === "AbortError") throw e;
    return `ERROR: ${e.message}`;
  }
}

// ─── parsing the TOOL:/PARAMS: protocol ───────────────────────
// Models are told to answer with
//   TOOL: name
//   PARAMS: {"key": "value"}
export function parseToolCall(reply) {
  const m = /^\s*TOOL:\s*`?([A-Za-z_][A-Za-z0-9_]*)/m.exec(reply || "");
  if (!m) return null;
  let params = {};
  const pi = reply.indexOf("PARAMS:", m.index);
  if (pi >= 0) {
    const parsed = extractJson(reply.slice(pi + 7));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) params = parsed;
  }
  return { name: m[1], params, reasoning: reply.slice(0, m.index).trim() };
}
