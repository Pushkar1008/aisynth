import { useEffect, useRef, useState } from "react";
import { T, btnBase, inputBase, MONO } from "../theme";
import { Banner, Empty, Icon, Icons, Markdown, SmallBtn } from "../components/common";
import { chatOnce, modelOptions } from "../lib/ollama";
import { TOOL_DEFS, parseToolCall, runTool } from "../lib/tools";
import { vfsAll, vfsDelete } from "../lib/vfs";
import { downloadText } from "../lib/download";

function AgentStep({ step }) {
  const styles = {
    thinking: { bg: "rgba(108,92,231,0.08)", c: T.accent, icon: "◌", label: "Thinking" },
    reasoning: { bg: "rgba(108,92,231,0.08)", c: T.accent, icon: "◈", label: `Step ${step.step}` },
    tool: { bg: "rgba(255,159,67,0.08)", c: T.orange, icon: "⚙", label: `Tool: ${step.tool}` },
    tool_result: { bg: "rgba(0,210,160,0.08)", c: T.green, icon: "✓", label: "Result" },
    done: { bg: "rgba(0,210,160,0.1)", c: T.green, icon: "★", label: "Complete" },
    error: { bg: "rgba(255,107,107,0.08)", c: T.red, icon: "✕", label: "Stopped" },
  };
  const s = styles[step.type] || styles.reasoning;
  return (
    <div style={{ marginBottom: 12, background: s.bg, border: `1px solid ${s.c}30`, borderLeft: `3px solid ${s.c}`, borderRadius: "0 10px 10px 0", padding: "10px 14px" }}>
      <div style={{ fontSize: 10, color: s.c, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <span>{s.icon}</span> {s.label}
      </div>
      {step.type === "tool" && step.params && Object.keys(step.params).length > 0 && (
        <pre style={{ fontSize: 11, color: T.textMuted, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(step.params, null, 2)}</pre>
      )}
      {step.type === "tool_result" ? (
        <pre style={{ fontSize: 12, color: T.text, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: MONO, lineHeight: 1.5 }}>{step.content}</pre>
      ) : step.content ? (
        <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6 }}><Markdown text={step.content} /></div>
      ) : null}
    </div>
  );
}

function FilesPanel({ files, onChange }) {
  const [open, setOpen] = useState(null);
  const names = Object.keys(files).sort();
  if (!names.length) {
    return <div style={{ fontSize: 11, color: T.textDim, padding: "6px 0" }}>The workspace is empty. Files the agent writes with write_file appear here.</div>;
  }
  return (
    <div style={{ padding: "6px 0", display: "flex", flexDirection: "column", gap: 6 }}>
      {names.map((n) => (
        <div key={n} style={{ border: `1px solid ${T.border}`, borderRadius: 8, background: T.surfaceAlt }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
            <Icon d={Icons.file} size={13} color={T.textMuted} />
            <span style={{ flex: 1, fontSize: 12, wordBreak: "break-all" }}>{n}</span>
            <span style={{ fontSize: 10, color: T.textDim }}>{files[n].length} chars</span>
            <SmallBtn onClick={() => setOpen(open === n ? null : n)}>{open === n ? "Hide" : "View"}</SmallBtn>
            <SmallBtn onClick={() => downloadText(n.split("/").pop(), files[n])}><Icon d={Icons.download} size={11} color={T.textMuted} /></SmallBtn>
            <SmallBtn onClick={() => { vfsDelete(n); onChange(); }} color={T.red}><Icon d={Icons.trash} size={11} color={T.red} /></SmallBtn>
          </div>
          {open === n && <pre style={{ margin: 0, padding: "8px 12px", borderTop: `1px solid ${T.border}`, fontSize: 11, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{files[n]}</pre>}
        </div>
      ))}
    </div>
  );
}

export default function AgentView({ settings, selectedModel, connected }) {
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState([]);
  const [running, setRunning] = useState(false);
  const [enabledTools, setEnabledTools] = useState(TOOL_DEFS.map((t) => t.name));
  const [maxSteps, setMaxSteps] = useState(settings.agentMaxSteps || 10);
  const [panel, setPanel] = useState(null); // "tools" | "files" | null
  const [files, setFiles] = useState(() => vfsAll());
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [steps]);

  const toggleTool = (name) => setEnabledTools((p) => (p.includes(name) ? p.filter((t) => t !== name) : [...p, name]));
  const refreshFiles = () => setFiles(vfsAll());
  const replaceLast = (item) => setSteps((prev) => [...prev.slice(0, -1), item]);

  const runAgent = async () => {
    if (!goal.trim() || running || !connected || !selectedModel) return;
    setRunning(true);
    setSteps([]);
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const ctx = { base: settings.ollamaUrl, model: selectedModel, settings, signal: ctrl.signal };

    const tools = TOOL_DEFS.filter((t) => enabledTools.includes(t.name));
    const toolsDesc = tools.map((t) => `- ${t.name}(${t.params.join(", ")}): ${t.desc}`).join("\n") || "(no tools enabled; reason from your own knowledge)";

    const history = [
      {
        role: "system",
        content: `You are an autonomous AI agent working towards a goal. You can use these tools:
${toolsDesc}

To use a tool, reply with exactly:
TOOL: tool_name
PARAMS: {"param": "value"}
Use one tool per reply and wait for the result. PARAMS must be valid JSON on a single line (escape newlines as \\n).
Save deliverables with write_file so the user can download them.
When the goal is complete, reply with:
DONE: your final answer or summary

Think step by step and briefly explain your reasoning before each tool call.`,
      },
      { role: "user", content: `Goal: ${goal.trim()}` },
    ];

    try {
      let finished = false;
      for (let n = 1; n <= maxSteps && !ctrl.signal.aborted; n++) {
        setSteps((prev) => [...prev, { type: "thinking", content: "Reasoning…", step: n }]);
        const reply = await chatOnce({
          base: settings.ollamaUrl,
          model: selectedModel,
          messages: history,
          options: modelOptions(settings, { temperature: 0.3 }),
          signal: ctrl.signal,
        });

        const call = parseToolCall(reply);
        const done = /^\s*DONE:\s*([\s\S]*)/m.exec(reply);

        if (call && (!done || call.reasoning.length <= done.index)) {
          replaceLast({ type: "reasoning", content: call.reasoning || "(no explanation given)", step: n });
          setSteps((prev) => [...prev, { type: "tool", tool: call.name, params: call.params, step: n }]);
          let result;
          if (!enabledTools.includes(call.name)) {
            result = `ERROR: tool "${call.name}" is not available. Available: ${tools.map((t) => t.name).join(", ") || "none"}`;
          } else {
            result = await runTool(call.name, call.params, ctx);
          }
          refreshFiles();
          setSteps((prev) => [...prev, { type: "tool_result", content: result, step: n }]);
          history.push({ role: "assistant", content: reply });
          history.push({ role: "user", content: `Result of ${call.name}:\n${result}\n\nContinue towards the goal. Use another tool or reply with DONE: if finished.` });
        } else if (done) {
          replaceLast({ type: "done", content: done[1].trim() || "(done)", step: n });
          finished = true;
          break;
        } else {
          replaceLast({ type: "reasoning", content: reply, step: n });
          history.push({ role: "assistant", content: reply });
          history.push({ role: "user", content: "Continue. Use a tool with the TOOL:/PARAMS: format, or reply with DONE: and your final answer." });
        }
      }
      if (!finished && !ctrl.signal.aborted) {
        setSteps((prev) => [...prev, { type: "error", content: `Reached the step limit (${maxSteps}) without a final answer. Raise Max Steps or narrow the goal.`, step: maxSteps }]);
      }
    } catch (e) {
      if (e.name !== "AbortError") setError(`${e.message}\nMake sure Ollama is running at ${settings.ollamaUrl}.`);
      setSteps((prev) => prev.filter((s) => s.type !== "thinking"));
    }
    setSteps((prev) => prev.filter((s) => s.type !== "thinking"));
    setRunning(false);
  };

  const stopAgent = () => abortRef.current?.abort();
  const fileCount = Object.keys(files).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "10px 20px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <SmallBtn onClick={() => setPanel(panel === "tools" ? null : "tools")}>Tools ({enabledTools.length}/{TOOL_DEFS.length}) {panel === "tools" ? "▴" : "▾"}</SmallBtn>
          <SmallBtn onClick={() => { refreshFiles(); setPanel(panel === "files" ? null : "files"); }}>Files ({fileCount}) {panel === "files" ? "▴" : "▾"}</SmallBtn>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 11, color: T.textDim }}>Max steps</label>
            <input type="number" value={maxSteps} onChange={(e) => setMaxSteps(Math.min(50, Math.max(1, +e.target.value || 1)))} min={1} max={50} style={{ ...inputBase, width: 64, padding: "4px 8px", fontSize: 12 }} />
          </div>
        </div>
        {panel === "tools" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 0 2px" }}>
            {TOOL_DEFS.map((t) => {
              const on = enabledTools.includes(t.name);
              return (
                <button key={t.name} title={t.desc} onClick={() => toggleTool(t.name)} style={{ ...btnBase, background: on ? "rgba(108,92,231,0.2)" : T.surfaceAlt, border: `1px solid ${on ? T.accent : T.border}`, color: on ? T.accentSoft : T.textMuted, padding: "5px 10px", fontSize: 11 }}>
                  {t.name}
                </button>
              );
            })}
          </div>
        )}
        {panel === "files" && <FilesPanel files={files} onChange={refreshFiles} />}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {steps.length === 0 && (
          <Empty glyph="⬡" title="Agent mode">
            Give the agent a goal. It plans, calls tools (Wikipedia search, a JavaScript sandbox, a file workspace, Ollama itself) and works until it can answer.
            Try: “Research how transformers work, compute the parameter count of a 12-layer model with d_model 768 in the sandbox, and save a one-page summary to notes.md”.
          </Empty>
        )}
        {steps.map((s, i) => <AgentStep key={i} step={s} />)}
      </div>

      <div style={{ padding: "10px 20px 16px", borderTop: `1px solid ${T.border}` }}>
        {error && <div style={{ marginBottom: 8 }}><Banner onClose={() => setError(null)}>{error}</Banner></div>}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 14, padding: "8px 8px 8px 16px" }}>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runAgent(); } }}
            placeholder={connected ? "Describe the agent's goal…" : "Connect to Ollama first…"}
            rows={1}
            style={{ flex: 1, background: "transparent", border: "none", color: T.text, fontFamily: MONO, fontSize: 13, outline: "none", resize: "none", lineHeight: 1.5, maxHeight: 140 }}
          />
          {running ? (
            <button onClick={stopAgent} style={{ ...btnBase, background: T.red, color: "#fff", padding: "8px 16px", display: "flex", alignItems: "center", gap: 6 }}>
              <Icon d={Icons.stop} size={14} color="#fff" /> Stop
            </button>
          ) : (
            <button onClick={runAgent} disabled={!goal.trim() || !connected} style={{ ...btnBase, background: goal.trim() && connected ? T.green : T.border, color: "#fff", padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, opacity: goal.trim() && connected ? 1 : 0.5 }}>
              <Icon d={Icons.play} size={14} color="#fff" /> Run
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
