// Self-check criteria, checklist scoring, improvement points and the redraft instruction.
import { essayChecks, p1Checks, copyGuard } from "./auto.js";

export const ESSAY_CRITERIA = {
  exact_question: "My answer addresses the exact question.",
  decoded: "I followed the command term, factor, timeframe and scope.",
  precise_evidence: "I used precise evidence (names, dates, figures), not narrative.",
  mechanism: "I explained the mechanism (“which meant that…”).",
  counter: "I tested my argument with a counter or an alternative.",
  judgement_criterion: "I reached a judgement with a criterion.",
  question_words: "I used the question's words in my topic sentences and conclusion.",
  explicit_comparison: "I compared the cases explicitly.",
};

export const P1_CRITERIA = {
  p1q1a: { q1_points: "Each point is distinct, and I made as many points as there are marks.", q1_source: "Every point comes from the source.", q1_no_ok: "I added no own knowledge." },
  p1q1b: { q1_points: "Each point is distinct, and I made as many points as there are marks.", q1_source: "Every point comes from what the source shows.", q1_no_ok: "I added no own knowledge." },
  p1q2: { q2_value: "I explained value with a reason (“valuable because…”).", q2_limitation: "I explained a limitation with a reason.",
          q2_opc: "I referred to origin, purpose and content.", q2_feature: "I moved from a feature to its consequence, not a label." },
  p1q3: { q3_linked: "Each point links both sources on the same issue.", q3_compare: "I gave points of similarity.", q3_contrast: "I gave points of difference." },
  p1q4: { q4_focus: "I focused on the question.", q4_sources: "I used the sources explicitly as evidence.", q4_ok: "I added accurate own knowledge.",
          q4_argument: "I organised by argument, not by source order.", q4_judgement: "I reached a judgement." },
};

const PRIORITY = ["focus", "parts", "timeframe", "judgement", "evidence", "mechanism", "counter", "comparison", "question_words", "historiography",
  "points", "own_knowledge", "label_pattern", "opc", "value", "limitation", "linked", "separate", "sim_diff", "sources_used", "argument_order", "length"];

export function criteriaFor(taskType, q) {
  if (taskType.startsWith("p1")) return P1_CRITERIA[taskType];
  const ids = (q.selfCheck && q.selfCheck.length ? q.selfCheck : Object.keys(ESSAY_CRITERIA).filter((k) => k !== "explicit_comparison"));
  return Object.fromEntries(ids.map((k) => [k, ESSAY_CRITERIA[k]]));
}

export function runChecks({ taskType, text, q, set, section }) {
  return taskType.startsWith("p1") ? p1Checks(text, q, set, section) : essayChecks(text, q, section, taskType);
}

export function modelText(found) {
  if (found.kind === "essay") {
    const q = found.q;
    return [q.modelPlan.thesis, ...q.modelPlan.arguments.map((a) => a.claim), q.modelPlan.counter, q.modelPlan.judgementCriterion,
      ...q.modelParagraph.segments.map((s) => s.text)].join(" ");
  }
  const m = found.q.model;
  return [...(m.points || []), ...(m.segments || []).map((s) => s.text)].join(" ");
}

/**
 * Combine the self-check (student taps a sentence for each criterion) with the automatic checks.
 * A criterion counts as met only if the student tapped a sentence AND no automatic check mapped to it failed.
 */
export function score(criteria, selfCheck, checks) {
  const results = Object.keys(criteria).map((id) => {
    const tapped = selfCheck[id] !== undefined && selfCheck[id] !== null;
    const failed = checks.filter((c) => c.criterion === id && c.met === false);
    return { id, label: criteria[id], tapped, autoFailed: failed.map((f) => f.id), met: tapped && failed.length === 0 };
  });
  return { results, met: results.filter((r) => r.met).length, total: results.length };
}

export function improvementPoints(checks, scored, criteria, max = 3) {
  const failed = checks.filter((c) => c.met === false).sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
  const pts = failed.slice(0, max).map((c) => ({ check: c.id, quote: c.quote, missing: c.missing, action: c.action }));
  if (pts.length < 2) {
    for (const r of scored.results) {
      if (pts.length >= max) break;
      if (!r.met && !r.tapped) pts.push({ check: r.id, quote: null, missing: `You could not point to a sentence that shows: “${criteria[r.id]}”`, action: "Write that sentence, then point to it." });
    }
  }
  return pts.slice(0, max);
}

export function redraftInstruction(points) {
  if (!points.length) return "Strengthen your weakest paragraph: add one more piece of precise evidence and explain what it shows.";
  return points[0].action;
}

/** What Draft N fixed compared with its parent draft. */
export function fixedSince(prevChecks, checks) {
  const before = new Set((prevChecks || []).filter((c) => c.met === false).map((c) => c.id));
  return checks.filter((c) => c.met === true && before.has(c.id)).map((c) => c.id);
}

export const CHECK_NAMES = {
  focus: "question focus", parts: "both parts of the question", timeframe: "timeframe", evidence: "precise evidence", mechanism: "mechanism",
  counter: "counter-argument", judgement: "judgement", question_words: "question words", comparison: "explicit comparison",
  historiography: "use of historians", length: "length", points: "number of points", own_knowledge: "own knowledge",
  label_pattern: "feature → consequence", value: "value", limitation: "limitation", opc: "origin, purpose, content",
  linked: "linking both sources", separate: "no separate summaries", sim_diff: "similarities and differences",
  sources_used: "use of sources", argument_order: "organised by argument",
};

export { copyGuard };
