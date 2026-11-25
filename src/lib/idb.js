// Tiny IndexedDB wrapper for the Imagine AI gallery. Images are too large for
// localStorage, so they live here.

const DB_NAME = "aisynth";
const STORE = "images";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is not available"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Transaction aborted")); };
  });
}

export const imgPut = (item) => run("readwrite", (s) => s.put(item));
export const imgAll = () => run("readonly", (s) => s.getAll());
export const imgDelete = (id) => run("readwrite", (s) => s.delete(id));
export const imgClear = () => run("readwrite", (s) => s.clear());
