import { el, uuid, wordCount, labelLine, toast, richText } from "../util.js";
import { db } from "../db.js";
import { content, findQuestion } from "../content.js";
import { runChecks, copyGuard, modelText, fixedSince } from "../checks/feedback.js";
import { sentences } from "../checks/text.js";
import { mediaFigure } from "../diagrams.js";
import { P1_PARTS } from "./section.js";

export const TASK_MINUTES = { plan: 7, paragraph: 15, essay: { P2: 45, P3: 50 }, p1q1a: 4, p1q1b: 3, p1q2: 7, p1q3: 10, p1q4: 18 };

const MODE_HELP = {
  plan: "Plan in 7 minutes: a thesis that answers the question, 3–4 arguments with the named factor first, evidence for each, the strongest counter, and the criterion for your judgement.",
  paragraph: "Write one analytical paragraph: CLAIM → PROVE → EXPLAIN → TEST → JUDGE. Use the question's words in your first and last sentences.",
  essay: "Write the full essay. Introduction with thesis; body paragraphs that each answer the question; a conclusion that judges rather than recaps.",
};

export function targetMinutes(taskType, paper) {
  const t = TASK_MINUTES[taskType];
  return typeof t === "object" ? t[paper] : t;
}

export async function sourcesBlock(set) {
  const wrap = el("div", { class: "sources" });
  for (const s of set.sources) {
    const block = el("div", { class: "source-block", "data-source": s.letter },
      el("h4", {}, `Source ${s.letter}`),
      el("div", { class: "prov" }, [s.provenance.creator, s.provenance.sourceType, s.provenance.date].filter(Boolean).join(", ") + ".",
        s.provenance.contextNote ? ` ${s.provenance.contextNote}` : ""));
    if (s.text) block.append(el("div", { class: "extract" }, s.text));
    if (s.mediaId) block.append(await mediaFigure(s.mediaId, { compact: true }));
    if (s.table) block.append(el("div", { class: "table-wrap" }, el("table", { class: "grid-table" },
      el("thead", {}, el("tr", {}, ...s.table.columns.map((c) => el("th", {}, c)))),
      el("tbody", {}, ...s.table.rows.map((r) => el("tr", {}, ...r.map((c) => el("td", {}, String(c)))))))));
    wrap.append(block);
  }
  return wrap;
}

export async function writtenTask(id, questionId, taskType, parentId) {
  const rec = await content.record(id);
  const section = await content.section(id);
  const found = findQuestion(section, questionId);
  if (!found) throw new Error(`Unknown question ${questionId}`);
  const q = found.q;
  const paper = found.kind === "p1" ? "P1" : q.paper;
  const profile = (await db.get("profile", "me")) || { level: "HL" };
  const parent = parentId ? await db.get("attempts", parentId) : null;
  const draftKey = `draft:${questionId}:${taskType}:${parentId || "new"}`;
  const saved = await db.get("meta", draftKey);
  const target = targetMinutes(taskType, paper);
  const startedAt = saved?.startedAt || Date.now();

  const root = el("div", {});
  root.append(el("p", { class: "small" }, el("a", { href: `#/s/${id}` }, `← ${rec.title}`)));
  const title = found.kind === "p1" ? `${P1_PARTS[taskType]} · ${q.marks} marks` : `${taskType === "essay" ? "Full essay" : taskType[0].toUpperCase() + taskType.slice(1)}${parent ? ` · Draft ${parent.draft + 1}` : ""}`;
  root.append(el("h1", {}, title + (found.kind === "p1" && parent ? ` · Draft ${parent.draft + 1}` : "")));

  if (found.kind === "p1") root.append(await sourcesBlock(found.set));
  root.append(el("div", { class: "card", "data-question-text": "" }, el("p", { style: "font-weight:600" }, q.text), labelLine()));
  if (found.kind === "essay") root.append(el("p", { class: "small muted" }, MODE_HELP[taskType]));

  const timer = el("span", { class: "timer", "aria-live": "off" });
  const tick = () => {
    const mins = (Date.now() - startedAt) / 60000;
    timer.textContent = `${Math.floor(mins)}:${String(Math.floor((mins % 1) * 60)).padStart(2, "0")} of ${target} min`;
    timer.classList.toggle("over", mins > target);
  };
  tick();
  const iv = setInterval(() => { if (!document.body.contains(timer)) clearInterval(iv); else tick(); }, 1000);

  const ta = el("textarea", { id: "answer", "aria-label": "Your answer", spellcheck: "true", style: taskType === "essay" || taskType === "p1q4" ? "min-height:24rem" : "" },
    saved?.text ?? (parent ? parent.responseText : ""));
  const wc = el("span", { class: "small muted" });
  const updWc = () => { wc.textContent = `${wordCount(ta.value)} words`; };
  updWc();
  let saveT;
  ta.addEventListener("input", () => {
    updWc();
    clearTimeout(saveT);
    saveT = setTimeout(() => db.put("meta", { text: ta.value, startedAt }, draftKey), 600);
  });

  if (parent) {
    const flagged = new Set((parent.local?.checks || []).filter((c) => c.met === false && c.quote).map((c) => c.quote.replace(/…$/, "")));
    const old = el("div", { class: "draft-old", "aria-label": `Draft ${parent.draft}` });
    for (const s of sentences(parent.responseText)) {
      const hit = [...flagged].some((f) => s.text.startsWith(f.slice(0, 40)) || f.startsWith(s.text.slice(0, 40)));
      old.append(hit ? el("mark", { class: "flag" }, s.text) : s.text, " ");
    }
    root.append(el("div", { class: "callout" }, el("strong", {}, "Redraft instruction: "), parent.local?.redraftInstruction || ""),
      el("div", { class: "two-col" },
        el("div", {}, el("h2", {}, `Draft ${parent.draft}`), old),
        el("div", {}, el("h2", {}, `Draft ${parent.draft + 1}`), ta)));
  } else {
    root.append(ta);
  }
  const submit = el("button", { type: "button", id: "submit-answer" }, "Submit for feedback");
  root.append(el("div", { class: "row", style: "margin-top:.6rem" }, timer, el("span", { class: "spacer" }), wc, submit));

  submit.addEventListener("click", async () => {
    const text = ta.value.trim();
    if (wordCount(text) < 10) { toast("Write your answer first (at least a couple of sentences)."); return; }
    submit.disabled = true;
    const cfg = await content.config();
    const checks = runChecks({ taskType, text, q, set: found.set, section });
    const copy = copyGuard(text, modelText(found), q.autoCheck || {});
    const draft = parent ? parent.draft + 1 : 1;
    const attempt = {
      schema: "dp27.submission.v1",
      submissionId: uuid(),
      parentSubmissionId: parent ? parent.submissionId : null,
      studentId: profile.studentId || "",
      level: profile.level,
      sectionId: id,
      questionId,
      paper,
      taskType,
      draft,
      questionText: q.text,
      commandTerm: found.kind === "essay" ? q.commandTerm : null,
      namedFactor: found.kind === "essay" ? q.namedFactor : null,
      timeframe: found.kind === "essay" ? q.timeframe : rec.timeframe,
      sourceSetId: found.kind === "p1" ? found.set.sourceSetId : null,
      responseText: text,
      responses: [],
      wordCount: wordCount(text),
      minutesSpent: Math.max(1, Math.round((Date.now() - startedAt) / 60000)),
      timed: false,
      autoCheck: { met: checks.filter((c) => c.met === true).map((c) => c.id), notMet: checks.filter((c) => c.met === false).map((c) => c.id),
        details: checks.filter((c) => c.met === false).map((c) => ({ id: c.id, quote: c.quote, missing: c.missing, action: c.action })) },
      selfCheck: { met: [], notMet: [] },
      createdAt: new Date().toISOString(),
      appVersion: cfg.appVersion,
      counted: !copy.tooClose,
      afterFeedback: !!parent,
      afterTeacherFeedback: !!(parent && (await db.get("feedback", parent.submissionId))),
      local: { checks, copy, fixed: parent ? fixedSince(parent.local?.checks, checks) : [], stage: "selfcheck" },
    };
    await db.put("attempts", attempt);
    await db.del("meta", draftKey);
    location.hash = `#/attempt/${attempt.submissionId}/selfcheck`;
  });
  return root;
}

export function modelBlock(found) {
  const q = found.q;
  if (found.kind === "essay") {
    return el("div", { class: "model" },
      el("h2", {}, "Decode key"),
      el("div", { class: "table-wrap" }, el("table", { class: "grid-table" }, el("tbody", {},
        ...["verb", "factorOrTask", "timeframe", "scope", "judgement"].map((k) =>
          el("tr", {}, el("th", { scope: "row" }, { verb: "Verb", factorOrTask: "Factor / task", timeframe: "Timeframe", scope: "Scope / cases", judgement: "Judgement" }[k]), el("td", {}, q.decodeKey[k])))))),
      el("h2", {}, "Model plan"),
      el("p", {}, el("strong", {}, "Thesis: "), q.modelPlan.thesis),
      el("ol", {}, ...q.modelPlan.arguments.map((a) => el("li", {}, a.claim, a.isNamedFactor ? el("span", { class: "badge" }, " named factor") : null))),
      el("p", {}, el("strong", {}, "Counter: "), q.modelPlan.counter),
      el("p", {}, el("strong", {}, "Judgement criterion: "), q.modelPlan.judgementCriterion),
      el("h2", {}, "Annotated model paragraph"),
      el("div", { class: "card prose" }, ...q.modelParagraph.segments.map((s) =>
        el("p", { class: "model-seg" }, ...s.tags.map((t) => el("span", { class: `tag tag-${t.replace(/ /g, "_")}` }, t)), " ", s.text))),
      labelLine());
  }
  const m = q.model;
  return el("div", { class: "model" }, el("h2", {}, "Model answer"),
    m.points ? el("ol", {}, ...m.points.map((p) => el("li", {}, p))) : null,
    m.segments ? el("div", { class: "card prose" }, ...m.segments.map((s) =>
      el("p", { class: "model-seg" }, ...s.tags.map((t) => el("span", { class: `tag tag-${t.replace(/ /g, "_")}` }, t)), " ", s.text))) : null,
    m.bandNote ? el("p", { class: "small muted", html: richText(m.bandNote, { inline: true }) }) : null,
    labelLine());
}
