// Shared design tokens and base styles. Dark theme only.

export const T = {
  bg: "#0a0a0f",
  surface: "#12121a",
  surfaceAlt: "#1a1a26",
  border: "#2a2a3a",
  borderLight: "#3a3a4f",
  accent: "#6c5ce7",
  accentGlow: "rgba(108,92,231,0.25)",
  accentSoft: "#8b7cf0",
  green: "#00d2a0",
  greenGlow: "rgba(0,210,160,0.2)",
  orange: "#ff9f43",
  red: "#ff6b6b",
  text: "#e8e6f0",
  textMuted: "#8a889a",
  textDim: "#5a586a",
};

export const MONO = "'JetBrains Mono', 'Fira Code', monospace";

export const btnBase = {
  border: "none",
  cursor: "pointer",
  fontFamily: MONO,
  fontSize: 13,
  borderRadius: 8,
  transition: "all 0.2s ease",
};

export const inputBase = {
  background: T.surfaceAlt,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  fontFamily: MONO,
  fontSize: 13,
  padding: "10px 14px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export const labelStyle = {
  fontSize: 10,
  color: T.textDim,
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: 1,
};

// Distinct colours for agents / series.
export const PALETTE = ["#6c5ce7", "#00d2a0", "#ff9f43", "#e84393", "#0984e3", "#fdcb6e", "#55efc4", "#ff7675"];
