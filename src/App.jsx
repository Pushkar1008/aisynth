import { useCallback, useEffect, useState } from "react";
import { T, btnBase, inputBase, MONO } from "./theme";
import { Icon, Icons } from "./components/common";
import SettingsModal from "./components/SettingsModal";
import ChatView from "./views/ChatView";
import AgentView from "./views/AgentView";
import WorkflowDesigner from "./views/WorkflowDesigner";
import WhatIfView from "./views/WhatIfView";
import ImagineView from "./views/ImagineView";
import { listModels } from "./lib/ollama";
import { usePersistentState } from "./lib/storage";
import { DEFAULT_SETTINGS } from "./lib/settings";

// ═══════════════════════════════════════════════════════════════
// AISYNTH (Ollama Nexus): Chat, Agent, Workflow, What-if swarm, Imagine AI
// ═══════════════════════════════════════════════════════════════

const TABS = [
  { id: "chat", icon: Icons.chat, label: "Chat" },
  { id: "agent", icon: Icons.agent, label: "Agent" },
  { id: "workflow", icon: Icons.workflow, label: "Workflow" },
  { id: "whatif", icon: Icons.swarm, label: "What-If" },
  { id: "imagine", icon: Icons.image, label: "Imagine AI" },
];

export default function App() {
  const [tab, setTab] = usePersistentState("tab", "chat");
  const [stored, setStored] = usePersistentState("settings", DEFAULT_SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  const updateSettings = useCallback((patch) => setStored((s) => ({ ...DEFAULT_SETTINGS, ...s, ...patch })), [setStored]);

  const [models, setModels] = useState([]);
  const [connected, setConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const selectedModel = settings.lastModel;

  const fetchModels = useCallback(async () => {
    try {
      const names = await listModels(settings.ollamaUrl);
      setModels(names);
      setConnected(true);
      // keep the remembered model if it still exists, otherwise pick the first
      setStored((s) => {
        const cur = { ...DEFAULT_SETTINGS, ...s };
        return names.includes(cur.lastModel) ? s : { ...cur, lastModel: names[0] || "" };
      });
    } catch {
      setModels([]);
      setConnected(false);
    }
  }, [settings.ollamaUrl, setStored]);

  // debounce so typing in the URL box does not fire a request per keystroke
  useEffect(() => {
    const t = setTimeout(fetchModels, 400);
    return () => clearTimeout(t);
  }, [fetchModels]);

  const shared = { settings, selectedModel, connected, models };
  const currentTab = TABS.some((t) => t.id === tab) ? tab : "chat";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: T.bg, color: T.text, fontFamily: MONO, fontSize: 13, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${T.borderLight}; }
        ::selection { background: ${T.accentGlow}; color: ${T.text}; }
        input:focus, textarea:focus, select:focus { border-color: ${T.accent} !important; box-shadow: 0 0 0 2px ${T.accentGlow} !important; }
        button:hover:not(:disabled) { filter: brightness(1.12); }
        textarea, select, input { font-family: ${MONO}; }
        select option { background: ${T.surface}; color: ${T.text}; }
        code { font-family: ${MONO}; background: rgba(108,92,231,0.15); padding: 1px 4px; border-radius: 4px; }
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
      `}</style>

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 20px", height: 54, borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${T.accent}, ${T.green})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff" }}>◈</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1, background: `linear-gradient(135deg, ${T.accentSoft}, ${T.green})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AISYNTH</div>
            <div style={{ fontSize: 9, color: T.textDim, letterSpacing: 2, textTransform: "uppercase" }}>Ollama Nexus</div>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 2, background: T.surfaceAlt, borderRadius: 10, padding: 3, overflowX: "auto" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{ ...btnBase, background: currentTab === t.id ? T.accent : "transparent", color: currentTab === t.id ? "#fff" : T.textMuted, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6, fontWeight: currentTab === t.id ? 600 : 400, whiteSpace: "nowrap" }}
            >
              <Icon d={t.icon} size={14} color={currentTab === t.id ? "#fff" : T.textMuted} />
              {t.label}
            </button>
          ))}
        </nav>
        <button onClick={() => setShowSettings(true)} title="Settings" style={{ ...btnBase, background: T.surfaceAlt, border: `1px solid ${T.border}`, padding: 8, display: "flex", flexShrink: 0 }}>
          <Icon d={Icons.settings} size={16} color={T.textMuted} />
        </button>
      </header>

      {/* Connection bar */}
      <div style={{ padding: "10px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? T.green : T.red, boxShadow: connected ? `0 0 8px ${T.greenGlow}` : "none" }} />
          <span style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>{connected ? "Connected" : "Disconnected"}</span>
        </div>
        <input value={settings.ollamaUrl} onChange={(e) => updateSettings({ ollamaUrl: e.target.value })} placeholder="Ollama URL" style={{ ...inputBase, width: 220, fontSize: 12, padding: "6px 10px" }} />
        <select value={selectedModel} onChange={(e) => updateSettings({ lastModel: e.target.value })} style={{ ...inputBase, width: 220, fontSize: 12, padding: "6px 10px", cursor: "pointer", appearance: "none" }}>
          {models.length === 0 && <option value="">{connected ? "No models installed" : "Ollama not reachable"}</option>}
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={fetchModels} style={{ ...btnBase, background: T.surfaceAlt, color: T.textMuted, padding: "6px 14px", border: `1px solid ${T.border}` }}>Refresh</button>
        {!connected && <span style={{ fontSize: 11, color: T.textDim }}>Start Ollama (<code>ollama serve</code>). Browser access may need <code>OLLAMA_ORIGINS=*</code>.</span>}
      </div>

      <main style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
        {currentTab === "chat" && <ChatView {...shared} />}
        {currentTab === "agent" && <AgentView {...shared} />}
        {currentTab === "workflow" && <WorkflowDesigner {...shared} />}
        {currentTab === "whatif" && <WhatIfView {...shared} updateSettings={updateSettings} />}
        {currentTab === "imagine" && <ImagineView {...shared} />}
      </main>

      {showSettings && <SettingsModal settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
