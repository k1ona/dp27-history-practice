// Offline queue for submissions and progress snapshots. Flushed when online, with retry and backoff.
import { db } from "./db.js";
import { content } from "./content.js";

const BASE_DELAY_S = 30;
const MAX_DELAY_S = 3600;
let flushing = false;

export async function enqueue(kind, payload) {
  await db.put("syncQueue", { kind, payload, tries: 0, nextAt: 0, createdAt: new Date().toISOString() });
  updateSyncStatus();
  flush();
}

export async function pendingCount() {
  return (await db.all("syncQueue")).filter((q) => q.kind === "submit").length;
}

export function backoffSeconds(tries) {
  const d = Math.min(MAX_DELAY_S, BASE_DELAY_S * 2 ** Math.max(0, tries - 1));
  return Math.round(d * (0.8 + Math.random() * 0.4));
}

async function post(endpoint, body) {
  // text/plain avoids a CORS preflight, which the Apps Script endpoint cannot answer.
  const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!j || j.ok !== true) throw new Error((j && j.error) || "rejected");
  return j;
}

export async function flush({ force = false } = {}) {
  if (flushing || !navigator.onLine) return;
  const cfg = await content.config();
  if (!cfg.syncEndpoint) return;
  const profile = await db.get("profile", "me");
  if (!profile || !profile.studentId) return;
  flushing = true;
  try {
    const now = Date.now();
    const queue = await db.all("syncQueue");
    for (const item of queue) {
      if (!force && item.nextAt > now) continue;
      try {
        await post(cfg.syncEndpoint, {
          action: item.kind, studentId: profile.studentId, pin: profile.pin || "", payload: item.payload,
        });
        await db.del("syncQueue", item.qid);
      } catch (e) {
        item.tries += 1;
        item.lastError = String(e.message || e);
        item.nextAt = Date.now() + backoffSeconds(item.tries) * 1000;
        await db.put("syncQueue", item);
      }
    }
  } finally {
    flushing = false;
    updateSyncStatus();
  }
}

export async function updateSyncStatus() {
  const pill = document.getElementById("sync-status");
  if (!pill) return;
  const n = await pendingCount();
  const online = navigator.onLine;
  let text;
  if (n === 0) text = online ? "All work sent" : "Offline";
  else text = `${n} answer${n === 1 ? "" : "s"} waiting to send`;
  if (!online && n) text = `Offline · ${text}`;
  pill.textContent = text;
  pill.dataset.pending = String(n);
}

setInterval(() => flush(), 30000);
window.addEventListener("online", () => flush({ force: true }));
