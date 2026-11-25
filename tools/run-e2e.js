// Serves ./build on :3000, starts the mock Ollama / image engine, runs tools/e2e.js, cleans up.
// Usage: npm run build && npm run test:e2e   (needs: npx playwright install chromium, once)
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "build");
if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("No build found. Run `npm run build` first.");
  process.exit(2);
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".map": "application/json" };

const web = http
  .createServer((req, res) => {
    let p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, "index.html");
    res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  })
  .listen(3000, "127.0.0.1");

const mock = spawn(process.execPath, [path.join(__dirname, "mock-server.js")], { stdio: "inherit" });
setTimeout(() => {
  const t = spawn(process.execPath, [path.join(__dirname, "e2e.js")], { stdio: "inherit" });
  t.on("exit", (code) => { mock.kill(); web.close(); process.exit(code ?? 1); });
}, 1200);
