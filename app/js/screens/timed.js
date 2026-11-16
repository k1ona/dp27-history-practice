// Timed full papers (BUILD_PLAN SS5.3): a shared countdown, several questions, autosave, and no
// model or feedback shown until the whole paper is handed in.
import { el, uuid, toast } from "../util.js";
import { db } from "../db.js";
import { content, findQuestion } from "../content.js";
import { buildAttempt, sourcesBlock } from "./task.js";
import { P1_PARTS } from "./section.js";

const DRAFT_KEY = (sessionId, questionId) => `timedpart:${sessionId}:${questionId}`;

async function profile() {
  return (await db.get("profile", "me")) || { level: "HL" };
}

async function inProgressSession() {
  const all = await db.all("timed");
  return all.find((s) => !s.submittedAt) || null;
}

export async function timedHome() {
  const prof = await profile();
  const tp = await content.timedPapers();
  const sessions = await db.all("timed");
  const root = el("div", {});
  root.append(el("h1", {}, "Timed full papers"),
    el("p", { class: "muted" }, "Full exam conditions: one timer for the whole paper, no feedback or model answer until you submit. These do not have to be finished to count towards a section; they are stamina practice."));
  const active = sessions.find((s) => !s.submittedAt);
  if (active) {
    root.append(el("div", { class: "callout", "data-timed-active": "" },
      el("strong", {}, "You have a paper in progress: "), active.title, ". ",
      el("a", { href: `#/timed/write/${active.sessionId}` }, "Resume it →")));
  }
  for (const paperKey of ["P1", "P2", "P3"]) {
    if (paperKey === "P3" && prof.level === "SL") continue;
    const group = tp.papers.filter((p) => p.paper === paperKey);
    if (!group.length) continue;
    const label = { P1: "Paper 1 (60 minutes)", P2: "Paper 2 (90 minutes)", P3: "Paper 3 (150 minutes)" }[paperKey];
    const grid = el("div", { class: "grid" });
    for (const p of group) {
      const done = sessions.filter((s) => s.paperId === p.paperId && s.submittedAt);
      const card = el("div", { class: "card", "data-timed-paper-id": p.paperId },
        el("div", { class: "row" }, el("strong", {}, p.title)),
        el("p", { class: "small muted" }, done.length ? `Attempted ${done.length} time${done.length === 1 ? "" : "s"}` : "Not yet attempted"),
        active ? el("span", { class: "small muted" }, "Finish your paper in progress first") :
          el("a", { class: "btn", href: `#/timed/start/${p.paperId}` }, "Start"));
      grid.append(card);
    }
    root.append(el("h2", {}, label), grid);
  }
  return root;
}

async function p1Parts(paper) {
  const section = await content.section(paper.sectionId);
  const set = section.sourceSets.find((s) => s.sourceSetId === paper.sourceSetId);
  return set.questions.map((q) => ({ sectionId: paper.sectionId, questionId: q.questionId, taskType: q.part }));
}

async function refText(ref) {
  const section = await content.section(ref.sectionId);
  const q = section.essayQuestions.find((x) => x.questionId === ref.questionId);
  const rec = await content.record(ref.sectionId);
  return { rec, q };
}

export async function timedStart(paperId) {
  if (await inProgressSession()) { location.hash = "#/timed"; return el("div", {}); }
  const tp = await content.timedPapers();
  const paper = tp.papers.find((p) => p.paperId === paperId);
  if (!paper) throw new Error(`Unknown timed paper ${paperId}`);
  const root = el("div", {});
  root.append(el("p", { class: "small" }, el("a", { href: "#/timed" }, "← Timed full papers")),
    el("h1", {}, paper.title),
    el("p", {}, `${paper.durationMinutes} minutes. One timer for the whole paper. You will not see a model answer or feedback until you submit every part.`));

  async function beginWith(parts) {
    const session = { sessionId: uuid(), paperId: paper.paperId, paper: paper.paper, title: paper.title,
      durationMinutes: paper.durationMinutes, startedAt: new Date().toISOString(), parts, submittedAt: null, autoSubmitted: false, attemptIds: [] };
    await db.put("timed", session, session.sessionId);
    location.hash = `#/timed/write/${session.sessionId}`;
  }

  if (paper.paper === "P1") {
    root.append(el("p", {}, "4 sources and questions Q1(a), Q1(b), Q2, Q3 and Q4. The sources are part of the 60 minutes, so they are shown only once you start."));
    const go = el("button", { type: "button", class: "btn" }, "Start the timer");
    go.addEventListener("click", async () => go.disabled || beginWith(await p1Parts(paper)));
    root.append(go);
    return root;
  }

  const picked = new Map();
  const go = el("button", { type: "button", class: "btn", disabled: true }, "Start the timer");

  if (paper.paper === "P2") {
    root.append(el("p", {}, "Choose one Topic 9 essay and one Topic 12 essay. You will write both within the 90 minutes."));
    for (const [key, heading] of [["topic9", "Topic 9"], ["topic12", "Topic 12"]]) {
      root.append(el("h2", {}, heading));
      const refs = paper[key];
      const texts = await Promise.all(refs.map(refText));
      const list = el("div", {});
      refs.forEach((ref, i) => {
        const { rec, q } = texts[i];
        const id = `pick-${key}-${i}`;
        const input = el("input", { type: "radio", name: key, id, value: i });
        input.addEventListener("change", () => { picked.set(key, ref); go.disabled = picked.size < 2; });
        list.append(el("div", { class: "opt" }, input, el("label", { for: id }, el("div", { class: "small muted" }, rec.title), q.text)));
      });
      root.append(list);
    }
    go.addEventListener("click", () => beginWith([{ ...picked.get("topic9"), taskType: "essay" }, { ...picked.get("topic12"), taskType: "essay" }]));
  } else {
    root.append(el("p", {}, `Choose exactly 3 of the ${paper.questions.length} essay questions below, from across §16, §17 and §18. You will write all 3 within the 150 minutes.`));
    const boxes = [];
    const refs = paper.questions;
    const texts = await Promise.all(refs.map(refText));
    const list = el("div", {});
    refs.forEach((ref, i) => {
      const { rec, q } = texts[i];
      const id = `pick-q-${i}`;
      const input = el("input", { type: "checkbox", id });
      input.addEventListener("change", () => {
        if (input.checked) picked.set(i, ref); else picked.delete(i);
        go.disabled = picked.size !== 3;
        boxes.forEach((b) => { if (!b.checked) b.disabled = picked.size >= 3; });
      });
      boxes.push(input);
      list.append(el("div", { class: "opt" }, input, el("label", { for: id }, el("div", { class: "small muted" }, `§${ref.area} · ${rec.title}`), q.text)));
    });
    root.append(list);
    go.addEventListener("click", () => beginWith([...picked.values()].map((ref) => ({ ...ref, taskType: "essay" }))));
  }
  root.append(el("div", { class: "row", style: "margin-top:1rem" }, go));
  return root;
}

export async function timedWriter(sessionId) {
  const session = await db.get("timed", sessionId);
  if (!session) throw new Error("Timed paper session not found");
  if (session.submittedAt) { location.hash = `#/timed/summary/${sessionId}`; return el("div", {}); }
  const prof = await profile();
  const parts = await Promise.all(session.parts.map(async (part) => {
    const section = await content.section(part.sectionId);
    const rec = await content.record(part.sectionId);
    const found = findQuestion(section, part.questionId);
    const saved = await db.get("meta", DRAFT_KEY(sessionId, part.questionId));
    return { part, section, rec, found, saved };
  }));

  const root = el("div", {});
  root.append(el("h1", {}, session.title));
  const startedAt = new Date(session.startedAt).getTime();
  const timerBar = el("div", { class: "card row", "data-timed-timer": "" });
  const timerText = el("span", { class: "timer score-big" });
  const lockNote = el("p", { class: "callout mis", hidden: true },
    el("strong", {}, "Time's up. "), "Your answers are locked. Submit now to see your self-check and feedback.");
  timerBar.append(timerText);
  root.append(timerBar, lockNote);

  const sources = parts[0].found.kind === "p1" ? await sourcesBlock(parts[0].found.set) : null;
  const sections = parts.map((p, i) => writerPart(p, i, parts.length));
  if (sources) root.append(sources);
  root.append(...sections.map((s) => s.node));

  const submit = el("button", { type: "button", class: "btn", id: "submit-paper" }, "Submit the paper");
  root.append(el("div", { class: "row", style: "margin-top:1rem" }, submit));

  let locked = false, timeRanOutBeforeSubmit = false;
  function lock(auto) {
    if (locked) return;
    locked = true;
    sections.forEach((s) => (s.textarea.disabled = true));
    lockNote.hidden = false;
    if (auto) { timeRanOutBeforeSubmit = true; toast("Time's up: your answers have been locked."); }
  }
  const tick = () => {
    const mins = (Date.now() - startedAt) / 60000;
    const left = Math.max(0, session.durationMinutes - mins);
    timerText.textContent = left > 0 ? `${Math.floor(left)}:${String(Math.floor((left % 1) * 60)).padStart(2, "0")} left`
      : "Time's up";
    timerText.classList.toggle("over", left <= 0);
    if (left <= 0) lock(true);
  };
  tick();
  const iv = setInterval(() => { if (!document.body.contains(timerText)) clearInterval(iv); else tick(); }, 1000);

  submit.addEventListener("click", async () => {
    submit.disabled = true;
    const attempts = [];
    for (const { part, section, rec, found, textarea } of sections) {
      const text = textarea.value.trim() || "(No answer given.)";
      const paper = found.kind === "p1" ? "P1" : found.q.paper;
      const attempt = await buildAttempt({ id: part.sectionId, rec, section, found, questionId: part.questionId,
        taskType: part.taskType, paper, text, startedAt, parent: null, profile: prof, timed: true });
      attempt.timedSessionId = sessionId;
      attempts.push(attempt);
    }
    for (let i = 0; i < attempts.length - 1; i++) attempts[i].timedNext = attempts[i + 1].submissionId;
    for (const a of attempts) await db.put("attempts", a);
    for (const { part } of sections) await db.del("meta", DRAFT_KEY(sessionId, part.questionId));
    session.submittedAt = new Date().toISOString();
    session.autoSubmitted = timeRanOutBeforeSubmit;
    session.attemptIds = attempts.map((a) => a.submissionId);
    await db.put("timed", session, sessionId);
    location.hash = `#/attempt/${attempts[0].submissionId}/selfcheck`;
  });
  return root;

  function writerPart({ part, section, rec, found, saved }, i, total) {
    const title = found.kind === "p1" ? `${P1_PARTS[part.taskType]} · ${found.q.marks} marks` : "Full essay";
    const wrap = el("div", { class: "card" },
      el("div", { class: "row" }, el("strong", {}, `Part ${i + 1} of ${total} · ${title}`), el("span", { class: "spacer" }), el("span", { class: "small muted" }, rec.title)));
    wrap.append(el("p", { style: "font-weight:600" }, found.q.text));
    const textarea = el("textarea", { "aria-label": `Your answer, part ${i + 1}`, spellcheck: "true" }, saved?.text || "");
    let saveT;
    textarea.addEventListener("input", () => {
      clearTimeout(saveT);
      saveT = setTimeout(() => db.put("meta", { text: textarea.value }, DRAFT_KEY(sessionId, part.questionId)), 600);
    });
    const node = el("div", {}, wrap, textarea);
    return { node, textarea, part, section, rec, found };
  }
}

export async function timedSummary(sessionId) {
  const session = await db.get("timed", sessionId);
  if (!session) throw new Error("Timed paper session not found");
  const attempts = await Promise.all(session.attemptIds.map((id) => db.get("attempts", id)));
  const root = el("div", {});
  root.append(el("h1", {}, "Paper finished"), el("p", {}, session.title),
    el("p", { class: "small muted" }, `Started ${new Date(session.startedAt).toLocaleString()}${session.autoSubmitted ? " · submitted automatically when time ran out" : ""}`));
  const list = el("ol", {});
  attempts.forEach((a, i) => {
    if (!a) return;
    list.append(el("li", {}, el("a", { href: `#/attempt/${a.submissionId}/feedback` }, `Part ${i + 1}: ${a.questionText.slice(0, 80)}${a.questionText.length > 80 ? "…" : ""}`),
      el("span", { class: "small muted" }, ` · ${a.local?.scored ? `${a.local.scored.met}/${a.local.scored.total} criteria met` : "not yet self-checked"}`)));
  });
  root.append(list, el("div", { class: "row", style: "margin-top:1rem" },
    el("a", { class: "btn", href: "#/timed" }, "Back to timed papers"), el("a", { class: "btn secondary", href: "#/" }, "Dashboard")));
  return root;
}
