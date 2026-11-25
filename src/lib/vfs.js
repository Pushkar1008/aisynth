// Agent workspace: a small virtual file system persisted in localStorage.
// Browsers cannot touch arbitrary files on disk, so agents read and write here.
// Use the Files panel in Agent mode to download anything they produce.

import { loadJSON, saveJSON } from "./storage";

const KEY = "vfs";
const MAX_TOTAL = 2_000_000; // characters, keeps us well under the localStorage quota

function normalize(path) {
  const p = String(path || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.includes("..") || p.length > 120) throw new Error(`Invalid path: "${path}"`);
  return p;
}

export function vfsAll() {
  return loadJSON(KEY, {});
}

export function vfsList() {
  return Object.keys(vfsAll()).sort();
}

export function vfsRead(path) {
  const files = vfsAll();
  const p = normalize(path);
  if (!(p in files)) throw new Error(`File not found: ${p}. Existing files: ${Object.keys(files).join(", ") || "(none)"}`);
  return files[p];
}

export function vfsWrite(path, content) {
  const p = normalize(path);
  const files = vfsAll();
  files[p] = String(content ?? "");
  const total = Object.values(files).reduce((n, c) => n + c.length, 0);
  if (total > MAX_TOTAL) throw new Error("Workspace is full (2 MB limit). Delete some files first.");
  if (!saveJSON(KEY, files)) throw new Error("Could not save file (browser storage is full or blocked).");
  return p;
}

export function vfsDelete(path) {
  const files = vfsAll();
  delete files[path];
  saveJSON(KEY, files);
}
