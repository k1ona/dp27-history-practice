// Talks to the class sync endpoint (Apps Script). Everything is queued first, so the app works offline;
// the queue is flushed when the device is online, with retry and backoff.
import { db } from "./db.js";
import { content } from "./content.js";
import { sectionProgress } from "./progress.js";

const BASE_DELAY_S = 30;
const MAX_DELAY_S = 3600;
const PERMANENT = ["bad_schema", "wrong_student", "bad_task_type", "too_large", "bad_submission_id"];
const AUTH = ["bad_credentials", "locked", "bad_student"];
let flushing = false;

export class ApiError extends Error {}

/** One request to the endpoint. Sent as text/plain so the browser needs no CORS preflight. */
export async function api(action, body = {}) {
  const cfg = await content.config();
  if (!cfg.syncEndpoint) throw new ApiError("no_endpoint");
  let r;
  try {
    r = await fetch(cfg.syncEndpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...body }), redirect: "follow" });
  } catch {
    throw new ApiError("network");
  }
  if (!r.ok) throw new ApiError(`http_${r.status}`);
  let j;
  try { j = await r.json(); } catch { throw new ApiError("bad_reply"); }
  if (!j || j.ok !== true) throw new ApiError((j && j.error) || "rejected");
  return j;
}

export async function syncEnabled() {
  const cfg = await content.config();
  return !!cfg.syncEndpoint;
}

async function credentials() {
  const profile = await db.get("profile", "me");
  if (!profile || !profile.studentId || !profile.token) return null;
  return { profile, auth: { studentId: profile.studentId, token: profile.token } };
}

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

export async function flush({ force = false } = {}) {
  if (flushing || !navigator.onLine) return;
  if (!(await syncEnabled())) return;
  const cred = await credentials();
  if (!cred || cred.profile.needsSignIn) { updateSyncStatus(); return; }
  flushing = true;
  let authFailed = false;
  try {
    const now = Date.now();
    const queue = (await db.all("syncQueue")).sort((a, b) => (a.kind === "progress") - (b.kind === "progress") || a.qid - b.qid);
    for (const item of queue) {
      if (item.failed || (!force && item.nextAt > now)) continue;
      const payload = { ...item.payload };
      if (item.kind === "submit") { payload.studentId = cred.profile.studentId; payload.level = payload.level || cred.profile.level; }
      try {
        await api(item.kind, { ...cred.auth, payload });
        await db.del("syncQueue", item.qid);
      } catch (e) {
        const code = String(e.message || e);
        if (AUTH.includes(code)) { authFailed = true; break; }
        item.tries += 1;
        item.lastError = code;
        if (PERMANENT.includes(code)) item.failed = true;
        item.nextAt = Date.now() + backoffSeconds(item.tries) * 1000;
        await db.put("syncQueue", item);
      }
    }
    if (authFailed) {
      cred.profile.needsSignIn = true;
      await db.put("profile", cred.profile, "me");
    } else {
      await fetchFeedback();
    }
  } finally {
    flushing = false;
    updateSyncStatus();
  }
}

/** Fetches released teacher feedback and keeps it in the inbox. Unread state is kept on the device. */
export async function fetchFeedback() {
  const cred = await credentials();
  if (!cred || !navigator.onLine) return 0;
  let reply;
  try { reply = await api("feedback", cred.auth); } catch { return 0; }
  let fresh = 0;
  for (const fb of reply.feedback || []) {
    if (!fb || !fb.submissionId) continue;
    const old = await db.get("feedback", fb.submissionId);
    const clean = { ...fb };
    delete clean.markForPrediction; // never shown to students, even if a server sent it
    delete clean.markOutOf;
    if (!old) fresh++;
    await db.put("feedback", { ...clean, receivedAt: old?.receivedAt || new Date().toISOString(), readAt: old?.readAt || null }, fb.submissionId);
  }
  updateInboxBadge();
  return fresh;
}

/** A snapshot of progress plus a full backup. Only the newest snapshot waits in the queue. */
export async function buildProgress() {
  const profile = (await db.get("profile", "me")) || {};
  const map = await content.map();
  const avail = new Set((await content.available()).sections);
  const sections = [];
  for (const rec of map.sections) {
    if (!avail.has(rec.sectionId)) continue;
    const section = await content.section(rec.sectionId).catch(() => null);
    const p = await sectionProgress(rec, section);
    if (!p.chunksRead && !p.attempts.length && !p.checkpoint) continue;
    sections.push({ sectionId: rec.sectionId, chunksRead: `${p.chunksRead}/${p.chunkTotal}`, checkpoint: round(p.checkpoint),
      drills: round(p.drills), tasksDone: p.tasks.filter((t) => t.done).length, tasksTotal: p.tasks.length, complete: p.complete });
  }
  const stores = await db.dumpAll();
  delete stores.profile; // holds the sign-in token
  delete stores.syncQueue;
  const cfg = await content.config();
  return { schema: "dp27.progress.v1", studentId: profile.studentId || "", level: profile.level || "HL", createdAt: new Date().toISOString(),
    appVersion: cfg.appVersion, sections, backup: { schema: "dp27.export.v1", exportedAt: new Date().toISOString(), studentId: profile.studentId || "", stores } };
}

const round = (x) => Math.round((x || 0) * 1000) / 1000;

let progressTimer = null;
export function queueProgress(delayMs = 1500) {
  clearTimeout(progressTimer);
  progressTimer = setTimeout(async () => {
    if (!(await syncEnabled())) return;
    const payload = await buildProgress();
    for (const q of await db.all("syncQueue")) if (q.kind === "progress") await db.del("syncQueue", q.qid);
    await db.put("syncQueue", { kind: "progress", payload, tries: 0, nextAt: 0, createdAt: payload.createdAt });
    flush();
  }, delayMs);
}

/** Replaces this device's work with the backup on the class drive (used on a new device). */
export async function restoreFromServer() {
  const cred = await credentials();
  if (!cred) throw new ApiError("not_signed_in");
  const reply = await api("restore", cred.auth);
  if (!reply.backup || !reply.backup.stores) return false;
  await db.restore(reply.backup.stores, { skip: ["profile", "syncQueue"] });
  return true;
}

export async function updateSyncStatus() {
  const pill = document.getElementById("sync-status");
  if (!pill) return;
  const n = await pendingCount();
  const failed = (await db.all("syncQueue")).filter((q) => q.failed).length;
  const profile = await db.get("profile", "me");
  const enabled = await syncEnabled();
  const online = navigator.onLine;
  let text;
  if (enabled && n && (!profile?.token || profile?.needsSignIn)) text = "Sign in to send your work";
  else if (failed) text = `${failed} answer${failed === 1 ? "" : "s"} could not be sent: tell your teacher`;
  else if (n === 0) text = online ? "All work sent" : "Offline";
  else text = `${n} answer${n === 1 ? "" : "s"} waiting to send`;
  if (!online && n) text = `Offline · ${n} answer${n === 1 ? "" : "s"} waiting to send`;
  pill.textContent = text;
  pill.dataset.pending = String(n);
}

export async function updateInboxBadge() {
  const badge = document.getElementById("inbox-count");
  if (!badge) return;
  const unread = (await db.all("feedback")).filter((f) => !f.readAt).length;
  badge.textContent = unread ? String(unread) : "";
  badge.hidden = !unread;
}

window.addEventListener("dp27-progress", () => queueProgress());
setInterval(() => flush(), 30000);
window.addEventListener("online", () => flush({ force: true }));
