import { el, pct } from "../util.js";
import { db } from "../db.js";
import { content } from "../content.js";
import { sectionProgress } from "../progress.js";
import { syncEnabled } from "../sync.js";

export function visibleForLevel(record, level) {
  return level === "SL" ? record.papers.some((p) => p !== "P3") : true;
}

export function statusBadge(record, available) {
  if (record.status === "coming_up") return el("span", { class: "badge coming" }, "Coming up in class");
  if (!available) return el("span", { class: "badge prep" }, "In preparation");
  return null;
}

export async function dashboard() {
  const profile = (await db.get("profile", "me")) || { level: "HL" };
  const map = await content.map();
  const avail = new Set((await content.available()).sections);
  const root = el("div", {});
  if ((await syncEnabled()) && (!profile.token || profile.needsSignIn)) {
    root.append(el("div", { class: "callout", "data-signin-needed": "" }, "Your work is saved on this device but cannot reach your teacher yet. ",
      el("a", { href: "#/setup" }, "Sign in"), " while you are online."));
  }
  root.append(el("h1", {}, "Your sections"),
    el("p", { class: "muted" }, `Level: ${profile.level}${profile.studentId ? ` · ${profile.studentId}` : ""}. Read the context, pass the checkpoints, then practise until each section is complete.`));

  for (const paper of map.papers) {
    if (!paper.levels.includes(profile.level)) continue;
    const recs = map.sections.filter((s) => s.papers[0] === paper.paper && visibleForLevel(s, profile.level));
    if (!recs.length) continue;
    const cards = [];
    let complete = 0, started = 0;
    for (const rec of recs) {
      const available = avail.has(rec.sectionId);
      const section = available ? await content.section(rec.sectionId).catch(() => null) : null;
      const p = await sectionProgress(rec, section);
      if (p.complete) complete++;
      if (p.available && (p.chunksRead || p.attempts.length)) started++;
      cards.push(sectionCard(rec, p, available));
    }
    root.append(el("section", { class: "paper", "data-paper": paper.paper },
      el("h2", {}, paper.title),
      el("p", { class: "small muted", "data-paper-progress": paper.paper }, `${complete} of ${recs.length} sections complete · ${started} started`),
      el("div", { class: "bar", role: "progressbar", "aria-valuenow": Math.round((complete / recs.length) * 100), "aria-valuemin": 0, "aria-valuemax": 100,
        "aria-label": `${paper.paper} completion` }, el("span", { style: `width:${(complete / recs.length) * 100}%` })),
      groupByTopic(recs, cards)));
  }
  return root;
}

function groupByTopic(recs, cards) {
  const wrap = el("div", {});
  let lastTopic = null, grid = null;
  recs.forEach((r, i) => {
    if (r.topic.code !== lastTopic) {
      lastTopic = r.topic.code;
      grid = el("div", { class: "grid" });
      wrap.append(el("h3", {}, r.topic.title.replace(/^P[123] · /, "")), grid);
    }
    grid.append(cards[i]);
  });
  return wrap;
}

function sectionCard(rec, p, available) {
  const badge = p.complete ? el("span", { class: "badge done" }, "Complete") : statusBadge(rec, available);
  const body = el("div", { class: "card", "data-section": rec.sectionId },
    el("div", { class: "row" }, el("strong", {}, rec.title), el("span", { class: "spacer" }), badge),
    el("div", { class: "small muted" }, `${rec.timeframe[0]}–${rec.timeframe[1]}`));
  if (p.available) {
    body.append(el("ul", { class: "progress-list" },
      el("li", {}, el("span", {}, "Context read"), el("span", {}, `${p.chunksRead}/${p.chunkTotal}`)),
      el("li", {}, el("span", {}, "Checkpoints"), el("span", { class: p.checkpoint >= 0.8 ? "ok" : "" }, pct(p.checkpoint))),
      el("li", {}, el("span", {}, "Skill drills"), el("span", { class: p.drills >= 0.8 ? "ok" : "" }, pct(p.drills))),
      el("li", {}, el("span", {}, "Written tasks"), el("span", {}, `${p.tasks.filter((t) => t.done).length}/${p.tasks.length}`))),
      el("a", { class: "btn", href: `#/s/${rec.sectionId}` }, "Open"));
  }
  return body;
}
