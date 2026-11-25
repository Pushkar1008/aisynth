import { useEffect, useMemo, useRef, useState } from "react";
import { T, btnBase, inputBase, MONO } from "../theme";
import { Banner, CopyBtn, Empty, Icon, Icons, Markdown } from "../components/common";
import { chatStream, modelOptions } from "../lib/ollama";
import { usePersistentState } from "../lib/storage";
import { downloadText } from "../lib/download";
import { uid } from "../lib/util";

const newSession = (settings) => ({
  id: uid(),
  title: "New chat",
  messages: [],
  systemPrompt: settings.defaultSystemPrompt,
  temperature: settings.defaultTemperature,
  updatedAt: Date.now(),
});

export default function ChatView({ settings, selectedModel, connected }) {
  const [stored, setStored] = usePersistentState("chats", null);
  const [activeId, setActiveId] = usePersistentState("chats-active", null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [showSystem, setShowSystem] = useState(false);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  // Drop any half-finished placeholder messages left by a reload mid-stream.
  const sessions = useMemo(() => {
    const list = Array.isArray(stored) && stored.length ? stored : [newSession(settings)];
    return list.map((s) => ({ ...s, messages: (s.messages || []).filter((m) => !m.loading) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const active = sessions.find((s) => s.id === activeId) || sessions[0];

  const patchSession = (id, fn) =>
    setStored((prev) => {
      const base = Array.isArray(prev) && prev.length ? prev : sessions;
      return base.map((s) => (s.id === id ? { ...fn(s), updatedAt: Date.now() } : s));
    });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active.messages, active.id]);

  const createChat = () => {
    const s = newSession(settings);
    setStored([s, ...sessions]);
    setActiveId(s.id);
    setError(null);
  };

  const deleteChat = (id) => {
    const rest = sessions.filter((s) => s.id !== id);
    const next = rest.length ? rest : [newSession(settings)];
    setStored(next);
    if (id === active.id) setActiveId(next[0].id);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming || !connected || !selectedModel) return;
    setError(null);
    const sid = active.id;
    const history = [...active.messages, { role: "user", content: text }];
    patchSession(sid, (s) => ({
      ...s,
      title: s.messages.length === 0 ? text.slice(0, 40) : s.title,
      messages: [...history, { role: "assistant", content: "", loading: true }],
    }));
    setInput("");
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const apiMessages = [...(active.systemPrompt ? [{ role: "system", content: active.systemPrompt }] : []), ...history];
    let partial = "";
    try {
      await chatStream({
        base: settings.ollamaUrl,
        model: selectedModel,
        messages: apiMessages,
        options: modelOptions(settings, { temperature: active.temperature }),
        signal: ctrl.signal,
        onToken: (_t, full) => {
          partial = full;
          patchSession(sid, (s) => ({ ...s, messages: [...history, { role: "assistant", content: full }] }));
        },
      });
    } catch (e) {
      if (e.name !== "AbortError") {
        setError(`${e.message}\nMake sure Ollama is running at ${settings.ollamaUrl} and the model "${selectedModel}" is installed.`);
      }
    }
    // Finalize: keep whatever streamed (also after Stop), or remove an empty placeholder.
    patchSession(sid, (s) => ({
      ...s,
      messages: partial ? [...history, { role: "assistant", content: partial }] : history,
    }));
    setStreaming(false);
  };

  const stop = () => abortRef.current?.abort();

  const exportChat = () => {
    const md = `# ${active.title}\n\n` + active.messages.map((m) => `**${m.role === "user" ? "You" : selectedModel || "Assistant"}:**\n\n${m.content}`).join("\n\n---\n\n");
    downloadText(`${active.title.replace(/[^\w-]+/g, "_") || "chat"}.md`, md, "text/markdown");
  };

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* Session list */}
      <div style={{ width: 210, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: 10 }}>
          <button onClick={createChat} style={{ ...btnBase, width: "100%", background: T.accent, color: "#fff", padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon d={Icons.plus} size={14} color="#fff" /> New chat
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {[...sessions].sort((a, b) => b.updatedAt - a.updatedAt).map((s) => (
            <div
              key={s.id}
              onClick={() => { setActiveId(s.id); setError(null); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", marginBottom: 2, borderRadius: 8, cursor: "pointer", background: s.id === active.id ? T.accentGlow : "transparent", border: `1px solid ${s.id === active.id ? "rgba(108,92,231,0.35)" : "transparent"}` }}
            >
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: s.id === active.id ? T.text : T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
              <button
                title="Delete chat"
                onClick={(e) => { e.stopPropagation(); deleteChat(s.id); }}
                style={{ ...btnBase, background: "transparent", padding: 2, opacity: 0.6 }}
              >
                <Icon d={Icons.trash} size={12} color={T.textDim} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "8px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button onClick={() => setShowSystem(!showSystem)} style={{ ...btnBase, background: "transparent", color: T.textMuted, padding: "4px 0", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon d={Icons.settings} size={13} color={T.textMuted} /> System prompt & temperature {showSystem ? "▴" : "▾"}
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={exportChat} disabled={!active.messages.length} style={{ ...btnBase, background: "transparent", color: T.textMuted, fontSize: 11, padding: "4px 8px", display: "flex", alignItems: "center", gap: 5, opacity: active.messages.length ? 1 : 0.4 }}>
              <Icon d={Icons.download} size={12} color={T.textMuted} /> Export
            </button>
            <button onClick={() => patchSession(active.id, (s) => ({ ...s, messages: [], title: "New chat" }))} style={{ ...btnBase, background: "transparent", color: T.textMuted, fontSize: 11, padding: "4px 8px" }}>Clear</button>
          </div>
        </div>
        {showSystem && (
          <div style={{ padding: "10px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <textarea value={active.systemPrompt} onChange={(e) => patchSession(active.id, (s) => ({ ...s, systemPrompt: e.target.value }))} rows={2} style={{ ...inputBase, resize: "vertical", flex: 1, fontSize: 12 }} />
            <div style={{ minWidth: 90 }}>
              <label style={{ fontSize: 10, color: T.textDim }}>Temp: {active.temperature}</label>
              <input type="range" min="0" max="2" step="0.1" value={active.temperature} onChange={(e) => patchSession(active.id, (s) => ({ ...s, temperature: +e.target.value }))} style={{ width: 90 }} />
            </div>
          </div>
        )}

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {active.messages.length === 0 && (
            <Empty glyph="◈" title="Start a conversation">
              {connected ? `Connected to ${selectedModel || "Ollama"}. Chats are saved in this browser.` : "Ollama is not reachable. Start it, then press Refresh above."}
            </Empty>
          )}
          {active.messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 16 }}>
              <div style={{
                maxWidth: "78%", minWidth: 0, padding: "12px 16px",
                borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                background: m.role === "user" ? T.accent : T.surfaceAlt,
                border: m.role === "user" ? "none" : `1px solid ${T.border}`,
                color: T.text, fontSize: 13, lineHeight: 1.6, wordBreak: "break-word",
              }}>
                {m.loading ? (
                  <div style={{ display: "flex", gap: 4, padding: "4px 0" }}>
                    {[0, 1, 2].map((d) => <div key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent, animation: `pulse 1.2s infinite ${d * 0.2}s` }} />)}
                  </div>
                ) : m.role === "user" ? (
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                ) : (
                  <>
                    <Markdown text={m.content} />
                    <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end" }}><CopyBtn text={m.content} /></div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "10px 20px 16px", borderTop: `1px solid ${T.border}` }}>
          {error && <div style={{ marginBottom: 8 }}><Banner onClose={() => setError(null)}>{error}</Banner></div>}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 14, padding: "8px 8px 8px 16px" }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={connected ? `Message ${selectedModel || "model"}…  (Shift+Enter for a new line)` : "Connect to Ollama first…"}
              rows={1}
              style={{ flex: 1, background: "transparent", border: "none", color: T.text, fontFamily: MONO, fontSize: 13, outline: "none", resize: "none", lineHeight: 1.5, maxHeight: 140 }}
            />
            {streaming ? (
              <button onClick={stop} style={{ ...btnBase, background: T.red, color: "#fff", padding: "8px 16px", display: "flex", alignItems: "center", gap: 6 }}>
                <Icon d={Icons.stop} size={14} color="#fff" /> Stop
              </button>
            ) : (
              <button onClick={send} disabled={!input.trim() || !connected} style={{ ...btnBase, background: input.trim() && connected ? T.accent : T.border, color: "#fff", padding: "8px 16px", display: "flex", alignItems: "center", gap: 6, opacity: input.trim() && connected ? 1 : 0.5 }}>
                <Icon d={Icons.send} size={14} color="#fff" /> Send
              </button>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }`}</style>
    </div>
  );
}
