const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, ".out"); // scratch output, git-ignored
fs.mkdirSync(DIR, { recursive: true });
const SHOTS = path.join(DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
fs.writeFileSync(path.join(DIR, "input.png"), Buffer.from(PNG_B64, "base64"));

const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); };
const mock = async (p, body) => (await fetch("http://localhost:11434" + p, body ? { method: "POST", body: JSON.stringify(body) } : {})).json();

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    if (!localStorage.getItem("aisynth:settings")) localStorage.setItem("aisynth:settings", JSON.stringify({ searxUrl: "http://localhost:11434" }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push("console: " + m.text()); });
  const nav = (name) => page.getByRole("button", { name, exact: true }).click();
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + ".png") });

  await page.goto("http://localhost:3000");
  await page.getByText("Connected", { exact: true }).waitFor({ timeout: 10000 });
  check("connects to Ollama and lists models", await page.locator("select option", { hasText: "mock-llama:8b" }).count() > 0);

  // ── Chat ──
  await page.getByPlaceholder(/Message mock-llama/).fill("hi there");
  await page.getByPlaceholder(/Message mock-llama/).press("Enter");
  await page.getByText("streaming works.").first().waitFor({ timeout: 10000 });
  check("chat streams a full reply even when JSON lines are split across chunks", await page.getByText("Hello from the mock model, streaming works.").count() > 0);
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByText("Hello from the mock model, streaming works.").first().waitFor({ timeout: 10000 });
  check("chat history survives a reload", true);
  await page.getByRole("button", { name: "New chat" }).click();
  check("new chat creates a second session", (await page.locator('button[title="Delete chat"]').count()) === 2);
  await shot("1-chat");

  // ── Agent ──
  await nav("Agent");
  await page.getByPlaceholder(/agent's goal/).fill("Work out 6*7 and save it");
  await page.getByPlaceholder(/agent's goal/).press("Enter");
  await page.getByText("The answer is 42 and it is saved to notes.md.").first().waitFor({ timeout: 20000 });
  check("agent finishes with DONE", true);
  check("web_search tool returned results (SearXNG mock)", await page.getByText(/Mock result about transformers/).count() > 0);
  check("execute_code ran in the sandbox and returned 42", await page.getByText(/return: 42/).count() > 0);
  check("write_file stored the file in the workspace", await page.getByText(/Files \(1\)/).count() > 0);
  await page.getByText(/Files \(1\)/).click();
  check("workspace shows notes.md", await page.getByText("notes.md").count() > 0);
  await shot("2-agent");

  // ── Workflow ──
  await nav("Workflow");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("Workflow complete.").first().waitFor({ timeout: 20000 });
  check("default workflow runs end to end with real LLM calls", await page.getByText(/Mock LLM reply/).count() > 0);
  await page.locator("select").filter({ hasText: "Templates" }).selectOption({ label: "Draft, review, branch" });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("Condition is true").first().waitFor({ timeout: 20000 });
  await page.getByText("Workflow complete.").first().waitFor({ timeout: 20000 });
  check("condition routes down the TRUE branch", true);
  await mock("/__mode", { review: "REVISE needs work" });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("Condition is false").first().waitFor({ timeout: 20000 });
  await page.getByText("Workflow complete.").first().waitFor({ timeout: 20000 });
  check("condition routes down the FALSE branch (revise path)", true);
  await mock("/__mode", { review: "APPROVED" });
  check("condition node exposes two output ports", (await page.locator('[data-port="out"][title="True"]').count()) === 1 && (await page.locator('[data-port="out"][title="False"]').count()) === 1);
  await page.getByRole("button", { name: /Close/ }).click();
  const before = await page.locator("svg g").count();
  await page.getByRole("button", { name: /Transform/ }).click();
  await page.locator('[data-port="out"]').first().dispatchEvent("mousedown");
  await page.locator('[data-port="in"]').last().dispatchEvent("mousedown");
  const after = await page.locator("svg g").count();
  check("connecting an output port to an input port creates an edge", after === before + 1, `edges ${before} -> ${after}`);
  await shot("3-workflow");
  // persistence
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByText("Connected", { exact: true }).waitFor({ timeout: 10000 });
  check("workflow survives a reload", await page.locator("svg g").count() === after);
  // export
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('button[title="Download as JSON"]').click()]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  check("workflow exports as JSON", exported.app === "aisynth-workflow" && exported.nodes.length >= 8 && exported.edges.length === after);
  // import round trip
  fs.writeFileSync(path.join(DIR, "wf.json"), JSON.stringify(exported));
  await page.locator('input[type="file"]').first().setInputFiles(path.join(DIR, "wf.json"));
  await page.getByText(/Imported/).waitFor({ timeout: 5000 });
  check("workflow imports from JSON", true);

  // ── What-if swarm ──
  await nav("What-If");
  await page.getByPlaceholder(/Describe the situation/).fill("What if we raise our SaaS price by 15%?");
  await page.getByRole("button", { name: /Run swarm/ }).click();
  await page.getByText("Review before running").waitFor({ timeout: 20000 });
  check("swarm pauses for plan approval", true);
  check("broken generated tool was repaired automatically", await page.getByText("repaired", { exact: true }).count() > 0);
  await shot("4-swarm-review");
  await page.getByRole("button", { name: "Approve and run" }).click();
  await page.locator("table").first().waitFor({ timeout: 60000 });
  check("final report renders a scenario comparison table", await page.locator("table th").count() >= 4);
  await page.getByRole("button", { name: "Live", exact: true }).click();
  check("agents called the generated tool during discussion", await page.getByText(/used buggy_calc/).count() > 0);
  check("agents addressed each other", await page.getByText(/@Analyst|@Skeptic/).count() > 0);
  await shot("5-swarm-live");
  const log = await mock("/__log");
  check("num_ctx is sent on model calls", log.some((l) => l.num_ctx === 8192));
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByText("Connected", { exact: true }).waitFor({ timeout: 10000 });
  check("last swarm run is restored after reload", await page.locator("table").count() > 0);

  // ── Imagine AI ──
  await nav("Imagine AI");
  await page.getByText(/Image engine: connected/).waitFor({ timeout: 10000 });
  await page.getByPlaceholder(/lighthouse/).fill("a lighthouse");
  await page.getByRole("button", { name: /Generate/ }).click();
  await page.locator('img[alt="a lighthouse"]').first().waitFor({ timeout: 20000 });
  let l = (await mock("/__log")).filter((x) => x.path === "/sdapi/v1/txt2img").pop();
  check("txt2img used the LLM-improved prompt", l && /cinematic lighting/.test(l.prompt) && /blurry/.test(l.negative), l && l.prompt);
  await page.getByText("Image settings").click();
  await page.getByText("Images", { exact: true }).locator("xpath=following-sibling::input").fill("2");
  await page.getByRole("button", { name: /Generate/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('img[alt="a lighthouse"]').length >= 3, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  check("batch of 2 adds exactly 2 images (grid dropped)", await page.locator('img[alt="a lighthouse"]').count() === 3);
  await page.locator('input[type="file"]').last().setInputFiles(path.join(DIR, "input.png"));
  await page.getByRole("button", { name: /Describe with AI/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("textarea")].some((t) => /red square/.test(t.value)), null, { timeout: 10000 });
  check("vision model describes the uploaded image into the prompt", true);
  await page.getByRole("button", { name: /Transform image/ }).click();
  await page.waitForFunction(() => document.querySelectorAll("img[alt]").length >= 5, null, { timeout: 20000 });
  l = (await mock("/__log")).filter((x) => x.path === "/sdapi/v1/img2img").pop();
  check("image input goes through img2img with denoising strength", l && l.init && l.denoise === 0.6, JSON.stringify(l));
  await shot("6-imagine");
  await page.reload();
  await page.getByText(/Image engine/).waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check("gallery survives a reload (IndexedDB)", await page.locator("img[alt]").count() >= 4, String(await page.locator("img[alt]").count()));

  // ── Settings / backup ──
  await page.getByTitle("Settings").click();
  const [bk] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
  const backup = JSON.parse(fs.readFileSync(await bk.path(), "utf8"));
  check("backup contains chats, workflows and settings", backup.app === "aisynth" && ["aisynth:chats", "aisynth:wf-current", "aisynth:settings"].every((k) => k in backup.data));
  await shot("7-settings");

  check("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
