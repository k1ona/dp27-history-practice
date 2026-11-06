import { el, fmtDate } from "../util.js";
import { db } from "../db.js";
import { content } from "../content.js";
import { fetchFeedback, syncEnabled, updateInboxBadge } from "../sync.js";

/** The "Teacher feedback" inbox: released feedback, linked to the original attempt. */
export async function inbox() {
  if (navigator.onLine && (await syncEnabled())) await fetchFeedback();
  const items = (await db.all("feedback")).sort((a, b) => String(b.writtenAt || b.receivedAt).localeCompare(String(a.writtenAt || a.receivedAt)));
  const map = await content.map();
  const title = (id) => map.sections.find((s) => s.sectionId === id)?.title || id;
  const root = el("div", {}, el("h1", {}, "Teacher feedback"));
  if (!(await syncEnabled())) {
    root.append(el("p", { class: "muted" }, "Feedback from your teacher will appear here once your class is connected."));
    return root;
  }
  if (!items.length) {
    root.append(el("p", { class: "muted" }, "No feedback yet. When your teacher releases feedback on your work, it appears here the next time you are online."));
    return root;
  }
  for (const fb of items) {
    const attempt = await db.get("attempts", fb.submissionId);
    const what = attempt ? `${title(attempt.sectionId)} · ${attempt.taskType} · Draft ${attempt.draft}` : "Work from another device";
    root.append(el("div", { class: "card", "data-inbox-item": fb.submissionId },
      el("div", { class: "row" }, el("strong", {}, what), el("span", { class: "spacer" }), fb.readAt ? null : el("span", { class: "badge coming" }, "New")),
      el("p", { class: "small muted" }, fb.writtenAt ? `Written ${fmtDate(fb.writtenAt)}` : ""),
      fb.placement ? el("p", {}, el("strong", {}, "Placement: "), placementText(fb.placement)) : null,
      el("p", {}, el("strong", {}, "Redraft instruction: "), fb.redraftInstruction || ""),
      attempt ? el("a", { class: "btn", href: `#/attempt/${fb.submissionId}/feedback` }, "Open") : teacherCard(fb)));
  }
  updateInboxBadge();
  return root;
}

export function placementText(p) {
  if (!p) return "";
  return p.type === "mark" ? `${p.value} out of ${p.outOf}` : String(p.value);
}

/** The teacher's feedback, in the same shape as the written feedback the teacher gives in class. */
export function teacherCard(fb) {
  return el("section", { class: "card", "data-teacher-feedback": fb.submissionId, style: "border-left: 4px solid var(--accent-2)" },
    el("h2", { style: "margin-top:0" }, "Teacher feedback"),
    fb.placement ? el("p", {}, el("strong", {}, "Placement: "), placementText(fb.placement)) : null,
    fb.improved ? el("p", {}, el("strong", {}, "What improved: "), fb.improved) : null,
    ...(fb.points || []).map((p) => el("div", { class: "point" },
      p.quote ? el("p", {}, el("q", {}, p.quote)) : null,
      p.missing ? el("p", {}, el("strong", {}, "Missing: "), p.missing) : null,
      p.action ? el("p", {}, el("strong", {}, "Do this: "), p.action) : null)),
    fb.redraftInstruction ? el("div", { class: "callout" }, el("strong", {}, "Redraft instruction: "), fb.redraftInstruction) : null,
    fb.forwardTarget ? el("p", {}, el("strong", {}, "Next target: "), fb.forwardTarget) : null);
}
