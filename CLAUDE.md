# AISynth (Ollama Nexus)

React 18 (Create React App) web app: a local client for Ollama with five views: Chat, Agent, Workflow, What-If (agent swarm), Imagine AI. Optional Electron wrapper in `electron/`. No backend; everything runs in the browser against Ollama (`localhost:11434`) and a Stable Diffusion WebUI (`127.0.0.1:7860`).

## Commands

- `npm start` dev server on :3000
- `CI=true npm run build` must pass before any commit (CI treats lint warnings as errors)
- `npm run build && npm run test:e2e` 31 browser checks against `tools/mock-server.js` (needs `npx playwright install chromium` once)
- `npm run mock` fake Ollama + image engine for manual poking

## Layout

- `src/App.jsx` header, connection bar, tabs, settings. Settings live in one persisted object (`src/lib/settings.js`).
- `src/views/*` one file per view. `src/lib/*` shared logic. `src/components/common.jsx` Markdown, icons, small widgets.
- `src/lib/ollama.js` all Ollama calls and `extractJson`. `src/lib/tools.js` the agent tools. `src/lib/sandbox.js` runs untrusted JS in a Worker.
- Persistence: `usePersistentState(key, initial)` in `src/lib/storage.js` (localStorage, prefix `aisynth:`). Images use IndexedDB (`src/lib/idb.js`).

## Conventions

- Function components and hooks only. Inline styles using tokens from `src/theme.js`. Dark theme only; do not add a light theme or change the palette without being asked.
- Handlers are named `handleX` in canvas code, otherwise plain verbs (`send`, `generate`).
- Never hardcode model names: models come from `/api/tags`.
- Every call to Ollama passes `modelOptions(settings, ...)` so `num_ctx` applies.
- Chat uses `chatStream` (buffers partial JSON lines). Do not go back to splitting each network chunk on newlines.
- Any code that came from a model or from an imported workflow runs through `runInSandbox`, never `eval`/`new Function` on the main thread.
- Keep the mock mode working: LLM nodes simulate when Ollama is disconnected; `npm run mock` must keep supporting the e2e suite.
- Add or update a check in `tools/e2e.js` when you change behaviour a user can see.

## Gotchas

- **Workflow canvas mouse events** are fragile. Ports use `onMouseDown` with `stopPropagation`, nodes skip dragging when `e.target.dataset.port` is set, and connecting mode is cancelled only by mouse-down on empty canvas or Esc. A Condition node has two output ports (`branch` "true"/"false" stored on the edge). Re-test connecting two nodes after any change here.
- Names starting with `use` are treated as hooks by the linter; do not name event handlers `useX`.
- Closures inside loops that read a reassigned `let` fail `no-loop-func`; copy to a `const` first.
- Imagine AI uses the AUTOMATIC1111/Forge API (`/sdapi/v1/txt2img|img2img`). When `n_iter > 1` the engine may prepend a grid image; the code keeps only the last `n`.
- Ollama image generation is macOS-only and its HTTP API is undocumented, so it is not used.
- The Electron wrapper has not been built on Windows. Treat `npm run dist:win` as unverified.

## Don't

- Don't add a backend or a framework migration (TypeScript, Next.js) unless asked.
- Don't remove the sandbox, the plan-approval step in What-If, or the mock mode.
- Don't commit `build/`, `dist/` or `node_modules/`.
