import { useEffect, useRef, useState } from "react";
import { T, btnBase, inputBase, labelStyle, MONO } from "../theme";
import { Icon, Icons, SmallBtn, CopyBtn } from "../components/common";
import { chatOnce, extractJson, modelOptions } from "../lib/ollama";
import { runInSandbox, formatSandboxResult } from "../lib/sandbox";
import { TOOL_DEFS, runTool } from "../lib/tools";
import { usePersistentState } from "../lib/storage";
import { downloadText, readFileAsText } from "../lib/download";
import { clip, sleep, uid } from "../lib/util";

const NODE_W = 160;
const NODE_H = 56;
const MAX_STEPS = 50;

export const NODE_TYPES = {
  start: { label: "Start", color: T.green, icon: "▶" },
  llm: { label: "LLM Call", color: T.accent, icon: "◈" },
  condition: { label: "Condition", color: T.orange, icon: "◇" },
  tool: { label: "Tool", color: "#e84393", icon: "⚙" },
  transform: { label: "Transform", color: "#00b894", icon: "↻" },
  output: { label: "Output", color: "#0984e3", icon: "◉" },
  end: { label: "End", color: T.red, icon: "■" },
};

const DEFAULT_CONFIGS = {
  start: { label: "Start" },
  llm: { label: "LLM Call", prompt: "You are a helpful assistant. Respond to the user's text.", model: "" },
  condition: { label: "Condition", expression: "/yes|approved/i.test(result)" },
  tool: { label: "Tool Call", toolName: "web_search", params: '{"query": "{{last}}"}' },
  transform: { label: "Transform", code: "return input.toUpperCase();" },
  output: { label: "Output" },
  end: { label: "End" },
};

// ─── templates ─────────────────────────────────────────────────
const N = (id, type, x, y, config) => ({ id, type, x, y, config: { ...DEFAULT_CONFIGS[type], ...config } });

const TEMPLATES = {
  "Summarize and polish": () => ({
    name: "Summarize and polish",
    input: "Paste a long article or notes here. The workflow summarizes them, then rewrites the summary for a busy executive.",
    nodes: [
      N("s", "start", 40, 180, {}),
      N("a", "llm", 260, 180, { label: "Summarize", prompt: "Summarize the user's text in five bullet points." }),
      N("b", "llm", 480, 180, { label: "Executive rewrite", prompt: "Rewrite the bullet points as a tight three-sentence executive summary." }),
      N("o", "output", 700, 180, {}),
      N("e", "end", 920, 180, {}),
    ],
    edges: [{ from: "s", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "o" }, { from: "o", to: "e" }],
  }),
  "Draft, review, branch": () => ({
    name: "Draft, review, branch",
    input: "Write a two-sentence product announcement for a local-first AI notes app.",
    nodes: [
      N("s", "start", 40, 200, {}),
      N("d", "llm", 240, 200, { label: "Draft", prompt: "Write the text the user asks for. Be concise." }),
      N("r", "llm", 440, 200, { label: "Review", prompt: "You are a strict editor. If the text below is clear and free of fluff reply with the single word APPROVED. Otherwise reply REVISE followed by one sentence of feedback." }),
      N("c", "condition", 640, 200, { label: "Approved?", expression: "/approved/i.test(result)" }),
      N("o", "output", 860, 120, {}),
      N("v", "llm", 860, 290, { label: "Revise", prompt: "Rewrite the text to address the editor's feedback. Return only the improved text." }),
      N("o2", "output", 1060, 290, { label: "Output (revised)" }),
      N("e", "end", 1060, 120, {}),
    ],
    edges: [
      { from: "s", to: "d" }, { from: "d", to: "r" }, { from: "r", to: "c" },
      { from: "c", to: "o", branch: "true" }, { from: "c", to: "v", branch: "false" },
      { from: "o", to: "e" }, { from: "v", to: "o2" }, { from: "o2", to: "e" },
    ],
  }),
  "Research and summarize": () => ({
    name: "Research and summarize",
    input: "Transformer neural network",
    nodes: [
      N("s", "start", 40, 180, {}),
      N("t", "tool", 240, 180, { label: "Search", toolName: "web_search", params: '{"query": "{{input}}"}' }),
      N("a", "llm", 440, 180, { label: "Summarize results", prompt: "Summarize these search results into a short, factual briefing with the sources named." }),
      N("o", "output", 660, 180, {}),
      N("e", "end", 860, 180, {}),
    ],
    edges: [{ from: "s", to: "t" }, { from: "t", to: "a" }, { from: "a", to: "o" }, { from: "o", to: "e" }],
  }),
};

const DEFAULT_DOC = TEMPLATES["Summarize and polish"]();

// ─── helpers ───────────────────────────────────────────────────
const fill = (tpl, vars, json = false) =>
  String(tpl || "").replace(/\{\{\s*(input|last)\s*\}\}/g, (_, k) => {
    const v = String(vars[k] ?? "");
    return json ? JSON.stringify(v).slice(1, -1) : v;
  });

function sanitizeWorkflow(obj) {
  if (!obj || !Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) throw new Error("Not a workflow file");
  const nodes = obj.nodes.slice(0, 200).map((n) => {
    if (!n || typeof n.id !== "string" || !NODE_TYPES[n.type]) throw new Error("Workflow has an invalid node");
    return { id: n.id, type: n.type, x: Number(n.x) || 0, y: Number(n.y) || 0, config: { ...DEFAULT_CONFIGS[n.type], ...(n.config && typeof n.config === "object" ? n.config : {}) } };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = obj.edges
    .filter((e) => e && ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, ...(e.branch === "true" || e.branch === "false" ? { branch: e.branch } : {}) }));
  return { name: String(obj.name || "Imported workflow").slice(0, 80), input: String(obj.input || ""), nodes, edges };
}

const edgeKey = (e) => `${e.from}>${e.to}>${e.branch || ""}`;
const sameEdge = (a, b) => edgeKey(a) === edgeKey(b);

export default function WorkflowDesigner({ settings, selectedModel, connected, models }) {
  const [doc, setDoc] = usePersistentState("wf-current", DEFAULT_DOC);
  const [saved, setSaved] = usePersistentState("wf-saved", {});
  const { nodes, edges } = doc;

  const [selectedNode, setSelectedNode] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [connecting, setConnecting] = useState(null); // { id, branch }
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [running, setRunning] = useState(false);
  const [simLog, setSimLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [result, setResult] = useState("");
  const [notice, setNotice] = useState("");
  const canvasRef = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const abortRef = useRef(null);
  const importRef = useRef(null);

  const setNodes = (fn) => setDoc((d) => ({ ...d, nodes: typeof fn === "function" ? fn(d.nodes) : fn }));
  const setEdges = (fn) => setDoc((d) => ({ ...d, edges: typeof fn === "function" ? fn(d.edges) : fn }));
  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(""), 2500); };

  // ── node / edge editing ──
  const addNode = (type) => {
    const id = `${type}-${uid()}`;
    setNodes((prev) => [...prev, { id, type, x: 220 + Math.random() * 160 - panOffset.x, y: 120 + Math.random() * 200 - panOffset.y, config: { ...DEFAULT_CONFIGS[type], ...(type === "llm" ? { model: "" } : {}) } }]);
    setSelectedNode(id);
  };

  const deleteNode = (id) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    setSelectedNode((s) => (s === id ? null : s));
  };

  const updateConfig = (id, patch) => setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)));
  const deleteEdge = (edge) => setEdges((prev) => prev.filter((e) => !sameEdge(e, edge)));

  useEffect(() => {
    const onKey = (ev) => {
      const tag = ev.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (ev.key === "Escape") setConnecting(null);
      if ((ev.key === "Delete" || ev.key === "Backspace") && selectedNode) deleteNode(selectedNode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode]);

  // ── canvas mouse handling ──
  const handleCanvasMouseDown = (e) => {
    if (e.target === canvasRef.current || e.target.tagName === "svg" || e.target.classList.contains("canvas-grid")) {
      setSelectedNode(null);
      if (connecting) { setConnecting(null); return; }
      setPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (panning) setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    if (dragging) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - panOffset.x - dragOffset.current.x;
      const y = e.clientY - rect.top - panOffset.y - dragOffset.current.y;
      setNodes((prev) => prev.map((n) => (n.id === dragging ? { ...n, x, y } : n)));
    }
  };

  const handleCanvasMouseUp = () => {
    if (dragging) setDragging(null);
    if (panning) setPanning(false);
  };

  const handleNodeMouseDown = (e, nodeId) => {
    if (e.target.dataset.port) return; // ports handle their own clicks
    e.stopPropagation();
    const rect = canvasRef.current.getBoundingClientRect();
    const node = nodes.find((n) => n.id === nodeId);
    dragOffset.current = { x: e.clientX - rect.left - panOffset.x - node.x, y: e.clientY - rect.top - panOffset.y - node.y };
    setDragging(nodeId);
    setSelectedNode(nodeId);
  };

  const handlePortMouseDown = (e, nodeId, portType, branch) => {
    e.stopPropagation();
    e.preventDefault();
    if (portType === "out") {
      setConnecting({ id: nodeId, branch });
    } else if (portType === "in" && connecting && connecting.id !== nodeId) {
      const edge = { from: connecting.id, to: nodeId, ...(connecting.branch ? { branch: connecting.branch } : {}) };
      setEdges((prev) => (prev.some((x) => sameEdge(x, edge)) ? prev : [...prev, edge]));
      setConnecting(null);
    }
  };

  // ── running ──
  const run = async () => {
    if (running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setSimLog([]);
    setResult("");
    setShowLog(true);
    const log = (entry) => setSimLog((prev) => [...prev, entry]);
    const ctx = { base: settings.ollamaUrl, model: selectedModel, settings, signal: ctrl.signal };

    const start = nodes.find((n) => n.type === "start");
    if (!start) {
      log({ type: "error", msg: "No Start node. Add one and connect it." });
      setRunning(false);
      return;
    }

    const original = doc.input || "";
    let last = original;
    let current = start;
    let steps = 0;

    try {
      while (current && !ctrl.signal.aborted) {
        if (++steps > MAX_STEPS) {
          log({ type: "error", msg: `Stopped after ${MAX_STEPS} steps. The workflow may contain a loop.` });
          break;
        }
        setActiveNodeId(current.id);
        log({ type: "enter", node: current.config.label || current.type });
        await sleep(300);
        const vars = { input: original, last };
        let branch = null;

        if (current.type === "llm") {
          const model = current.config.model || selectedModel;
          if (connected && model) {
            log({ type: "info", msg: `Calling ${model}…` });
            last = await chatOnce({
              base: settings.ollamaUrl,
              model,
              signal: ctrl.signal,
              options: modelOptions(settings),
              messages: [
                { role: "system", content: fill(current.config.prompt, vars) || "You are a helpful assistant." },
                { role: "user", content: last },
              ],
            });
            log({ type: "result", msg: clip(last, 400) });
          } else {
            last = `[Simulated LLM output for: ${clip(last, 80)}]`;
            log({ type: "info", msg: "Ollama is not connected, so this step is simulated." });
            log({ type: "result", msg: last });
          }
        } else if (current.type === "condition") {
          const res = await runInSandbox(`const { result, input } = args; return Boolean(${current.config.expression || "true"});`, { result: last, input: original });
          if (!res.ok) { log({ type: "error", msg: `Condition error: ${res.error}` }); break; }
          branch = res.result ? "true" : "false";
          log({ type: "info", msg: `Condition is ${branch}` });
        } else if (current.type === "tool") {
          const name = current.config.toolName;
          const parsed = extractJson(fill(current.config.params, vars, true));
          if (!parsed || typeof parsed !== "object") { log({ type: "error", msg: "Tool parameters are not valid JSON." }); break; }
          log({ type: "info", msg: `Running ${name}…` });
          const out = await runTool(name, parsed, ctx);
          if (out.startsWith("ERROR:")) { log({ type: "error", msg: out }); break; }
          last = out;
          log({ type: "result", msg: clip(out, 400) });
        } else if (current.type === "transform") {
          const res = await runInSandbox(`const { input, original } = args; ${current.config.code || "return input;"}`, { input: last, original });
          if (!res.ok) { log({ type: "error", msg: `Transform error: ${res.error}\n${formatSandboxResult(res)}` }); break; }
          last = typeof res.result === "string" ? res.result : res.result == null ? last : JSON.stringify(res.result);
          log({ type: "result", msg: clip(last, 400) });
        } else if (current.type === "output") {
          setResult(last);
          log({ type: "output", msg: last });
        } else if (current.type === "end") {
          log({ type: "done", msg: "Workflow complete." });
          break;
        }

        // choose the next node
        const fromId = current.id;
        const outs = edges.filter((e) => e.from === fromId);
        let edge;
        if (current.type === "condition") {
          const wanted = branch;
          edge = outs.find((e) => e.branch === wanted) || outs.find((e) => !e.branch);
          if (!edge) { log({ type: "info", msg: `No "${branch}" connection from this condition. Workflow stops here.` }); break; }
        } else {
          if (outs.length === 0) { log({ type: "info", msg: "This node has no outgoing connection. Workflow stops here." }); break; }
          if (outs.length > 1) log({ type: "info", msg: "Several outgoing connections. Following the first." });
          edge = outs[0];
        }
        const nextId = edge.to;
        current = nodes.find((n) => n.id === nextId);
      }
    } catch (e) {
      if (e.name !== "AbortError") log({ type: "error", msg: `${e.message}` });
      else log({ type: "info", msg: "Stopped." });
    }
    setActiveNodeId(null);
    setRunning(false);
  };

  // ── save / load / import / export ──
  const saveCurrent = () => {
    const name = (doc.name || "").trim() || "Untitled workflow";
    setSaved((s) => ({ ...s, [name]: { nodes, edges, input: doc.input, savedAt: Date.now() } }));
    setDoc((d) => ({ ...d, name }));
    flash(`Saved "${name}"`);
  };

  const loadSaved = (name) => {
    const w = saved[name];
    if (!w) return;
    setDoc({ name, nodes: w.nodes, edges: w.edges, input: w.input || "" });
    setSelectedNode(null);
    setPanOffset({ x: 0, y: 0 });
  };

  const deleteSaved = (name) => setSaved((s) => { const c = { ...s }; delete c[name]; return c; });

  const loadTemplate = (key) => {
    if (!TEMPLATES[key]) return;
    setDoc(TEMPLATES[key]());
    setSelectedNode(null);
    setPanOffset({ x: 0, y: 0 });
  };

  const newWorkflow = () => {
    setDoc({ name: "Untitled workflow", input: "", nodes: [N("s", "start", 80, 200, {}), N("e", "end", 400, 200, {})], edges: [{ from: "s", to: "e" }] });
    setSelectedNode(null);
    setPanOffset({ x: 0, y: 0 });
  };

  const exportJson = () => {
    const name = (doc.name || "workflow").replace(/[^\w-]+/g, "_");
    downloadText(`${name}.workflow.json`, JSON.stringify({ app: "aisynth-workflow", version: 1, name: doc.name, input: doc.input, nodes, edges }, null, 2), "application/json");
  };

  const importJson = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setDoc(sanitizeWorkflow(JSON.parse(await readFileAsText(file))));
      setSelectedNode(null);
      setPanOffset({ x: 0, y: 0 });
      flash("Imported. Code in nodes runs in the sandbox.");
    } catch (err) {
      flash(`Import failed: ${err.message}`);
    }
  };

  const sel = nodes.find((n) => n.id === selectedNode);
  const outY = (node, branch) => node.y + panOffset.y + NODE_H * (node.type === "condition" ? (branch === "false" ? 0.72 : branch === "true" ? 0.28 : 0.5) : 0.5);

  return (
    <div style={{ display: "flex", height: "100%", position: "relative" }}>
      {/* Left panel */}
      <div style={{ width: 208, borderRight: `1px solid ${T.border}`, padding: 12, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flexShrink: 0 }}>
        <label style={labelStyle}>Workflow</label>
        <input value={doc.name || ""} onChange={(e) => setDoc((d) => ({ ...d, name: e.target.value }))} style={{ ...inputBase, fontSize: 12, padding: "6px 10px" }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <SmallBtn onClick={saveCurrent}>Save</SmallBtn>
          <SmallBtn onClick={newWorkflow}>New</SmallBtn>
          <SmallBtn onClick={exportJson} title="Download as JSON"><Icon d={Icons.download} size={11} color={T.textMuted} /></SmallBtn>
          <SmallBtn onClick={() => importRef.current?.click()} title="Import JSON"><Icon d={Icons.upload} size={11} color={T.textMuted} /></SmallBtn>
          <input ref={importRef} type="file" accept="application/json,.json" onChange={importJson} style={{ display: "none" }} />
        </div>
        {notice && <div style={{ fontSize: 10, color: T.green, lineHeight: 1.4 }}>{notice}</div>}

        <select value="" onChange={(e) => { if (e.target.value) loadSaved(e.target.value); }} style={{ ...inputBase, fontSize: 11, padding: "6px 8px", cursor: "pointer" }}>
          <option value="">Load saved ({Object.keys(saved).length})…</option>
          {Object.keys(saved).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {saved[doc.name] && <SmallBtn onClick={() => deleteSaved(doc.name)} color={T.red}>Delete saved copy</SmallBtn>}
        <select value="" onChange={(e) => { if (e.target.value) loadTemplate(e.target.value); }} style={{ ...inputBase, fontSize: 11, padding: "6px 8px", cursor: "pointer" }}>
          <option value="">Templates…</option>
          {Object.keys(TEMPLATES).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <div style={{ ...labelStyle, marginTop: 10 }}>Add node</div>
        {Object.entries(NODE_TYPES).map(([type, info]) => (
          <button key={type} onClick={() => addNode(type)} style={{ ...btnBase, background: `${info.color}15`, border: `1px solid ${info.color}40`, color: info.color, padding: "7px 10px", fontSize: 11, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>{info.icon}</span> {info.label}
          </button>
        ))}

        <div style={{ ...labelStyle, marginTop: 10 }}>Workflow input</div>
        <textarea value={doc.input || ""} onChange={(e) => setDoc((d) => ({ ...d, input: e.target.value }))} rows={4} style={{ ...inputBase, fontSize: 11, resize: "vertical" }} />

        {running ? (
          <button onClick={() => abortRef.current?.abort()} style={{ ...btnBase, background: T.red, color: "#fff", padding: 10, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon d={Icons.stop} size={14} color="#fff" /> Stop
          </button>
        ) : (
          <button onClick={run} style={{ ...btnBase, background: T.green, color: "#fff", padding: 10, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon d={Icons.play} size={14} color="#fff" /> Run
          </button>
        )}
        <div style={{ fontSize: 9, color: T.textDim, lineHeight: 1.6 }}>
          Drag nodes to move. Click an output port (right) then an input port (left) to connect. A Condition has two outputs: green for true, red for false. Click a line to delete it. Delete key removes the selected node. Esc cancels connecting.
          {!connected && <><br /><span style={{ color: T.orange }}>Ollama is not connected: LLM nodes are simulated.</span></>}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        style={{ flex: 1, position: "relative", overflow: "hidden", cursor: panning ? "grabbing" : connecting ? "crosshair" : "grab", background: `radial-gradient(circle at 50% 50%, ${T.surface} 0%, ${T.bg} 100%)` }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
      >
        <div className="canvas-grid" style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(${T.border}40 1px, transparent 1px)`, backgroundSize: "24px 24px", backgroundPosition: `${panOffset.x % 24}px ${panOffset.y % 24}px` }} />

        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          <defs>
            {[["arrow", T.accentSoft], ["arrow-true", T.green], ["arrow-false", T.red]].map(([id, c]) => (
              <marker key={id} id={id} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill={c} />
              </marker>
            ))}
          </defs>
          {edges.map((edge) => {
            const from = nodes.find((n) => n.id === edge.from);
            const to = nodes.find((n) => n.id === edge.to);
            if (!from || !to) return null;
            const x1 = from.x + panOffset.x + NODE_W + 8;
            const y1 = outY(from, edge.branch);
            const x2 = to.x + panOffset.x - 8;
            const y2 = to.y + panOffset.y + NODE_H / 2;
            const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
            const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
            const col = edge.branch === "true" ? T.green : edge.branch === "false" ? T.red : T.accentSoft;
            const marker = edge.branch === "true" ? "arrow-true" : edge.branch === "false" ? "arrow-false" : "arrow";
            return (
              <g key={edgeKey(edge)}>
                <path d={d} stroke={col} strokeWidth={4} fill="none" opacity={0.15} />
                <path d={d} stroke={col} strokeWidth={2} fill="none" markerEnd={`url(#${marker})`} strokeDasharray={edge.branch === "false" ? "6 4" : undefined} />
                <path d={d} stroke="transparent" strokeWidth={16} fill="none" style={{ pointerEvents: "stroke", cursor: "pointer" }} onClick={() => deleteEdge(edge)} />
              </g>
            );
          })}
        </svg>

        {nodes.map((node) => {
          const nt = NODE_TYPES[node.type];
          const isActive = activeNodeId === node.id;
          const isSelected = selectedNode === node.id;
          const portStyle = (active, color) => ({ position: "absolute", width: 16, height: 16, borderRadius: "50%", background: active ? color : T.surface, border: `2px solid ${active ? color : T.border}`, cursor: "pointer", zIndex: 15, transition: "all 0.15s ease" });
          return (
            <div
              key={node.id}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              style={{
                position: "absolute", left: node.x + panOffset.x, top: node.y + panOffset.y, width: NODE_W, height: NODE_H,
                background: isActive ? `${nt.color}30` : T.surface,
                border: `2px solid ${isSelected || isActive ? nt.color : T.border}`,
                borderRadius: 12, display: "flex", alignItems: "center", padding: "0 12px", gap: 8, cursor: "move",
                transition: "border-color 0.2s, background 0.2s, box-shadow 0.2s",
                boxShadow: isActive ? `0 0 20px ${nt.color}40` : isSelected ? `0 0 12px ${nt.color}25` : "none",
                zIndex: isSelected ? 10 : 1, userSelect: "none",
              }}
            >
              {node.type !== "start" && (
                <div data-port="in" onMouseDown={(e) => handlePortMouseDown(e, node.id, "in")} style={{ ...portStyle(!!connecting, T.green), left: -8, top: "50%", transform: "translateY(-50%)" }} />
              )}
              <span style={{ fontSize: 16 }}>{nt.icon}</span>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: nt.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{node.config.label || nt.label}</div>
                <div style={{ fontSize: 9, color: T.textDim }}>{nt.label}</div>
              </div>
              {node.type === "condition" ? (
                <>
                  <div data-port="out" title="True" onMouseDown={(e) => handlePortMouseDown(e, node.id, "out", "true")} style={{ ...portStyle(connecting?.id === node.id && connecting.branch === "true", T.green), right: -8, top: "28%", transform: "translateY(-50%)", borderColor: T.green }} />
                  <div data-port="out" title="False" onMouseDown={(e) => handlePortMouseDown(e, node.id, "out", "false")} style={{ ...portStyle(connecting?.id === node.id && connecting.branch === "false", T.red), right: -8, top: "72%", transform: "translateY(-50%)", borderColor: T.red }} />
                </>
              ) : (
                node.type !== "end" && (
                  <div data-port="out" onMouseDown={(e) => handlePortMouseDown(e, node.id, "out")} style={{ ...portStyle(connecting?.id === node.id, T.accent), right: -8, top: "50%", transform: "translateY(-50%)" }} />
                )
              )}
            </div>
          );
        })}

        {connecting && (
          <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", background: T.green, color: "#fff", padding: "4px 14px", borderRadius: 20, fontSize: 11, fontFamily: MONO, zIndex: 100 }}>
            Click a target node's input port (Esc to cancel)
          </div>
        )}
      </div>

      {/* Node config */}
      {sel && (
        <div style={{ width: 270, borderLeft: `1px solid ${T.border}`, padding: 16, overflowY: "auto", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: NODE_TYPES[sel.type].color }}>{NODE_TYPES[sel.type].label}</div>
              <div style={{ fontSize: 10, color: T.textDim }}>{sel.id}</div>
            </div>
            <button onClick={() => deleteNode(sel.id)} style={{ ...btnBase, background: "rgba(255,107,107,0.1)", color: T.red, padding: 6, border: `1px solid ${T.red}30` }}>
              <Icon d={Icons.trash} size={14} color={T.red} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={labelStyle}>Label</label>
              <input value={sel.config.label || ""} onChange={(e) => updateConfig(sel.id, { label: e.target.value })} style={{ ...inputBase, fontSize: 12 }} />
            </div>
            {sel.type === "llm" && (
              <>
                <div>
                  <label style={labelStyle}>System prompt</label>
                  <textarea value={sel.config.prompt || ""} onChange={(e) => updateConfig(sel.id, { prompt: e.target.value })} rows={5} style={{ ...inputBase, fontSize: 12, resize: "vertical" }} />
                  <div style={{ fontSize: 10, color: T.textDim, marginTop: 4 }}>The previous node's output is sent as the user message. Use {"{{input}}"} for the original workflow input.</div>
                </div>
                <div>
                  <label style={labelStyle}>Model</label>
                  <select value={sel.config.model || ""} onChange={(e) => updateConfig(sel.id, { model: e.target.value })} style={{ ...inputBase, fontSize: 12, cursor: "pointer" }}>
                    <option value="">Use selected model ({selectedModel || "none"})</option>
                    {models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </>
            )}
            {sel.type === "condition" && (
              <div>
                <label style={labelStyle}>JavaScript expression</label>
                <textarea value={sel.config.expression || ""} onChange={(e) => updateConfig(sel.id, { expression: e.target.value })} rows={3} style={{ ...inputBase, fontSize: 12, resize: "vertical" }} />
                <div style={{ fontSize: 10, color: T.textDim, marginTop: 4, lineHeight: 1.5 }}>
                  Variables: <code>result</code> (previous output), <code>input</code> (workflow input). Connect the green port for true and the red port for false.
                </div>
              </div>
            )}
            {sel.type === "tool" && (
              <>
                <div>
                  <label style={labelStyle}>Tool</label>
                  <select value={sel.config.toolName || "web_search"} onChange={(e) => updateConfig(sel.id, { toolName: e.target.value })} style={{ ...inputBase, fontSize: 12, cursor: "pointer" }}>
                    {TOOL_DEFS.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                  <div style={{ fontSize: 10, color: T.textDim, marginTop: 4 }}>{TOOL_DEFS.find((t) => t.name === sel.config.toolName)?.desc}</div>
                </div>
                <div>
                  <label style={labelStyle}>Parameters (JSON)</label>
                  <textarea value={sel.config.params || ""} onChange={(e) => updateConfig(sel.id, { params: e.target.value })} rows={4} style={{ ...inputBase, fontSize: 12, resize: "vertical" }} />
                  <div style={{ fontSize: 10, color: T.textDim, marginTop: 4 }}>{"{{last}}"} is the previous output, {"{{input}}"} the workflow input.</div>
                </div>
              </>
            )}
            {sel.type === "transform" && (
              <div>
                <label style={labelStyle}>JavaScript (function body)</label>
                <textarea value={sel.config.code || ""} onChange={(e) => updateConfig(sel.id, { code: e.target.value })} rows={6} style={{ ...inputBase, fontSize: 12, resize: "vertical" }} />
                <div style={{ fontSize: 10, color: T.textDim, marginTop: 4, lineHeight: 1.5 }}>
                  Variables: <code>input</code> (previous output), <code>original</code> (workflow input). Use <code>return</code>. Runs in a sandbox with a 5 s limit.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Run log */}
      {showLog && (
        <div style={{ position: "absolute", bottom: 0, left: 208, right: sel ? 270 : 0, maxHeight: 280, background: T.surface, borderTop: `1px solid ${T.border}`, overflowY: "auto", zIndex: 50 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, background: T.surface }}>
            <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Run log {running && "· running"}</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {result && <CopyBtn text={result} label="Copy result" />}
              <button onClick={() => setShowLog(false)} style={{ ...btnBase, background: "transparent", color: T.textDim, padding: "2px 8px", fontSize: 11 }}>Close</button>
            </div>
          </div>
          <div style={{ padding: "8px 14px" }}>
            {simLog.map((entry, i) => {
              const c = entry.type === "error" ? T.red : entry.type === "done" ? T.green : entry.type === "output" ? T.accentSoft : entry.type === "enter" ? T.orange : T.textMuted;
              return (
                <div key={i} style={{ fontSize: 11, lineHeight: 1.6, color: c, fontFamily: MONO, borderLeft: `2px solid ${entry.type === "result" || entry.type === "info" ? T.border : c}`, paddingLeft: 10, marginBottom: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {entry.type === "enter" ? `→ ${entry.node}` : entry.type === "output" ? `Output:\n${entry.msg}` : entry.msg}
                </div>
              );
            })}
            {simLog.length === 0 && <div style={{ fontSize: 11, color: T.textDim }}>Starting…</div>}
          </div>
        </div>
      )}
    </div>
  );
}
