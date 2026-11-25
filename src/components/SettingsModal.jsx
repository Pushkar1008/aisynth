import { useRef, useState } from "react";
import { T, btnBase, inputBase, labelStyle } from "../theme";
import { Banner, Icon, Icons } from "./common";
import { clearAllData, exportAllData, importAllData } from "../lib/storage";
import { downloadText, readFileAsText } from "../lib/download";
import { DEFAULT_SETTINGS } from "../lib/settings";

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: T.textDim, marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

export default function SettingsModal({ settings, onChange, onClose }) {
  const [msg, setMsg] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef(null);

  const backup = () => {
    downloadText(`aisynth-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportAllData(), null, 2), "application/json");
  };

  const restore = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const n = importAllData(JSON.parse(await readFileAsText(file)));
      setMsg({ kind: "ok", text: `Restored ${n} items. Reload the page to see them.` });
    } catch (err) {
      setMsg({ kind: "error", text: `Restore failed: ${err.message}` });
    }
  };

  const reset = () => {
    clearAllData();
    setMsg({ kind: "ok", text: "All local data cleared. Reload the page." });
    setConfirmReset(false);
  };

  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Settings</div>
          <button onClick={onClose} style={{ ...btnBase, background: "transparent", padding: 4 }}><Icon d={Icons.close} size={16} /></button>
        </div>

        <Field label="Ollama URL" hint="Where Ollama is listening. Also editable from the bar under the header.">
          <input value={settings.ollamaUrl} onChange={(e) => onChange({ ollamaUrl: e.target.value })} style={inputBase} />
        </Field>

        <Field label="Default system prompt" hint="Used for new chats.">
          <textarea value={settings.defaultSystemPrompt} onChange={(e) => onChange({ defaultSystemPrompt: e.target.value })} rows={2} style={{ ...inputBase, resize: "vertical" }} />
        </Field>

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Field label={`Default temperature: ${settings.defaultTemperature}`}>
              <input type="range" min="0" max="2" step="0.1" value={settings.defaultTemperature} onChange={(e) => onChange({ defaultTemperature: +e.target.value })} style={{ width: "100%" }} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Context window (tokens)" hint="Applied to every call. Higher uses more VRAM.">
              <input type="number" min={1024} step={1024} value={settings.numCtx} onChange={(e) => onChange({ numCtx: Math.max(1024, +e.target.value || 8192) })} style={inputBase} />
            </Field>
          </div>
        </div>

        <Field label="Agent max steps">
          <input type="number" min={1} max={50} value={settings.agentMaxSteps} onChange={(e) => onChange({ agentMaxSteps: Math.min(50, Math.max(1, +e.target.value || 10)) })} style={{ ...inputBase, width: 100 }} />
        </Field>

        <Field label="SearXNG URL (optional)" hint="web_search uses Wikipedia by default. Point this at your own SearXNG instance (JSON output and CORS enabled) for general web results.">
          <input value={settings.searxUrl} onChange={(e) => onChange({ searxUrl: e.target.value })} placeholder="http://localhost:8080" style={inputBase} />
        </Field>

        <Field label="Image engine URL" hint="Stable Diffusion WebUI (AUTOMATIC1111 or Forge) started with --api. Used by Imagine AI.">
          <input value={settings.sdUrl} onChange={(e) => onChange({ sdUrl: e.target.value })} style={inputBase} />
        </Field>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: T.textMuted, marginBottom: 18, cursor: "pointer" }}>
          <input type="checkbox" checked={settings.reviewSwarmPlan} onChange={(e) => onChange({ reviewSwarmPlan: e.target.checked })} style={{ marginTop: 2 }} />
          <span>Review the swarm plan before it runs. Shows the agents and the tool code the model wrote, and waits for your approval.</span>
        </label>

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Your data (stored in this browser)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={backup} style={{ ...btnBase, background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.text, padding: "7px 12px", fontSize: 12 }}>Download backup</button>
            <button onClick={() => fileRef.current?.click()} style={{ ...btnBase, background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.text, padding: "7px 12px", fontSize: 12 }}>Restore backup…</button>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={restore} style={{ display: "none" }} />
            <button onClick={() => onChange({ ...DEFAULT_SETTINGS })} style={{ ...btnBase, background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.text, padding: "7px 12px", fontSize: 12 }}>Reset settings</button>
            {confirmReset ? (
              <>
                <button onClick={reset} style={{ ...btnBase, background: T.red, color: "#fff", padding: "7px 12px", fontSize: 12 }}>Yes, delete everything</button>
                <button onClick={() => setConfirmReset(false)} style={{ ...btnBase, background: "transparent", color: T.textMuted, padding: "7px 12px", fontSize: 12 }}>Cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirmReset(true)} style={{ ...btnBase, background: "rgba(255,107,107,0.1)", border: `1px solid ${T.red}40`, color: T.red, padding: "7px 12px", fontSize: 12 }}>Delete all data…</button>
            )}
          </div>
          <div style={{ fontSize: 10, color: T.textDim, marginTop: 8, lineHeight: 1.5 }}>
            Chats, workflows, agent files and settings are saved in this browser. Generated images are kept separately and are not part of the backup.
          </div>
          {msg && <div style={{ marginTop: 10 }}><Banner kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Banner></div>}
        </div>
      </div>
    </div>
  );
}
