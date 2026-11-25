// Runs untrusted JavaScript (LLM-written tools, workflow transforms) inside a
// throwaway Web Worker with a hard timeout. The worker has no DOM, no
// localStorage and network APIs are disabled on a best-effort basis.
//
// This is a convenience boundary, not a hardened security boundary. Review code
// you did not write before running it.

const WORKER_SRC = `
self.onmessage = async (ev) => {
  const { code, args } = ev.data;
  const logs = [];
  const fmt = (a) => a.map((x) => {
    if (typeof x === "string") return x;
    try { return JSON.stringify(x); } catch (e) { return String(x); }
  }).join(" ");
  const con = {
    log: (...a) => logs.push(fmt(a)),
    info: (...a) => logs.push(fmt(a)),
    warn: (...a) => logs.push("WARN: " + fmt(a)),
    error: (...a) => logs.push("ERROR: " + fmt(a)),
  };
  const safe = (v) => {
    if (v === undefined) return null;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return String(v); }
  };
  for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches"]) {
    try { Object.defineProperty(self, k, { value: undefined, configurable: true, writable: true }); } catch (e) {}
  }
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction("args", "console", code);
    const result = await fn(args, con);
    self.postMessage({ ok: true, result: safe(result), logs });
  } catch (e) {
    self.postMessage({ ok: false, error: String((e && e.message) || e), logs });
  }
};
`;

export function runInSandbox(code, args = {}, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let worker;
    let url;
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker && worker.terminate(); } catch {}
      try { url && URL.revokeObjectURL(url); } catch {}
      resolve(res);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `Timed out after ${timeoutMs} ms`, logs: [] }), timeoutMs);
    try {
      url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "application/javascript" }));
      worker = new Worker(url);
      worker.onmessage = (ev) => finish(ev.data);
      worker.onerror = (ev) => finish({ ok: false, error: ev.message || "Worker error", logs: [] });
      worker.postMessage({ code: String(code || ""), args });
    } catch (e) {
      finish({ ok: false, error: `Sandbox unavailable: ${e.message}`, logs: [] });
    }
  });
}

// Formats a sandbox result for showing to a model or a human.
export function formatSandboxResult(res, max = 1500) {
  const parts = [];
  if (res.logs && res.logs.length) parts.push(`console:\n${res.logs.join("\n")}`);
  if (res.ok) {
    if (res.result !== null && res.result !== undefined) {
      parts.push(`return: ${typeof res.result === "string" ? res.result : JSON.stringify(res.result)}`);
    } else if (!parts.length) {
      parts.push("(no output; use console.log or return a value)");
    }
  } else {
    parts.push(`ERROR: ${res.error}`);
  }
  const text = parts.join("\n");
  return text.length > max ? text.slice(0, max) + "\n…[truncated]" : text;
}
