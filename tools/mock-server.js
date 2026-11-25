// Mock Ollama (11434), SearXNG (same port) and Stable Diffusion WebUI (7860) used by tools/e2e.js.
// Run on its own with `npm run mock` to try the app without Ollama or a GPU.
const http = require("http");

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const mode = { review: "APPROVED" };
const log = [];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", ...cors }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reply(req) {
  const msgs = req.messages || [];
  const sys = (msgs.find((m) => m.role === "system") || {}).content || "";
  const lastUser = [...msgs].reverse().find((m) => m.role === "user") || { content: "" };
  const assistants = msgs.filter((m) => m.role === "assistant").length;

  if (msgs[0] && msgs[0].images) return "a red square on a white background";
  if (/design a swarm/i.test(sys)) {
    return JSON.stringify({
      summary: "Compare baseline against two what-if variants using three viewpoints.",
      scenarios: [{ name: "Baseline", description: "Keep things as they are" }, { name: "Raise 15%", description: "Increase the price" }, { name: "Raise 5%", description: "Small increase" }],
      agents: [
        { name: "Analyst", role: "Lead analyst", instructions: "Frame the problem", tools: ["buggy_calc"] },
        { name: "Skeptic", role: "Devil's advocate", instructions: "Find risks", tools: [] },
        { name: "Quant", role: "Modeler", instructions: "Model it", tools: [] },
      ],
      tools: [{ name: "buggy_calc", description: "doubles a number", params: ["x"], example_args: { x: 2 }, code: "const {x} = args; return undefinedVariable * x;" }],
    });
  }
  if (/repair JavaScript/i.test(sys)) return JSON.stringify({ code: "const {x} = args; return {double: x * 2};" });
  if (/Synthesizer/i.test(sys)) {
    return "# Pricing what-if\n\n## Bottom line\nRaise prices by 5%.\n\n## Scenario comparison\n| Scenario | Key assumptions | Upside | Risks | Verdict |\n| --- | --- | --- | --- | --- |\n| Baseline | no change | stable | stagnation | hold |\n| Raise 5% | low churn | +revenue | some churn | go |\n\n## Next steps\n1. Pilot the change.\n2. Measure churn.";
  }
  if (/WHAT-IF ANALYSIS together/i.test(sys)) {
    const name = (/You are (\w+),/.exec(sys) || [])[1];
    if (/TOOL RESULT/.test(lastUser.content)) return `Using the tool the doubled value is 10, so the 15% scenario looks strong. @Skeptic what do you think?`;
    if (/You speak first/.test(lastUser.content)) return `TOOL: buggy_calc\nPARAMS: {"x": 5}`;
    return `${name} here: @Analyst I agree on the baseline, but churn risk is real in the Raise 15% scenario.`;
  }
  if (/Stable Diffusion/i.test(sys)) return JSON.stringify({ prompt: "a lighthouse at sunrise, detailed, cinematic lighting, 8k", negative: "blurry" });
  if (/autonomous AI agent/i.test(sys)) {
    const steps = [
      `I will search first.\nTOOL: web_search\nPARAMS: {"query": "transformers"}`,
      `Now compute.\nTOOL: execute_code\nPARAMS: {"code": "console.log('calc'); return 6*7;"}`,
      `Save it.\nTOOL: write_file\nPARAMS: {"path": "notes.md", "content": "The answer is 42"}`,
      `DONE: The answer is 42 and it is saved to notes.md.`,
    ];
    return steps[Math.min(assistants, steps.length - 1)];
  }
  if (/strict editor/i.test(sys)) return mode.review;
  if (req.stream) return "Hello from the mock model, streaming works.";
  return `Mock LLM reply for: ${String(lastUser.content).slice(0, 40)}`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  // control
  if (url.pathname === "/__mode") { Object.assign(mode, await body(req)); return send(res, 200, mode); }
  if (url.pathname === "/__log") return send(res, 200, log);

  // Ollama
  if (url.pathname === "/api/tags") return send(res, 200, { models: [{ name: "mock-llama:8b" }, { name: "mock-llava:7b" }] });
  if (url.pathname === "/api/chat") {
    const r = await body(req);
    log.push({ path: "/api/chat", stream: r.stream, format: r.format, num_ctx: r.options && r.options.num_ctx, hasImages: !!(r.messages && r.messages[0] && r.messages[0].images) });
    const text = reply(r);
    if (!r.stream) return send(res, 200, { message: { role: "assistant", content: text }, done: true });
    res.writeHead(200, { "Content-Type": "application/x-ndjson", ...cors });
    // stream word by word, and split every JSON line across two writes to test line buffering
    const words = text.split(/(?<= )/);
    for (const w of words) {
      const line = JSON.stringify({ message: { role: "assistant", content: w }, done: false }) + "\n";
      const mid = Math.floor(line.length / 2);
      res.write(line.slice(0, mid));
      await sleep(8);
      res.write(line.slice(mid));
    }
    res.write(JSON.stringify({ done: true }) + "\n");
    return res.end();
  }

  // SearXNG
  if (url.pathname === "/search") return send(res, 200, { results: [{ title: "Mock result about " + url.searchParams.get("q"), url: "http://example.test/a", content: "Transformers use attention." }] });

  // Stable Diffusion WebUI
  if (url.pathname === "/sdapi/v1/sd-models") return send(res, 200, [{ title: "mock-sd15.safetensors [abc]" }]);
  if (url.pathname === "/sdapi/v1/progress") return send(res, 200, { progress: 0.5, state: { sampling_step: 10, sampling_steps: 25, job_no: 0, job_count: 1 } });
  if (url.pathname === "/sdapi/v1/interrupt") return send(res, 200, {});
  if (url.pathname === "/sdapi/v1/txt2img" || url.pathname === "/sdapi/v1/img2img") {
    const r = await body(req);
    log.push({ path: url.pathname, prompt: r.prompt, negative: r.negative_prompt, n_iter: r.n_iter, width: r.width, height: r.height, init: !!(r.init_images && r.init_images.length), denoise: r.denoising_strength, ckpt: r.override_settings && r.override_settings.sd_model_checkpoint });
    await sleep(1500);
    const n = r.n_iter || 1;
    const images = Array.from({ length: n }, () => PNG);
    if (n > 1) images.unshift(PNG); // grid first, like the real engine
    return send(res, 200, { images, parameters: {}, info: JSON.stringify({ seed: 1234, all_seeds: Array.from({ length: n }, (_, i) => 1234 + i) }) });
  }
  send(res, 404, { error: "not found: " + url.pathname });
}).listen(11434, () => console.log("mock ollama on 11434"));

// The image engine on 7860 reuses the same handler by proxying.
const proxy = http.createServer((req, res) => {
  const p = http.request({ host: "127.0.0.1", port: 11434, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(p);
});
proxy.listen(7860, () => console.log("mock SD on 7860"));
