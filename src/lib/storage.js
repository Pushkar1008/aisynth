import { useEffect, useRef, useState } from "react";

// All persisted data lives under this prefix so backup/reset can find it.
export const PREFIX = "aisynth:";

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota exceeded or storage unavailable
  }
}

export function removeKey(key) {
  try { localStorage.removeItem(PREFIX + key); } catch {}
}

const NONE = Symbol("none");

// useState that persists to localStorage (debounced, flushed on unmount / tab close).
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    const stored = loadJSON(key, undefined);
    if (stored === undefined) return typeof initial === "function" ? initial() : initial;
    return stored;
  });
  const pending = useRef(NONE);

  useEffect(() => {
    pending.current = value;
    const t = setTimeout(() => {
      saveJSON(key, value);
      pending.current = NONE;
    }, 300);
    return () => clearTimeout(t);
  }, [key, value]);

  useEffect(() => {
    const flush = () => {
      if (pending.current !== NONE) {
        saveJSON(key, pending.current);
        pending.current = NONE;
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [key]);

  return [value, setValue];
}

// Backup / restore of everything the app stores in localStorage.
export function exportAllData() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out[k] = localStorage.getItem(k);
    }
  } catch {}
  return { app: "aisynth", version: 1, exportedAt: new Date().toISOString(), data: out };
}

export function importAllData(obj) {
  if (!obj || obj.app !== "aisynth" || typeof obj.data !== "object") throw new Error("Not an AISynth backup file");
  let count = 0;
  for (const [k, v] of Object.entries(obj.data)) {
    if (k.startsWith(PREFIX) && typeof v === "string") {
      localStorage.setItem(k, v);
      count++;
    }
  }
  return count;
}

export function clearAllData() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {}
}
