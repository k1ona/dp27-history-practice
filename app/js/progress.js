// Practice gate and section completion rules (BUILD_PLAN §6). Always derived from stored results.
import { db } from "./db.js";

export const PASS = 0.8;

export function requiredTasks(record) {
  return record.papers.includes("P1")
    ? [
        { key: "p1q1", label: "Q1 (a) and (b)", parts: ["p1q1a", "p1q1b"] },
        { key: "p1q2", label: "Q2", parts: ["p1q2"] },
        { key: "p1q3", label: "Q3", parts: ["p1q3"] },
        { key: "p1q4", label: "Q4", parts: ["p1q4"] },
      ]
    : [
        { key: "plan", label: "Plan", parts: ["plan"] },
        { key: "paragraph", label: "Paragraph", parts: ["paragraph"] },
        { key: "essay", label: "Full essay", parts: ["essay"] },
      ];
}

export function checkpointItems(section) {
  return section.context.chunks.flatMap((c) => c.checkpoint);
}

async function bestScores(items) {
  const out = {};
  for (const it of items) {
    const r = await db.get("itemResults", it.itemId);
    out[it.itemId] = r ? r.best : 0;
  }
  return out;
}

function mean(obj, items) {
  if (!items.length) return 0;
  return items.reduce((a, it) => a + (obj[it.itemId] || 0), 0) / items.length;
}

/** Full progress picture for one section. `section` may be null if its content is not yet available. */
export async function sectionProgress(record, section) {
  const reading = (await db.get("reading", record.sectionId)) || { chunksRead: [] };
  const attempts = await db.byIndex("attempts", "bySection", record.sectionId);
  const tasks = requiredTasks(record).map((t) => {
    const done = t.parts.every((part) =>
      attempts.some((a) => a.taskType === part && a.draft >= 2 && a.counted !== false && a.afterFeedback));
    const tried = t.parts.some((part) => attempts.some((a) => a.taskType === part));
    return { ...t, done, tried };
  });
  if (!section) {
    return { available: false, reading, tasks, checkpoint: 0, drills: 0, readAll: false, unlocked: false, complete: false, attempts };
  }
  const cps = checkpointItems(section);
  const cpScores = await bestScores(cps);
  const drillScores = await bestScores(section.drills);
  const retrievalScores = await bestScores(section.retrieval);
  const chunkIds = section.context.chunks.map((c) => c.chunkId);
  const readAll = chunkIds.every((k) => (reading.chunksRead || []).includes(k));
  const checkpoint = mean(cpScores, cps);
  const drills = mean(drillScores, section.drills);
  const retrieval = mean(retrievalScores, section.retrieval);
  const unlocked = readAll && checkpoint >= PASS;
  const complete = unlocked && drills >= PASS && tasks.every((t) => t.done);
  return { available: true, reading, tasks, checkpoint, drills, retrieval, readAll, unlocked, complete, attempts,
           chunksRead: (reading.chunksRead || []).filter((k) => chunkIds.includes(k)).length, chunkTotal: chunkIds.length };
}

/** Record an answer; keeps the best score per item and the full history. */
export async function recordItem(itemId, score, response) {
  const prev = (await db.get("itemResults", itemId)) || { best: 0, history: [] };
  const entry = { score, response, at: new Date().toISOString() };
  const next = { best: Math.max(prev.best, score), last: score, history: [...prev.history, entry].slice(-20) };
  await db.put("itemResults", next, itemId);
  window.dispatchEvent(new Event("dp27-progress"));
  return next;
}
