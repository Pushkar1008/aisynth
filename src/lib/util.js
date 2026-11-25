export const uid = () => Math.random().toString(36).slice(2, 10);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
