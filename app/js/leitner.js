// Leitner spaced-review boxes (BUILD_PLAN SS7): intervals of 1, 3, 7, 14 and 30 days.
// Keyed by itemId (retrieval items) or factId (evidence-bank cards) in the one "leitner" store.
import { db } from "./db.js";

export const BOX_DAYS = [1, 3, 7, 14, 30];

export async function leitnerState(id) {
  return (await db.get("leitner", id)) || null;
}

export function isDue(state, now = Date.now()) {
  return !state || new Date(state.dueAt).getTime() <= now;
}

/** Records the result of one review and schedules the next one. A wrong answer always drops to
 * box 0 (due again tomorrow), so it comes back sooner, as BUILD_PLAN SS7 asks. */
export async function reviewed(id, correct) {
  const prev = await leitnerState(id);
  const box = correct ? Math.min((prev?.box ?? -1) + 1, BOX_DAYS.length - 1) : 0;
  const dueAt = new Date(Date.now() + BOX_DAYS[box] * 86400000).toISOString();
  const next = { box, dueAt, lastResult: correct ? "correct" : "wrong", lastAt: new Date().toISOString() };
  await db.put("leitner", next, id);
  return next;
}
