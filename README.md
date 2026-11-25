# AISynth (Ollama Nexus)

A local-first AI workbench on top of [Ollama](https://ollama.com). Everything runs on your machine.

| View | What it does |
|---|---|
| **Chat** | Streaming chat with any installed model. Multiple saved chats, system prompt and temperature per chat, export to Markdown. |
| **Agent** | An autonomous loop that plans, calls real tools and answers. Tools: Wikipedia/SearXNG search, a JavaScript sandbox, a file workspace, summarize, analyze. |
| **Workflow** | Visual node editor (Start, LLM, Condition, Tool, Transform, Output, End). Real execution, true/false branching, save/load, JSON import/export, templates. |
| **What-If** | A swarm of agents designed by the model: it creates the agents, writes and tests its own JavaScript tools, the agents debate over rounds, a synthesizer writes a scenario-comparison report. |
| **Imagine AI** | Text to image, or image plus instruction to image, through a local Stable Diffusion WebUI. Ollama improves your prompt and can describe uploaded pictures. |

## Quick start (Windows, macOS, Linux)

1. Install [Node.js 20+](https://nodejs.org) and [Ollama](https://ollama.com/download).
2. Pull a model: `ollama pull llama3.1:8b` (any model works).
3. Allow the browser app to talk to Ollama. Windows (PowerShell), then restart Ollama:
   ```powershell
   setx OLLAMA_ORIGINS "http://localhost:3000"
   ```
   macOS/Linux: `OLLAMA_ORIGINS=http://localhost:3000 ollama serve`
4. Run the app:
   ```bash
   npm install
   npm start
   ```
   It opens at http://localhost:3000.

No Ollama handy? `npm run mock` starts a fake Ollama and image engine so you can click through every screen.

## Using each view

**Chat.** Pick a model in the bar under the header and type. Chats are saved in your browser. The context window (default 8192 tokens) is set in Settings; Ollama's own default is small and silently cuts long prompts.

**Agent.** Describe a goal. Toggle tools under *Tools*. `write_file` saves into a workspace (see *Files*, with download buttons). `execute_code` runs JavaScript only. `web_search` uses Wikipedia unless you set a SearXNG URL in Settings.

**Workflow.** Click an output port (right), then an input port (left). A Condition node has a green port (true) and a red port (false). `{{input}}` is the workflow input and `{{last}}` the previous node's output inside prompts and tool parameters. Transform and Condition code run in the sandbox. Delete removes the selected node, Esc cancels a connection.

**What-If.** Describe the problem and the what-if questions. The plan (agents, scenarios, generated tool code) is shown for your approval before anything runs; turn that off in Settings if you prefer. Generated tools are tested and, if they fail, sent back to the model for repair up to twice. 8B+ models follow the format much better than tiny ones.

**Imagine AI.** Needs an image engine; Ollama's own image generation is currently macOS-only and experimental, so this app uses [AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui) or [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge):
1. Edit `webui-user.bat` and set `set COMMANDLINE_ARGS=--api --cors-allow-origins=http://localhost:3000`
2. Run it, then press *Re-check* in Imagine AI.
Drop in an image to switch to image-to-image; *Change strength* controls how far it departs from your picture. Results are stored in your browser (IndexedDB).

## Desktop app (Windows installer)

```bash
npm run desktop      # run the built app in Electron
npm run dist:win     # build an installer into dist/ (run this on Windows)
```
The desktop build loads from `file://`, so start Ollama with `OLLAMA_ORIGINS=*` and the image engine with `--cors-allow-origins=*`.
The Electron wrapper is a minimal scaffold and has not been built or tested on Windows yet.

## Your data

Chats, workflows, settings and agent files live in your browser's local storage; generated images in IndexedDB. *Settings > Download backup* exports everything except images. Clearing site data erases it.

## Project layout

```
src/
  App.jsx                 header, connection bar, tab routing
  theme.js                colours and base styles
  components/             shared UI (Markdown, icons, SettingsModal)
  lib/
    ollama.js             API client, streaming, JSON extraction
    tools.js              agent tools and TOOL:/PARAMS: parsing
    sandbox.js            Web Worker JavaScript sandbox
    vfs.js                agent file workspace
    storage.js            persistence hook, backup/restore
    idb.js                IndexedDB for images
  views/                  Chat, Agent, WorkflowDesigner, WhatIfView, ImagineView
electron/main.js          desktop wrapper
tools/                    mock servers and end-to-end tests
```

## Development

```bash
npm start                # dev server
npm run build            # production build (CI=true makes lint warnings fail)
npx playwright install chromium   # once
npm run build && npm run test:e2e # 31 browser checks against mock servers
```
See `CLAUDE.md` for conventions, and `docs/GITHUB_SETUP.md` for GitHub and Claude Code setup.

## Known limits

- The JavaScript sandbox disables network APIs on a best-effort basis. It is not a hardened security boundary; read code you did not write.
- `execute_code` and generated tools are JavaScript only. Python is not available in the browser.
- Agents cannot touch your real files, only the workspace.
- A workflow node with several outgoing connections follows the first one; use a Condition to branch.
- Swarm and agent quality depends heavily on the model. Small models often break the JSON or TOOL format.

## Troubleshooting

- **Red dot or no models:** run `ollama serve`, then *Refresh*.
- **CORS errors in the browser console:** set `OLLAMA_ORIGINS` as in Quick start and restart Ollama.
- **Long conversations forget the start:** raise *Context window* in Settings.
- **Imagine AI says not reachable:** the WebUI needs `--api` and `--cors-allow-origins`; the URL is editable in Settings.
