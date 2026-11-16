// Daily Review queue and weekly "unfamiliar question" drill (BUILD_PLAN SS7).
import { el, pct, shuffle } from "../util.js";
import { db } from "../db.js";
import { content } from "../content.js";
import { sectionProgress, recordItem } from "../progress.js";
import { renderItem } from "../items/index.js";
import { leitnerState, isDue, reviewed } from "../leitner.js";
import { visibleForLevel } from "./dashboard.js";

const SESSION_SIZE = 15;

async function startedSections(profile) {
  const map = await content.map();
  const avail = new Set((await content.available()).sections);
  const out = [];
  for (const rec of map.sections) {
    if (!visibleForLevel(rec, profile.level) || !avail.has(rec.sectionId)) continue;
    const section = await content.section(rec.sectionId).catch(() => null);
    if (!section) continue;
    const p = await sectionProgress(rec, section);
    if (p.chunksRead || p.attempts.length) out.push({ rec, section });
  }
  return out;
}

/** Every retrieval item and evidence-bank fact across the given sections, flattened and tagged with
 * where it came from, so the review queue can interleave sections and papers (BUILD_PLAN SS7). */
function pool(started) {
  const items = [], facts = [];
  for (const { rec, section } of started) {
    for (const it of section.retrieval) items.push({ kind: "item", rec, section, it });
    for (const f of section.context.evidenceBank) facts.push({ kind: "fact", rec, section, f });
  }
  return [...items, ...facts];
}

export async function reviewQueue() {
  const profile = (await db.get("profile", "me")) || { level: "HL" };
  const started = await startedSections(profile);
  const root = el("div", {});
  root.append(el("h1", {}, "Daily review"), el("p", { class: "muted" },
    "10-15 minutes, every day you can. Items you get wrong come back sooner."),
    el("p", { class: "small" }, el("a", { href: "#/review/weekly" }, "This week's unfamiliar question →")));
  if (!started.length) {
    root.append(el("p", {}, "Start reading a section first: the review queue draws on sections you have begun."),
      el("a", { class: "btn", href: "#/" }, "Back to the dashboard"));
    return root;
  }
  const all = pool(started);
  const withDue = await Promise.all(all.map(async (x) => {
    const id = x.kind === "item" ? x.it.itemId : x.f.factId;
    return { ...x, id, state: await leitnerState(id) };
  }));
  const due = withDue.filter((x) => isDue(x.state));
  if (!due.length) {
    const soonest = withDue.map((x) => x.state).filter(Boolean).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
    root.append(el("div", { class: "card" }, el("p", { class: "score-big ok" }, "You're all caught up."),
      el("p", { class: "muted" }, soonest ? `Your next item is due ${new Date(soonest.dueAt).toLocaleDateString()}.` : "Practise a section to add items here.")),
      el("a", { class: "btn", href: "#/" }, "Back to the dashboard"));
    return root;
  }
  const session = shuffle(due, `${profile.studentId || ""}:${new Date().toISOString().slice(0, 10)}`).slice(0, SESSION_SIZE);
  root.append(el("p", { class: "small muted" }, `${session.length} due now (${due.length} in total across your started sections).`));
  const summary = el("div", { class: "card", hidden: true, "aria-live": "polite" });
  const scores = {};
  const mark = async (x, correct, score) => {
    scores[x.id] = score;
    await reviewed(x.id, correct);
    if (x.kind === "item") await recordItem(x.it.itemId, score, null);
    if (Object.keys(scores).length === session.length) {
      const right = Object.values(scores).filter((s) => s >= 0.999).length;
      summary.hidden = false;
      summary.replaceChildren(el("p", { class: "score-big" }, `${right} of ${session.length} fully correct`),
        el("div", { class: "row" }, el("a", { class: "btn", href: "#/" }, "Back to the dashboard"),
          el("button", { type: "button", class: "secondary", onclick: () => location.reload() }, "More for today")));
    }
  };
  session.forEach((x, i) => {
    if (x.kind === "item") {
      root.append(sourceTag(x.rec), renderItem(x.it, { index: i + 1, total: session.length, onScored: (score) => mark(x, score >= 0.999, score) }));
    } else {
      root.append(sourceTag(x.rec), evidenceCard(x.f, i + 1, session.length, (correct) => mark(x, correct, correct ? 1 : 0)));
    }
  });
  root.append(summary);
  return root;
}

function sourceTag(rec) {
  return el("p", { class: "small muted", style: "margin-bottom:-.6rem" }, rec.title);
}

/** A simple recall card for one evidence-bank fact: a cue built from what it supports, then the
 * fact itself, then a self-rating (BUILD_PLAN SS7's "evidence-bank cards"). */
function evidenceCard(fact, index, total, onRated) {
  const box = el("section", { class: "item", "data-fact": fact.factId, "aria-label": `Evidence ${index}` });
  box.append(el("div", { class: "qnum" }, `Evidence ${index} of ${total} · Recall the fact`),
    el("p", {}, el("strong", {}, "Recall the evidence for: "), fact.supports[0] || "this section"));
  const back = el("div", { hidden: true }, el("p", { class: "card" }, fact.text));
  const show = el("button", { type: "button", class: "secondary" }, "Show the fact");
  const rate = el("div", { class: "row", hidden: true },
    el("button", { type: "button", onclick: () => rated(true) }, "I recalled this"),
    el("button", { type: "button", class: "secondary", onclick: () => rated(false) }, "I did not recall this"));
  const result = el("p", { class: "result" });
  show.addEventListener("click", () => { back.hidden = false; rate.hidden = false; show.disabled = true; });
  function rated(correct) {
    rate.querySelectorAll("button").forEach((b) => (b.disabled = true));
    result.className = `result ${correct ? "ok" : "bad"}`;
    result.textContent = correct ? "Marked as recalled." : "Marked as not recalled; it will come back sooner.";
    onRated(correct);
  }
  box.append(el("div", { class: "row" }, show), back, rate, result);
  return box;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
function isoWeekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / WEEK_MS) + 1);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** This week's one planning drill: a random essay question from a section the student has already
 * completed, picked once and kept all week (BUILD_PLAN SS7). */
export async function weeklyDrill() {
  const profile = (await db.get("profile", "me")) || { level: "HL" };
  const root = el("div", {});
  root.append(el("h1", {}, "This week's unfamiliar question"),
    el("p", { class: "muted" }, "7 minutes, in Plan mode: a question from a section you have already completed, to keep your planning sharp on content you are not actively revising."));
  const map = await content.map();
  const avail = new Set((await content.available()).sections);
  const complete = [];
  for (const rec of map.sections) {
    const isP2orP3 = rec.papers.includes("P2") || rec.papers.includes("P3");
    if (!visibleForLevel(rec, profile.level) || !avail.has(rec.sectionId) || !isP2orP3) continue;
    const section = await content.section(rec.sectionId).catch(() => null);
    if (!section || !section.essayQuestions?.length) continue;
    const p = await sectionProgress(rec, section);
    if (p.complete) complete.push({ rec, section });
  }
  if (!complete.length) {
    root.append(el("p", {}, "Complete a Paper 2 or Paper 3 section first: this drill draws on sections you have finished."),
      el("a", { class: "btn", href: "#/" }, "Back to the dashboard"));
    return root;
  }
  const weekKey = isoWeekKey();
  let picked = await db.get("meta", "weeklyDrill");
  const stillValid = picked && picked.weekKey === weekKey && complete.some((c) => c.section.essayQuestions.some((q) => q.questionId === picked.questionId));
  if (!stillValid) {
    const { rec, section } = complete[Math.floor(Math.random() * complete.length)];
    const q = section.essayQuestions[Math.floor(Math.random() * section.essayQuestions.length)];
    picked = { weekKey, sectionId: rec.sectionId, questionId: q.questionId };
    await db.put("meta", picked, "weeklyDrill");
  }
  const { rec, section } = complete.find((c) => c.rec.sectionId === picked.sectionId) || complete[0];
  const q = section.essayQuestions.find((x) => x.questionId === picked.questionId) || section.essayQuestions[0];
  root.append(el("div", { class: "card" }, el("p", { class: "small muted" }, rec.title), el("p", { style: "font-weight:600" }, q.text)),
    el("a", { class: "btn", href: `#/s/${rec.sectionId}/task/${q.questionId}/plan` }, "Plan it now"));
  return root;
}
