import { useState } from "react";
import { T, btnBase } from "../theme";

// ─── Icons ─────────────────────────────────────────────────────
export const Icon = ({ d, size = 18, color = T.textMuted, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d={d} />
  </svg>
);

export const Icons = {
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  agent: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  workflow: "M22 12h-4l-3 9L9 3l-3 9H2",
  swarm: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  image: "M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  plus: "M12 5v14M5 12h14",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  play: "M5 3l14 9-14 9V3z",
  stop: "M6 4h4v16H6zM14 4h4v16h-4z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  copy: "M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  check: "M20 6L9 17l-5-5",
  spinner: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  close: "M18 6L6 18M6 6l12 12",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
};

// ─── Markdown (small subset) ───────────────────────────────────
export function renderInline(text) {
  const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i} style={{ color: T.text }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <code key={i} style={{ background: "rgba(108,92,231,0.15)", padding: "1px 5px", borderRadius: 4, fontSize: "0.9em" }}>{p.slice(1, -1)}</code>;
    return p;
  });
}

const splitRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isDivider = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

const preStyle = { background: "#0d0d15", border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, overflowX: "auto", fontSize: 12, lineHeight: 1.6, margin: "8px 0" };

export function Markdown({ text }) {
  const lines = String(text || "").split("\n");
  const els = [];
  let inCode = false;
  let code = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCode) {
        els.push(<pre key={`c${i}`} style={preStyle}><code>{code.join("\n")}</code></pre>);
        code = [];
        inCode = false;
      } else inCode = true;
      continue;
    }
    if (inCode) { code.push(line); continue; }

    // table: header row + divider row + body rows
    if (line.trim().startsWith("|") && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = splitRow(line);
      const body = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) { body.push(splitRow(lines[j])); j++; }
      els.push(
        <div key={`t${i}`} style={{ overflowX: "auto", margin: "8px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "50%" }}>
            <thead>
              <tr>{header.map((h, k) => <th key={k} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${T.borderLight}`, color: T.accentSoft }}>{renderInline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, k) => <td key={k} style={{ padding: "6px 10px", borderBottom: `1px solid ${T.border}`, verticalAlign: "top" }}>{renderInline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j - 1;
      continue;
    }

    if (line.startsWith("### ")) els.push(<h5 key={i} style={{ margin: "10px 0 4px", fontSize: 13, color: T.accentSoft }}>{renderInline(line.slice(4))}</h5>);
    else if (line.startsWith("## ")) els.push(<h4 key={i} style={{ margin: "12px 0 4px", fontSize: 14, color: T.text }}>{renderInline(line.slice(3))}</h4>);
    else if (line.startsWith("# ")) els.push(<h3 key={i} style={{ margin: "12px 0 6px", fontSize: 16, color: T.text }}>{renderInline(line.slice(2))}</h3>);
    else if (/^\s*[-*] /.test(line)) els.push(<div key={i} style={{ paddingLeft: 16, position: "relative", margin: "2px 0" }}><span style={{ position: "absolute", left: 4, color: T.accent }}>•</span>{renderInline(line.replace(/^\s*[-*] /, ""))}</div>);
    else if (/^\s*\d+[.)] /.test(line)) {
      const n = line.match(/^\s*(\d+)[.)] /)[1];
      els.push(<div key={i} style={{ paddingLeft: 22, position: "relative", margin: "2px 0" }}><span style={{ position: "absolute", left: 2, color: T.accent }}>{n}.</span>{renderInline(line.replace(/^\s*\d+[.)] /, ""))}</div>);
    } else if (/^---+$/.test(line.trim())) els.push(<hr key={i} style={{ border: "none", borderTop: `1px solid ${T.border}`, margin: "10px 0" }} />);
    else if (line.trim() === "") els.push(<div key={i} style={{ height: 8 }} />);
    else els.push(<p key={i} style={{ margin: "3px 0", lineHeight: 1.65 }}>{renderInline(line)}</p>);
  }
  if (inCode && code.length) els.push(<pre key="cend" style={preStyle}><code>{code.join("\n")}</code></pre>);
  return <div>{els}</div>;
}

// ─── Small shared components ───────────────────────────────────
export function CopyBtn({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button onClick={copy} style={{ ...btnBase, background: "transparent", color: T.textDim, padding: 4, display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      <Icon d={copied ? Icons.check : Icons.copy} size={13} color={copied ? T.green : T.textDim} />
      {copied ? "Copied" : label}
    </button>
  );
}

export function Empty({ glyph, title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: T.textDim, padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>{glyph}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, maxWidth: 380, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

export function SmallBtn({ onClick, children, color = T.textMuted, bg = T.surfaceAlt, disabled, title, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ ...btnBase, background: bg, border: `1px solid ${T.border}`, color, padding: "5px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer", ...style }}
    >
      {children}
    </button>
  );
}

// Inline, non-blocking error / info banner.
export function Banner({ kind = "error", children, onClose }) {
  const c = kind === "error" ? T.red : kind === "warn" ? T.orange : T.green;
  return (
    <div style={{ background: `${c}14`, border: `1px solid ${c}50`, color: c, borderRadius: 8, padding: "8px 12px", fontSize: 12, lineHeight: 1.5, display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{children}</div>
      {onClose && <button onClick={onClose} style={{ ...btnBase, background: "transparent", color: c, padding: 0 }}>✕</button>}
    </div>
  );
}
