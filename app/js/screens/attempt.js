import { el, toast } from "../util.js";
import { db } from "../db.js";
import { content, findQuestion } from "../content.js";
import { criteriaFor, score, improvementPoints, redraftInstruction, CHECK_NAMES } from "../checks/feedback.js";
import { sentences } from "../checks/text.js";
import { enqueue, syncEnabled, requestInstantFeedback } from "../sync.js";
import { modelBlock, sourcesBlock } from "./task.js";
import { P1_PARTS } from "./section.js";
import { teacherCard } from "./inbox.js";
import { updateInboxBadge } from "../sync.js";

/** The fields of dp27.submission.v1 that leave the device. */
export function contractView(a) {
  const keys = ["schema", "submissionId", "parentSubmissionId", "studentId", "level", "sectionId", "questionId", "paper", "taskType", "draft",
    "questionText", "commandTerm", "namedFactor", "timeframe", "sourceSetId", "responseText", "responses", "wordCount", "minutesSpent", "timed",
    "autoCheck", "selfCheck", "createdAt", "appVersion"];
  return Object.fromEntries(keys.map((k) => [k, a[k] ?? null]));
}

export async function attemptScreen(subId, view) {
  const a = await db.get("attempts", subId);
  if (!a) throw new Error("Attempt not found");
  const section = await content.section(a.sectionId);
  const rec = await content.record(a.sectionId);
  const found = findQuestion(section, a.questionId);
  const criteria = criteriaFor(a.taskType, found.q);
  const root = el("div", {});
  root.append(el("p", { class: "small" }, el("a", { href: `#/s/${a.sectionId}` }, `← ${rec.title}`)));
  if (view === "selfcheck" && a.local.stage === "selfcheck") return selfCheckView(root, a, criteria);
  if (view === "model") return modelView(root, a, found);
  return feedbackView(root, a, found, criteria);
}

function selfCheckView(root, a, criteria) {
  const sents = sentences(a.responseText);
  const ids = Object.keys(criteria);
  const taps = {};
  let active = 0;
  root.append(el("h1", {}, "Self-check"),
    el("p", {}, "For each statement, tap the sentence in your answer that proves it. If you cannot find one, choose “I can't find one”: the criterion then counts as not met."));
  const list = el("ol", { class: "criteria" });
  const answer = el("div", { class: "answer-text", "aria-label": "Your answer, sentence by sentence" });
  const done = el("button", { type: "button", id: "finish-selfcheck", disabled: true }, "See my feedback");
  const sentBtns = sents.map((s, i) => {
    const b = el("button", { type: "button", class: "sentence-pick", "data-sentence": i, "aria-pressed": "false" }, s.text);
    b.addEventListener("click", () => { taps[ids[active]] = i; advance(); });
    answer.append(b, " ");
    return b;
  });
  const rows = ids.map((id, i) => {
    const status = el("span", { class: "small muted" }, "");
    const none = el("button", { type: "button", class: "link", "data-none": id }, "I can't find one");
    none.addEventListener("click", () => { active = i; taps[id] = null; advance(); });
    const pick = el("button", { type: "button", class: "link", "data-pick": id }, "Point to it");
    pick.addEventListener("click", () => { active = i; draw(); answer.querySelector("button")?.focus(); });
    const li = el("li", { "data-criterion": id }, el("div", {}, criteria[id]), el("div", { class: "row" }, pick, none, status));
    list.append(li);
    return { li, status };
  });
  function advance() {
    const next = ids.findIndex((id) => !(id in taps));
    active = next === -1 ? active : next;
    draw();
  }
  function draw() {
    rows.forEach((r, i) => {
      const id = ids[i];
      r.li.style.fontWeight = i === active && !(id in taps) ? "700" : "400";
      r.status.textContent = id in taps ? (taps[id] === null ? "Not found" : `Sentence ${taps[id] + 1}`) : i === active ? "← tap a sentence below" : "";
      r.status.className = `small ${id in taps ? (taps[id] === null ? "bad" : "ok") : "muted"}`;
    });
    const activeTap = taps[ids[active]];
    sentBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(activeTap === i)));
    done.disabled = ids.some((id) => !(id in taps));
  }
  draw();
  done.addEventListener("click", async () => {
    const scored = score(criteria, taps, a.local.checks);
    const points = improvementPoints(a.local.checks, scored, criteria);
    a.selfCheck = { met: scored.results.filter((r) => r.tapped).map((r) => r.id), notMet: scored.results.filter((r) => !r.tapped).map((r) => r.id) };
    a.local = { ...a.local, selfTaps: taps, scored, points, redraftInstruction: redraftInstruction(points), stage: "done" };
    await db.put("attempts", a);
    await enqueue("submit", contractView(a));
    window.dispatchEvent(new Event("dp27-progress"));
    location.hash = `#/attempt/${a.submissionId}/feedback`;
  });
  root.append(list, el("h2", {}, "Your answer"), answer, el("div", { class: "row", style: "margin-top:.8rem" }, done));
  return root;
}

async function feedbackView(root, a, found, criteria) {
  if (a.local.stage !== "done") { location.hash = `#/attempt/${a.submissionId}/selfcheck`; return root; }
  const s = a.local.scored;
  const nextMode = a.taskType;
  root.append(el("h1", {}, `Feedback · ${found.kind === "p1" ? P1_PARTS[a.taskType] : a.taskType} · Draft ${a.draft}`),
    el("div", { class: "card", "data-status": "" },
      el("p", { class: "score-big", "data-score": `${s.met}/${s.total}` }, `${s.met} of ${s.total} criteria met`),
      el("p", { class: "small muted" }, "Checklist score, not an IB mark."),
      el("ul", { class: "small" }, ...s.results.map((r) => el("li", { class: r.met ? "ok" : "bad" }, `${r.met ? "✓" : "✗"} ${r.label}`,
        !r.met && r.tapped && r.autoFailed.length ? el("span", { class: "muted" }, ` (the automatic check found a problem: ${r.autoFailed.map((x) => CHECK_NAMES[x] || x).join(", ")})`) : null)))));
  if (a.local.copy?.tooClose) {
    root.append(el("div", { class: "callout mis", "data-copyguard": "" }, el("strong", {}, "Use your own words. "),
      `Much of this answer matches the model (${Math.round(a.local.copy.overlap * 100)}% overlap), so this draft does not count towards completion.`));
  }
  if (a.draft > 1 && a.local.fixed?.length) {
    root.append(el("div", { class: "callout", "data-fixed": "" }, el("strong", {}, "You fixed: "), a.local.fixed.map((x) => CHECK_NAMES[x] || x).join(", ")));
  } else if (a.draft > 1) {
    root.append(el("div", { class: "callout" }, "No flagged problem from your last draft is fixed yet. Look at the first point below."));
  }
  root.append(el("h2", {}, "How to improve"), ...a.local.points.map((p) => el("div", { class: "point" },
    p.quote ? el("p", {}, el("q", {}, p.quote)) : null, el("p", {}, el("strong", {}, "Missing: "), p.missing), el("p", {}, el("strong", {}, "Do this: "), p.action))));
  root.append(el("div", { class: "callout", "data-redraft-instruction": "" }, el("strong", {}, "Redraft instruction: "), a.local.redraftInstruction));
  const teacher = await db.get("feedback", a.submissionId);
  if (teacher) {
    root.insertBefore(teacherCard(teacher), root.children[2] || null);
    if (!teacher.readAt) { teacher.readAt = new Date().toISOString(); await db.put("feedback", teacher, a.submissionId); updateInboxBadge(); }
  } else if (await syncEnabled()) {
    root.insertBefore(instantCard(a), root.children[2] || null);
  }
  if (a.timedSessionId) {
    root.append(el("div", { class: "callout", "data-timed-paper": "" },
      a.timedNext
        ? el("a", { class: "btn", id: "timed-next", href: `#/attempt/${a.timedNext}/selfcheck` }, "Next part of this timed paper →")
        : el("a", { class: "btn", id: "timed-finish", href: `#/timed/summary/${a.timedSessionId}` }, "Finish this timed paper →")));
  }
  root.append(el("div", { class: "row" },
    el("a", { class: "btn" + (a.timedSessionId ? " secondary" : ""), id: "redraft", href: `#/s/${a.sectionId}/task/${a.questionId}/${nextMode}/redraft/${a.submissionId}` },
      teacher ? "Redraft after teacher feedback" : "Redraft"),
    el("a", { class: "btn secondary", id: "see-model", href: `#/attempt/${a.submissionId}/model` }, "See the model"),
    el("a", { class: "btn secondary", href: `#/s/${a.sectionId}` }, "Try another question")));
  return root;
}

const INSTANT_ERRORS = {
  feedback_off: "Detailed feedback is not switched on yet. Your teacher's feedback will reach your inbox.",
  feedback_limit: "You have asked for a lot of feedback in the last hour. Try again later; feedback will also reach your inbox.",
  network: "This needs the internet. Connect, then try again.",
  not_signed_in: "Sign in from Settings first.",
  bad_credentials: "Sign in again from Settings first.",
};

function instantCard(a) {
  const msg = el("p", { class: "small", id: "instant-status", "aria-live": "polite" });
  const btn = el("button", { type: "button", id: "instant-feedback" }, "Get detailed feedback now");
  const card = el("section", { class: "card", "data-instant": "" },
    el("h2", { style: "margin-top:0" }, "Detailed feedback"),
    el("p", { class: "small muted" }, "A full comment on this answer: where it sits in the markbands and what to fix first. Needs the internet; usually under a minute."),
    el("div", { class: "row" }, btn), msg);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    msg.className = "small";
    msg.textContent = "Writing your feedback. Keep this page open…";
    try {
      const fb = await requestInstantFeedback(contractView(a));
      if (fb) card.replaceWith(teacherCard(fb));
      else msg.textContent = "Your teacher is looking at this answer first. The feedback will reach your inbox.";
    } catch (e) {
      msg.className = "small bad";
      msg.textContent = INSTANT_ERRORS[e.message] || "The feedback could not be written just now. Try again in a few minutes; it will also reach your inbox.";
      btn.disabled = false;
    }
  });
  return card;
}

async function modelView(root, a, found) {
  if (a.local.stage !== "done") { toast("Finish the self-check first."); location.hash = `#/attempt/${a.submissionId}/selfcheck`; return root; }
  const bands = await content.markbands();
  root.append(el("h1", {}, "Model"), el("p", { class: "muted" }, "Compare the model with your draft. Then redraft in your own words: copying the model does not count."));
  if (found.kind === "p1") root.append(el("details", {}, el("summary", {}, "Show the sources"), await sourcesBlock(found.set)));
  root.append(el("div", { class: "card" }, el("p", { style: "font-weight:600" }, found.q.text)), modelBlock(found));
  const key = found.kind === "p1" ? a.taskType.replace(/^p1q1[ab]$/, "p1q1") : "essay";
  const b = bands.bands[key];
  if (b) {
    root.append(el("h2", {}, "Markband"), el("p", { class: "small muted" }, bands.label),
      el("div", { class: "table-wrap" }, el("table", { class: "grid-table" }, el("tbody", {},
        ...b.rows.map((r) => el("tr", {}, el("th", { scope: "row" }, r.marks), el("td", {}, r.descriptor)))))),
      b.note ? el("p", { class: "small" }, b.note) : null);
  }
  root.append(el("div", { class: "row" },
    el("a", { class: "btn", href: `#/s/${a.sectionId}/task/${a.questionId}/${a.taskType}/redraft/${a.submissionId}` }, "Redraft"),
    el("a", { class: "btn secondary", href: `#/attempt/${a.submissionId}/feedback` }, "Back to feedback")));
  return root;
}
