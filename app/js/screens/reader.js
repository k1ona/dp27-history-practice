import { el, richText, pct, toast } from "../util.js";
import { db } from "../db.js";
import { content } from "../content.js";
import { recordItem, PASS, sectionProgress } from "../progress.js";
import { renderItem } from "../items/index.js";
import { timeline, causalChain, comparisonGrid, actorCards, mediaFigure, dateLabel } from "../diagrams.js";

const ANGLES = { causes: "Causes", nature_methods: "Nature and methods", impact_consequences: "Impact and consequences", success_failure: "Success and failure",
  role_of_leader: "Role of a leader", named_factor: "A named factor", comparison: "Comparison" };

async function getReading(id) {
  return (await db.get("reading", id)) || { chunksRead: [], prediction: "", revisit: "" };
}
async function saveReading(id, r) { await db.put("reading", r, id); window.dispatchEvent(new Event("dp27-progress")); }

export async function reader(id, step) {
  const rec = await content.record(id);
  const section = await content.section(id);
  const ctx = section.context;
  const n = ctx.chunks.length;
  const last = n + 2;
  const reading = await getReading(id);
  const root = el("div", { class: "reader" });
  const nav = (s, label, cls = "btn") => el("a", { class: cls, href: `#/s/${id}/read/${s}` }, label);
  root.append(el("p", { class: "small" }, el("a", { href: `#/s/${id}` }, `← ${rec.title}`), ` · Step ${step + 1} of ${last + 1}`));

  if (step === 0) {
    const ta = el("textarea", { id: "prediction", rows: 3, style: "min-height:5rem", "aria-label": "Your one-line prediction" }, reading.prediction || "");
    const go = el("button", { type: "button", id: "save-prediction" }, "Save my prediction and start");
    go.addEventListener("click", async () => {
      if (!ta.value.trim()) { toast("Write a one-line prediction first."); ta.focus(); return; }
      reading.prediction = ta.value.trim();
      await saveReading(id, reading);
      location.hash = `#/s/${id}/read/1`;
    });
    root.append(el("h1", {}, "The problem"), el("div", { class: "callout problem prose", html: richText(ctx.openingProblem.problem) }),
      el("label", { for: "prediction" }, el("strong", {}, ctx.openingProblem.predictionPrompt)), ta, el("div", { class: "row", style: "margin-top:.6rem" }, go));
    return root;
  }
  if (!reading.prediction) { location.hash = `#/s/${id}/read/0`; return root; }

  if (step === 1) {
    root.append(el("h1", {}, "The shape of the topic"),
      el("p", { class: "muted" }, "Look at the chronology and the people first. You will meet each of them again in the chunks."),
      timeline(ctx.visuals.timeline, rec.timeframe), el("h2", {}, "Who matters, and why"), actorCards(ctx.visuals.actorCards));
    for (const m of ctx.visuals.archival || []) root.append(await mediaFigure(m));
    root.append(el("div", { class: "row" }, nav(2, `Chunk 1 of ${n}`)));
    return root;
  }

  if (step >= 2 && step < 2 + n) {
    const k = step - 2;
    const chunk = ctx.chunks[k];
    const text = el("article", { class: "chunk" },
      el("p", { class: "small muted" }, `Chunk ${k + 1} of ${n} · ${ANGLES[chunk.angle] || chunk.angle}`),
      el("h1", {}, chunk.title),
      el("div", { class: "prose", html: richText(chunk.body) }));
    for (const m of chunk.media || []) text.append(await mediaFigure(m));
    text.append(
      el("h2", {}, "Arguments that work"),
      ...chunk.argumentsThatWork.map((a) => {
        const facts = a.evidence.map((fid) => ctx.evidenceBank.find((f) => f.factId === fid)).filter(Boolean);
        return el("div", { class: "card" }, el("p", {}, el("strong", {}, a.claim)),
          facts.length ? el("ul", { class: "small" }, ...facts.map((f) => el("li", {}, f.text))) : null,
          el("p", { class: "small" }, el("strong", {}, "Strongest counter: "), a.strongestCounter));
      }),
      el("h2", {}, "How it gets asked"),
      el("ul", {}, ...chunk.howItGetsAsked.map((s) => el("li", {}, s))),
      el("p", { class: "label-constructed" }, "Example stems are teacher-constructed practice material. Not an IB publication."),
      el("h2", {}, "Use it in an essay"),
      el("div", { class: "card" }, ...["claim", "prove", "explain", "test", "judge"].map((part) =>
        el("p", {}, el("span", { class: "badge" }, part.toUpperCase()), " ", chunk.useItInAnEssay[part]))));
    const cpWrap = el("div", { class: "checkpoint", hidden: true });
    const startBtn = el("button", { type: "button", id: "start-checkpoint" }, "I have read this · take the checkpoint");
    startBtn.addEventListener("click", async () => {
      const r = await getReading(id);
      if (!r.chunksRead.includes(chunk.chunkId)) r.chunksRead.push(chunk.chunkId);
      await saveReading(id, r);
      text.hidden = true; startBtn.hidden = true; cpWrap.hidden = false;
      cpWrap.querySelector("h2")?.focus();
    });
    root.append(text, el("div", { class: "row" }, startBtn), cpWrap);
    renderCheckpoint(cpWrap, chunk, () => {
      cpWrap.append(el("div", { class: "row", style: "margin-top:1rem" },
        el("button", { type: "button", class: "secondary", onclick: () => { text.hidden = false; text.scrollIntoView(); } }, "Show the text again"),
        nav(step + 1, k + 1 < n ? `Next: chunk ${k + 2}` : "Finish the context builder")));
    });
    return root;
  }

  // Wrap-up
  const p = await sectionProgress(rec, section);
  root.append(el("h1", {}, "Pulling it together"), causalChain(ctx.visuals.causalChain));
  if (ctx.visuals.comparisonGrid) root.append(comparisonGrid(ctx.visuals.comparisonGrid));
  root.append(el("h2", {}, "Evidence bank"), evidenceBank(ctx, await content.map(), rec));
  if (ctx.historiography && ctx.historiography.length) {
    root.append(el("h2", {}, "Historians' debate"), ...ctx.historiography.map((h) => el("div", { class: "card" },
      el("p", {}, el("strong", {}, h.historian), ": ", h.argument), el("p", { class: "small" }, el("strong", {}, "Use it like this: "), h.useItLikeThis))));
  }
  root.append(el("h2", {}, "Misconceptions"), ...ctx.misconceptions.map((m) => el("div", { class: "callout mis" },
    el("p", {}, el("strong", {}, "Wrong: "), m.wrong), el("div", { html: richText(m.right) }))));
  const ta = el("textarea", { id: "revisit", rows: 3, style: "min-height:5rem" }, reading.revisit || "");
  const save = el("button", { type: "button" }, "Save");
  save.addEventListener("click", async () => { const r = await getReading(id); r.revisit = ta.value.trim(); await saveReading(id, r); toast("Saved."); });
  root.append(el("h2", {}, "Back to your prediction"), el("div", { class: "callout" }, el("p", {}, el("strong", {}, "You predicted: "), reading.prediction)),
    el("label", { for: "revisit" }, ctx.openingProblem.revisitPrompt), ta, el("div", { class: "row", style: "margin-top:.5rem" }, save),
    el("div", { class: "card" }, el("p", {}, `Checkpoints: ${pct(p.checkpoint)} (need ${pct(PASS)}). Chunks read: ${p.chunksRead}/${p.chunkTotal}.`),
      p.unlocked ? el("p", { class: "ok" }, "Practice is unlocked.") : el("p", { class: "warn" }, "Retake any checkpoint below 80% from the section page to unlock practice."),
      el("div", { class: "row" }, el("a", { class: "btn", href: `#/s/${id}` }, "Go to the section page"), el("a", { class: "btn secondary", href: `#/s/${id}/recall` }, "Recall sheet"))));
  return root;
}

export function renderCheckpoint(wrap, chunk, onDone) {
  const items = chunk.checkpoint;
  const scores = {};
  const summary = el("p", { class: "score-big", "aria-live": "polite" });
  wrap.append(el("h2", { tabindex: -1 }, `Checkpoint · ${chunk.title}`), el("p", { class: "muted" }, "Answer from memory. The text is hidden until you finish."));
  items.forEach((it, i) => wrap.append(renderItem(it, { index: i + 1, total: items.length, onScored: async (score, response) => {
    scores[it.itemId] = score;
    await recordItem(it.itemId, score, response);
    if (Object.keys(scores).length === items.length) {
      const s = Object.values(scores).reduce((a, b) => a + b, 0) / items.length;
      summary.textContent = `Checkpoint score: ${pct(s)}`;
      summary.className = `score-big ${s >= PASS ? "ok" : "warn"}`;
      onDone && onDone(s);
    }
  } })));
  wrap.append(summary);
}

function evidenceBank(ctx, map, rec) {
  const title = (sid) => map.sections.find((s) => s.sectionId === sid)?.title || sid;
  return el("div", {}, ...ctx.evidenceBank.map((f) => el("div", { class: "card", "data-fact": f.factId },
    el("p", { style: "margin:0" }, f.text),
    el("p", { class: "small" }, "→ supports: ", f.supports.join("; ")),
    f.alsoWorksFor && f.alsoWorksFor.length ? el("p", { class: "small muted" }, "This evidence also works for: ",
      ...f.alsoWorksFor.map((s, i) => [i ? ", " : "", el("a", { href: `#/s/${s}` }, title(s))])) : null)));
}

export async function recallSheet(id) {
  const rec = await content.record(id);
  const section = await content.section(id);
  const ctx = section.context;
  const root = el("div", { class: "recall" });
  root.append(el("p", { class: "small no-print" }, el("a", { href: `#/s/${id}` }, `← ${rec.title}`)),
    el("h1", {}, `Recall sheet · ${rec.title}`),
    el("p", { class: "small muted" }, `${rec.topic.title} · ${rec.timeframe[0]}–${rec.timeframe[1]}`),
    el("div", { class: "row no-print" }, el("button", { type: "button", onclick: () => window.print() }, "Print")),
    el("div", { class: "two-col" },
      el("div", {}, el("h2", {}, "Chronology"), el("ul", { class: "small" }, ...ctx.recallSheet.chronology.map((c) => el("li", {}, el("strong", {}, dateLabel(c)), " ", c.text)))),
      el("div", {}, el("h2", {}, "Key arguments"), el("ol", { class: "small" }, ...ctx.recallSheet.keyArguments.map((a) => el("li", {}, a))))),
    el("h2", {}, "Evidence bank"), el("ul", { class: "small" }, ...ctx.evidenceBank.map((f) => el("li", {}, f.text, el("span", { class: "muted" }, ` → ${f.supports.join("; ")}`)))));
  return root;
}
