import { el, pct } from "../util.js";
import { content } from "../content.js";
import { recordItem, PASS, sectionProgress } from "../progress.js";
import { renderItem } from "../items/index.js";
import { renderCheckpoint } from "./reader.js";

export async function itemSet(id, which) {
  const rec = await content.record(id);
  const section = await content.section(id);
  const root = el("div", {});
  root.append(el("p", { class: "small" }, el("a", { href: `#/s/${id}` }, `← ${rec.title}`)));

  if (which.startsWith("checkpoint-")) {
    const chunk = section.context.chunks.find((c) => c.chunkId === which.slice(11));
    if (!chunk) throw new Error("Unknown checkpoint");
    const wrap = el("div", {});
    root.append(wrap);
    renderCheckpoint(wrap, chunk, () => wrap.append(el("div", { class: "row" },
      el("a", { class: "btn", href: `#/s/${id}` }, "Back to the section"),
      el("a", { class: "btn secondary", href: `#/s/${id}/items/${which}`, onclick: () => setTimeout(() => location.reload(), 0) }, "Retake"))));
    return root;
  }

  const p = await sectionProgress(rec, section);
  if (!p.unlocked) {
    root.append(el("p", { class: "warn", "data-locked": "true" }, "Practice is locked until you have read every chunk and scored at least 80% across the checkpoints."));
    return root;
  }
  const items = which === "drills" ? section.drills : section.retrieval;
  const title = which === "drills" ? "Skill drills" : "Retrieval practice";
  const scores = {};
  const summary = el("div", { class: "card", hidden: true, "aria-live": "polite" });
  root.append(el("h1", {}, title),
    el("p", { class: "muted" }, which === "drills"
      ? `Your best result on each drill counts. You need ${pct(PASS)} across all drills.`
      : "Answer from memory first. Every wrong answer comes with an explanation."));
  items.forEach((it, i) => root.append(renderItem(it, { index: i + 1, total: items.length, onScored: async (score, response) => {
    scores[it.itemId] = score;
    await recordItem(it.itemId, score, response);
    if (Object.keys(scores).length === items.length) {
      const s = Object.values(scores).reduce((a, b) => a + b, 0) / items.length;
      const fresh = await sectionProgress(rec, section);
      const best = which === "drills" ? fresh.drills : fresh.retrieval;
      summary.hidden = false;
      summary.replaceChildren(el("p", { class: "score-big" }, `This attempt: ${pct(s)}`),
        el("p", {}, `Best so far: ${pct(best)}${which === "drills" ? (best >= PASS ? " · target reached" : ` · target ${pct(PASS)}`) : ""}`),
        el("div", { class: "row" }, el("a", { class: "btn", href: `#/s/${id}` }, "Back to the section"),
          el("button", { type: "button", class: "secondary", onclick: () => location.reload() }, "Try again")));
    }
  } })));
  root.append(summary);
  return root;
}
