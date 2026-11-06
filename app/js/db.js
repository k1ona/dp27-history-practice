// IndexedDB storage. All student work lives here; nothing is kept in localStorage except the theme choice.

const DB_NAME = "dp27-history";
const DB_VERSION = 1;
export const STORES = ["profile", "reading", "itemResults", "attempts", "progress", "leitner", "timed", "syncQueue", "feedback", "meta"];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        if (name === "syncQueue") db.createObjectStore(name, { keyPath: "qid", autoIncrement: true });
        else if (name === "attempts") {
          const s = db.createObjectStore(name, { keyPath: "submissionId" });
          s.createIndex("bySection", "sectionId");
          s.createIndex("byQuestion", "questionId");
        } else db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  get: (store, key) => tx(store, "readonly", (s) => req2p(s.get(key))),
  put: (store, value, key) => tx(store, "readwrite", (s) => req2p(key === undefined ? s.put(value) : s.put(value, key))),
  del: (store, key) => tx(store, "readwrite", (s) => req2p(s.delete(key))),
  all: (store) => tx(store, "readonly", (s) => req2p(s.getAll())),
  keys: (store) => tx(store, "readonly", (s) => req2p(s.getAllKeys())),
  clear: (store) => tx(store, "readwrite", (s) => req2p(s.clear())),
  byIndex: (store, index, value) => tx(store, "readonly", (s) => req2p(s.index(index).getAll(value))),
  /** Dump every store (keys included) for export. */
  async dumpAll() {
    const out = {};
    for (const name of STORES) {
      const keys = await db.keys(name);
      const vals = await db.all(name);
      out[name] = keys.map((k, i) => ({ k, v: vals[i] }));
    }
    return out;
  },
  /** Restore from a dump. Existing records with the same key are replaced; others are kept. */
  async restore(dump, { skip = [] } = {}) {
    for (const name of STORES) {
      if (skip.includes(name) || !Array.isArray(dump[name])) continue;
      for (const { k, v } of dump[name]) {
        if (name === "attempts" || name === "syncQueue") await db.put(name, v);
        else await db.put(name, v, k);
      }
    }
  },
};

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      const granted = already || (await navigator.storage.persist());
      await db.put("meta", { granted, checkedAt: new Date().toISOString() }, "persist");
      return granted;
    }
  } catch { /* not supported */ }
  return false;
}
