// Renderers and markers for every auto-marked item and drill type.
// Six interaction patterns cover all types: choice, multi, order, match, cloze, categorise (plus tap for point harvesting).
import { el, richText, shuffle, LABEL } from "../util.js";

const CHOICE = new Set(["mcq", "which_argument", "spot_error", "pick_thesis", "upgrade_sentence", "strongest_counter",
  "judgement_criterion", "p1_purpose", "p1_value_limitation", "in_timeframe"]);
const CATEGORISE = new Set(["decode", "narrative_or_analysis", "two_part_balance", "p1_pair_statements"]);

export const TYPE_NAMES = {
  mcq: "Multiple choice", multi_select: "Choose all that apply", chronology: "Put in order", match: "Match",
  cloze: "Fill the gap", which_argument: "Which argument does this fact support?", spot_error: "Spot the error",
  in_timeframe: "Inside or outside the timeframe?", decode: "Decode the question", pick_thesis: "Pick the thesis",
  narrative_or_analysis: "Narrative or analysis?", evidence_to_claim: "Evidence to claim", upgrade_sentence: "Upgrade this sentence",
  strongest_counter: "Strongest counter-argument", judgement_criterion: "Judgement with a criterion",
  two_part_balance: "Two-part balance", p1_point_harvest: "Point harvesting (Q1)", p1_purpose: "Purpose (audience + action + moment)",
  p1_value_limitation: "Value and limitation (Q2)", p1_pair_statements: "Pair the statements (Q3)",
};

const CATEGORY_LABELS = {
  verb: "Command term", factor: "Named factor / task", timeframe: "Timeframe", scope: "Scope / cases", judgement: "Judgement required",
  none: "Not part of the decode", narrative: "Narrative", analysis: "Analysis", causes: "Causes", effects: "Effects",
  successes: "Successes", failures: "Failures", point: "A distinct point", not_point: "Not a point",
};

function catLabel(item, id) {
  const c = (item.categories || []).find((x) => x.id === id);
  return c ? c.label : CATEGORY_LABELS[id] || id;
}

/** Render one item. Calls onScored(score 0..1, response) when the student checks it. */
export function renderItem(item, { index, total, onScored, showLabel = true } = {}) {
  const box = el("section", { class: "item", "data-item": item.itemId, "data-type": item.type, "aria-label": `Question ${index}` });
  box.append(el("div", { class: "qnum" }, `${index ? `Question ${index}${total ? ` of ${total}` : ""} · ` : ""}${TYPE_NAMES[item.type] || item.type}`));
  if (item.sourceText) box.append(el("blockquote", { class: "source-block extract" }, item.sourceText));
  box.append(el("div", { html: richText(item.prompt) }));
  if (item.type === "in_timeframe" && item.timeframe) box.append(el("p", { class: "small muted" }, `Question timeframe: ${item.timeframe[0]}–${item.timeframe[1]}`));
  const body = el("div", { class: "item-body" });
  box.append(body);
  const result = el("div", { class: "result", "aria-live": "polite" });
  const checkBtn = el("button", { type: "button", class: "check" }, "Check answer");
  let marker;
  if (CHOICE.has(item.type)) marker = choice(item, body);
  else if (item.type === "multi_select") marker = multi(item, body);
  else if (item.type === "chronology") marker = order(item, body);
  else if (item.type === "match" || item.type === "evidence_to_claim") marker = match(item, body);
  else if (item.type === "cloze") marker = cloze(item, body);
  else if (CATEGORISE.has(item.type)) marker = categorise(item, body);
  else if (item.type === "p1_point_harvest") marker = harvest(item, body);
  else body.append(el("p", { class: "bad" }, `Unsupported item type: ${item.type}`));
  checkBtn.addEventListener("click", () => {
    if (!marker) return;
    const { score, response, complete } = marker();
    if (!complete) { result.className = "result warn"; result.textContent = "Answer every part before checking."; return; }
    checkBtn.disabled = true;
    box.querySelectorAll("input, select, .order-list button, .toggle-seg").forEach((n) => (n.disabled = true));
    result.className = `result ${score >= 0.999 ? "ok" : score > 0 ? "warn" : "bad"}`;
    result.textContent = score >= 0.999 ? "Correct." : score > 0 ? `Partly correct (${Math.round(score * 100)}%).` : "Not correct.";
    if (item.explanation) result.append(el("p", { class: "small", style: "font-weight:400" }, item.explanation));
    box.dataset.score = String(score);
    onScored && onScored(score, response);
  });
  box.append(el("div", { class: "row" }, checkBtn), result);
  if (showLabel) box.append(el("p", { class: "label-constructed" }, LABEL));
  return box;
}

function choice(item, body) {
  const name = `opt-${item.itemId}`;
  const opts = shuffle(item.options, item.itemId);
  const rows = opts.map((o) => {
    const input = el("input", { type: "radio", name, value: o.id, id: `${name}-${o.id}` });
    const row = el("div", { class: "opt" }, input, el("label", { for: `${name}-${o.id}` }, o.text));
    const expl = el("div", { class: "expl", hidden: true }, o.explanation);
    body.append(row, expl);
    return { o, input, row, expl };
  });
  return () => {
    const chosen = rows.find((r) => r.input.checked);
    if (!chosen) return { complete: false };
    for (const r of rows) {
      if (r.o.correct) r.row.classList.add("correct");
      if (r === chosen && !r.o.correct) r.row.classList.add("wrong");
      if (r === chosen || r.o.correct) r.expl.hidden = false;
    }
    // Show every distractor's explanation too: each wrong option says why it is weaker.
    rows.forEach((r) => (r.expl.hidden = false));
    return { complete: true, score: chosen.o.correct ? 1 : 0, response: chosen.o.id };
  };
}

function multi(item, body) {
  const opts = shuffle(item.options, item.itemId);
  const rows = opts.map((o) => {
    const id = `ms-${item.itemId}-${o.id}`;
    const input = el("input", { type: "checkbox", value: o.id, id });
    const row = el("div", { class: "opt" }, input, el("label", { for: id }, o.text));
    const expl = el("div", { class: "expl", hidden: true }, o.explanation);
    body.append(row, expl);
    return { o, input, row, expl };
  });
  return () => {
    if (!rows.some((r) => r.input.checked)) return { complete: false };
    let right = 0;
    for (const r of rows) {
      const ok = r.input.checked === r.o.correct;
      if (ok) right++;
      r.row.classList.add(ok ? "correct" : "wrong");
      r.expl.hidden = false;
    }
    return { complete: true, score: right / rows.length, response: rows.filter((r) => r.input.checked).map((r) => r.o.id) };
  };
}

function order(item, body) {
  const correct = item.sequence.slice().sort((a, b) => a.year - b.year || (a.month || 0) - (b.month || 0));
  let current = shuffle(item.sequence, item.itemId);
  if (current.every((x, i) => x.id === correct[i].id) && current.length > 1) current = current.slice().reverse();
  const list = el("ol", { class: "order-list" });
  const draw = () => {
    list.replaceChildren(...current.map((x, i) => el("li", { "data-id": x.id },
      el("span", {}, x.text),
      el("button", { type: "button", class: "secondary", "aria-label": `Move "${x.text}" up`, disabled: i === 0 || null,
        onclick: () => { [current[i - 1], current[i]] = [current[i], current[i - 1]]; draw(); list.children[i - 1]?.querySelector("button")?.focus(); } }, "↑"),
      el("button", { type: "button", class: "secondary", "aria-label": `Move "${x.text}" down`, disabled: i === current.length - 1 || null,
        onclick: () => { [current[i + 1], current[i]] = [current[i], current[i + 1]]; draw(); list.children[i + 1]?.querySelectorAll("button")[1]?.focus(); } }, "↓"))));
  };
  draw();
  body.append(el("p", { class: "small muted" }, "Earliest at the top. Use the arrow buttons to move an event."), list);
  return () => {
    let right = 0;
    [...list.children].forEach((li, i) => {
      const ok = current[i].id === correct[i].id;
      if (ok) right++;
      li.style.borderColor = ok ? "var(--ok)" : "var(--bad)";
      li.querySelector("span").textContent = `${current[i].text} — ${current[i].year}`;
    });
    if (right < current.length) body.append(el("p", { class: "small" }, "Correct order: " + correct.map((x) => `${x.text} (${x.year})`).join(" → ")));
    return { complete: true, score: right / current.length, response: current.map((x) => x.id) };
  };
}

function match(item, body) {
  const rights = shuffle(item.pairs.map((p) => p.right), item.itemId);
  const rows = item.pairs.map((p, i) => {
    const sel = el("select", { "aria-label": `Match for: ${p.left}` }, el("option", { value: "" }, "Choose…"),
      ...rights.map((r) => el("option", { value: r }, r)));
    const row = el("div", { class: "seg-row" }, el("div", {}, p.left), sel);
    const expl = el("div", { class: "expl", hidden: true, style: "margin-left:0" }, p.explanation);
    body.append(row, expl);
    return { p, sel, row, expl, i };
  });
  return () => {
    if (rows.some((r) => !r.sel.value)) return { complete: false };
    let right = 0;
    for (const r of rows) {
      const ok = r.sel.value === r.p.right;
      if (ok) right++;
      r.row.classList.add(ok ? "correct" : "wrong");
      r.expl.hidden = false;
      if (!ok) r.expl.textContent = `Answer: ${r.p.right}. ${r.p.explanation}`;
    }
    return { complete: true, score: right / rows.length, response: rows.map((r) => r.sel.value) };
  };
}

export function normalise(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.]+/g, " ").trim();
}

export function clozeCorrect(blank, value) {
  const v = String(value).trim();
  if (typeof blank.answer === "number") {
    const n = Number(v.replace(/[, ]/g, ""));
    return Number.isFinite(n) && Math.abs(n - blank.answer) <= (blank.tolerance || 0);
  }
  const accepted = [blank.answer, ...(blank.accept || [])].map(normalise);
  return accepted.includes(normalise(v));
}

function cloze(item, body) {
  const inputs = item.blanks.map((b) => {
    const input = el("input", { type: "text", "aria-label": `Answer for gap ${b.id}`, autocomplete: "off", inputmode: typeof b.answer === "number" ? "numeric" : null });
    const expl = el("div", { class: "expl", hidden: true, style: "margin-left:0" }, b.explanation);
    body.append(el("label", { class: "small" }, `Gap ${b.id}`, input), expl);
    return { b, input, expl };
  });
  return () => {
    if (inputs.some((x) => !x.input.value.trim())) return { complete: false };
    let right = 0;
    for (const x of inputs) {
      const ok = clozeCorrect(x.b, x.input.value);
      if (ok) right++;
      x.input.style.borderColor = ok ? "var(--ok)" : "var(--bad)";
      x.expl.hidden = false;
      if (!ok) x.expl.textContent = `Answer: ${x.b.answer}. ${x.b.explanation}`;
    }
    return { complete: true, score: right / inputs.length, response: inputs.map((x) => x.input.value) };
  };
}

function categorise(item, body) {
  const ids = item.categories ? item.categories.map((c) => c.id) : [...new Set(item.segments.map((s) => s.answer))];
  if (item.type === "decode" && !ids.includes("none")) ids.push("none");
  const rows = item.segments.map((s) => {
    const sel = el("select", { "aria-label": `Category for: ${s.text}` }, el("option", { value: "" }, "Choose…"),
      ...ids.map((id) => el("option", { value: id }, catLabel(item, id))));
    const row = el("div", { class: "seg-row" }, el("div", {}, s.text), sel);
    const expl = el("div", { class: "expl", hidden: true, style: "margin-left:0" }, s.explanation);
    body.append(row, expl);
    return { s, sel, row, expl };
  });
  return () => {
    if (rows.some((r) => !r.sel.value)) return { complete: false };
    let right = 0;
    for (const r of rows) {
      const ok = r.sel.value === r.s.answer;
      if (ok) right++;
      r.row.classList.add(ok ? "correct" : "wrong");
      r.expl.hidden = false;
      if (!ok) r.expl.textContent = `Answer: ${catLabel(item, r.s.answer)}. ${r.s.explanation}`;
    }
    return { complete: true, score: right / rows.length, response: rows.map((r) => r.sel.value) };
  };
}

function harvest(item, body) {
  body.append(el("p", { class: "small muted" }, "Tap every part of the source that gives a distinct point. Tap again to undo."));
  const wrap = el("p", { class: "answer-text" });
  const btns = item.segments.map((s) => {
    const b = el("button", { type: "button", class: "toggle-seg", "aria-pressed": "false",
      onclick: () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true") }, s.text);
    wrap.append(b, " ");
    return { s, b };
  });
  body.append(wrap);
  const expl = el("ul", { class: "small", hidden: true });
  body.append(expl);
  return () => {
    let right = 0;
    for (const x of btns) {
      const picked = x.b.getAttribute("aria-pressed") === "true";
      const ok = picked === (x.s.answer === "point");
      if (ok) right++;
      x.b.classList.add(ok ? "correct" : "wrong");
      expl.append(el("li", {}, `“${x.s.text}”: ${x.s.explanation}`));
    }
    expl.hidden = false;
    return { complete: true, score: right / btns.length, response: btns.filter((x) => x.b.getAttribute("aria-pressed") === "true").map((x) => x.s.id) };
  };
}
