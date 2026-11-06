import { el, pct, labelLine } from "../util.js";
import { db } from "../db.js";
import { content } from "../content.js";
import { sectionProgress, PASS } from "../progress.js";
import { statusBadge } from "./dashboard.js";

export const MODE_LABELS = { plan: "Plan · 7 min", paragraph: "Paragraph · 12–15 min", essay: "Full essay" };
export const P1_PARTS = { p1q1a: "Q1(a)", p1q1b: "Q1(b)", p1q2: "Q2", p1q3: "Q3", p1q4: "Q4" };

export async function sectionHome(id) {
  const rec = await content.record(id);
  if (!rec) throw new Error(`Unknown section ${id}`);
  const avail = new Set((await content.available()).sections);
  const root = el("div", {});
  root.append(el("p", { class: "small" }, el("a", { href: "#/" }, "← Dashboard")),
    el("h1", {}, rec.title), el("div", { class: "row" }, statusBadge(rec, avail.has(id))),
    el("p", { class: "small muted" }, `${rec.topic.title} · ${rec.timeframe[0]}–${rec.timeframe[1]}`),
    el("div", { class: "callout small" }, el("strong", {}, "Syllabus bullet: "), rec.guideBullet.text,
      rec.guideBullet.flag ? el("span", { class: "muted" }, " (wording from the course plan)") : null));
  if (!avail.has(id)) {
    root.append(el("p", {}, rec.status === "coming_up" ? "This section is coming up in class. Its practice will appear here." : "This section is in preparation."));
    return root;
  }
  const section = await content.section(id);
  const p = await sectionProgress(rec, section);
  const profile = (await db.get("profile", "me")) || { level: "HL" };

  root.append(el("section", { class: "card" },
    el("h2", { style: "margin-top:0" }, "1 · Context builder"),
    el("p", {}, `About ${section.context.readingMinutes || 15} minutes, in ${p.chunkTotal} chunks, each followed by a checkpoint.`),
    el("ul", { class: "progress-list" },
      el("li", {}, el("span", {}, "Chunks read"), el("span", {}, `${p.chunksRead}/${p.chunkTotal}`)),
      el("li", {}, el("span", {}, "Checkpoint score (best attempt)"), el("span", { class: p.checkpoint >= PASS ? "ok" : "", "data-checkpoint": pct(p.checkpoint) }, pct(p.checkpoint)))),
    el("div", { class: "row" }, el("a", { class: "btn", href: `#/s/${id}/read/0` }, p.chunksRead ? "Continue reading" : "Start reading"),
      el("a", { class: "btn secondary", href: `#/s/${id}/recall` }, "Recall sheet")),
    el("details", {}, el("summary", {}, "Retake a checkpoint"), el("div", { class: "row" },
      ...section.context.chunks.map((c) => el("a", { class: "btn secondary", href: `#/s/${id}/items/checkpoint-${c.chunkId}` }, `Checkpoint ${c.chunkId.slice(1)}`))))));

  const practice = el("section", { class: `card ${p.unlocked ? "" : "locked"}`, id: "practice" },
    el("h2", { style: "margin-top:0" }, "2 · Practice"));
  if (!p.unlocked) {
    practice.append(el("p", { class: "warn", "data-locked": "true" },
      `Practice unlocks when you have read every chunk and score at least ${pct(PASS)} across the checkpoints. ` +
      `Now: ${p.chunksRead}/${p.chunkTotal} chunks read, checkpoints ${pct(p.checkpoint)}.`));
    root.append(practice);
    return root;
  }
  practice.append(
    el("div", { class: "row" },
      el("a", { class: "btn", href: `#/s/${id}/items/retrieval` }, `Retrieval (${section.retrieval.length})`),
      el("a", { class: "btn", href: `#/s/${id}/items/drills` }, `Skill drills (${section.drills.length})`)),
    el("ul", { class: "progress-list" },
      el("li", {}, el("span", {}, "Retrieval (best)"), el("span", {}, pct(p.retrieval))),
      el("li", {}, el("span", {}, "Skill drills (best, need 80%)"), el("span", { class: p.drills >= PASS ? "ok" : "" }, pct(p.drills)))));

  practice.append(el("h3", {}, "Written tasks"));
  practice.append(el("p", { class: "small muted" }, "Each task type must be attempted and then redrafted once after feedback."));
  practice.append(el("ul", { class: "progress-list", "data-tasks": "" }, ...p.tasks.map((t) =>
    el("li", { "data-task": t.key }, el("span", {}, t.label), el("span", { class: t.done ? "ok" : "muted" }, t.done ? "Done (redrafted)" : t.tried ? "Attempted, redraft needed" : "Not yet")))));

  if (section.essayQuestions) {
    for (const q of section.essayQuestions) {
      if (profile.level === "SL" && q.paper === "P3") continue;
      const essayLabel = q.paper === "P3" ? "Full essay · 50 min" : "Full essay · 45 min";
      practice.append(el("div", { class: "item", "data-question": q.questionId },
        el("div", { class: "qnum" }, `${q.paper} · ${q.commandTerm}`), el("p", {}, q.text),
        el("div", { class: "row" }, ...["plan", "paragraph", "essay"].map((m) =>
          el("a", { class: "btn secondary", href: `#/s/${id}/task/${q.questionId}/${m}` }, m === "essay" ? essayLabel : MODE_LABELS[m]))),
        labelLine()));
    }
  }
  if (section.sourceSets) {
    for (const set of section.sourceSets.filter((s) => !s.timedUse)) {
      practice.append(el("div", { class: "item", "data-set": set.sourceSetId },
        el("div", { class: "qnum" }, `Source set · ${set.sourceSetId.split("-").pop()}`), el("p", {}, set.focus),
        el("div", { class: "row" }, ...set.questions.map((q) =>
          el("a", { class: "btn secondary", href: `#/s/${id}/task/${q.questionId}/${q.part}` }, `${P1_PARTS[q.part]} · ${q.marks} marks`))),
        labelLine()));
    }
  }
  root.append(practice);

  const links = await content.crossLinksFor(id);
  if (links.length) {
    const map = await content.map();
    const title = (sid) => map.sections.find((s) => s.sectionId === sid)?.title || sid;
    root.append(el("section", { class: "card" }, el("h2", { style: "margin-top:0" }, "This evidence also works for…"),
      el("ul", {}, ...links.map((x) => el("li", {}, el("strong", {}, x.theme), ": ", x.note, " ",
        ...x.sectionIds.filter((s) => s !== id).map((s, i) => [i ? ", " : "", el("a", { href: `#/s/${s}` }, title(s))]))))));
  }
  if (p.complete) root.prepend(el("p", { class: "badge done", style: "font-size:1rem" }, "Section complete"));
  return root;
}
