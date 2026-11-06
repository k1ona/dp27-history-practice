// Diagrams drawn from verified section data. Always labelled "Diagram", never presented as historical sources.
import { el, svgEl } from "./util.js";
import { content } from "./content.js";

function wrapText(text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) { if (line) lines.push(line); line = w; }
    else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateLabel(e) {
  return [e.day, e.month ? MONTHS[e.month - 1] : null, e.year].filter(Boolean).join(" ");
}

/** Interactive timeline: focus or tap a dot to read the event. */
export function timeline(tl, timeframe, title = "Timeline") {
  const events = tl.events.slice().sort((a, b) => a.year - b.year || (a.month || 0) - (b.month || 0));
  const [y0, y1] = timeframe;
  const W = 900, H = 150, pad = 40;
  const x = (e) => pad + ((e.year - y0 + ((e.month || 6) - 0.5) / 12) / (y1 - y0 + 1)) * (W - 2 * pad);
  const detail = el("p", { class: "tl-detail", "aria-live": "polite" }, "Select a point to read the event.");
  const svg = svgEl("svg", { class: "diagram", viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": `${title}, ${y0} to ${y1}` });
  svg.append(svgEl("line", { class: "axis", x1: pad, y1: 70, x2: W - pad, y2: 70 }));
  for (let y = y0; y <= y1 + 1; y++) {
    const xx = pad + ((y - y0) / (y1 - y0 + 1)) * (W - 2 * pad);
    svg.append(svgEl("line", { class: "axis", x1: xx, y1: 64, x2: xx, y2: 76 }));
    if (y <= y1) svg.append(svgEl("text", { x: xx + ((W - 2 * pad) / (y1 - y0 + 1)) / 2, y: 100, "text-anchor": "middle", "font-size": 15 }, String(y)));
  }
  const list = el("ol", { class: "small", style: "margin-top:.4rem" });
  events.forEach((e, i) => {
    const label = `${dateLabel(e)}: ${e.text}`;
    const dot = svgEl("circle", { class: "dot", cx: x(e), cy: 70 - (i % 2 ? 14 : 0), r: 9, tabindex: 0, role: "button", "aria-label": label });
    const show = () => { detail.textContent = label; };
    dot.addEventListener("click", show);
    dot.addEventListener("focus", show);
    dot.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); show(); } });
    svg.append(dot);
    list.append(el("li", {}, el("strong", {}, dateLabel(e)), " ", e.text));
  });
  return el("figure", { class: "card" }, el("div", { class: "diagram-label" }, `Diagram · ${title}`), svg, detail,
    el("details", {}, el("summary", {}, "All events as a list"), list),
    el("figcaption", {}, `Diagram drawn from the section's verified evidence, ${y0}–${y1}. Not a historical source.`));
}

/** Causal chain: boxes joined by arrows, each arrow labelled with its "because". */
export function causalChain(cc) {
  const W = 900, boxH = 64, gap = 54, boxW = 560, left = (W - boxW) / 2;
  const ids = cc.nodes.map((n) => n.id);
  const H = ids.length * boxH + (ids.length - 1) * gap + 20;
  const svg = svgEl("svg", { class: "diagram", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Causal chain diagram" });
  svg.append(svgEl("defs", {}, svgEl("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto" },
    svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: "currentColor" }))));
  const pos = {};
  cc.nodes.forEach((n, i) => {
    const y = 10 + i * (boxH + gap);
    pos[n.id] = y;
    const g = svgEl("g", { class: "node" });
    g.append(svgEl("rect", { x: left, y, width: boxW, height: boxH, rx: 10 }));
    const lines = wrapText(n.text, 58).slice(0, 3);
    lines.forEach((ln, j) => g.append(svgEl("text", { x: W / 2, y: y + boxH / 2 + (j - (lines.length - 1) / 2) * 19 + 6, "text-anchor": "middle", "font-size": 16 }, ln)));
    svg.append(g);
  });
  for (const l of cc.links) {
    if (!(l.from in pos) || !(l.to in pos)) continue;
    const y1 = pos[l.from] + boxH, y2 = pos[l.to];
    const down = y2 > y1;
    svg.append(svgEl("path", { class: "edge", d: down ? `M${W / 2},${y1} L${W / 2},${y2}` : `M${left},${pos[l.from] + boxH / 2} C${left - 80},${pos[l.from]} ${left - 80},${y2 + boxH} ${left},${y2 + boxH / 2}`,
      "marker-end": "url(#arrow)", style: "color: var(--muted)" }));
    const ly = down ? (y1 + y2) / 2 + 5 : (pos[l.from] + y2) / 2;
    wrapText(`because ${l.because}`, 34).slice(0, 2).forEach((ln, j) =>
      svg.append(svgEl("text", { x: W / 2 + boxW / 2 + 12, y: ly + j * 17 - 8, "font-size": 14, "font-style": "italic" }, ln)));
  }
  const text = el("ol", { class: "small" }, ...cc.links.map((l) => {
    const a = cc.nodes.find((n) => n.id === l.from), b = cc.nodes.find((n) => n.id === l.to);
    return el("li", {}, `${a?.text} → ${b?.text}, because ${l.because}`);
  }));
  return el("figure", { class: "card" }, el("div", { class: "diagram-label" }, "Diagram · Causal chain"), svg,
    el("details", {}, el("summary", {}, "Read the chain as text"), text),
    el("figcaption", {}, "Diagram built from the section's verified evidence. Not a historical source."));
}

export function comparisonGrid(g) {
  return el("figure", { class: "card" }, el("div", { class: "diagram-label" }, "Diagram · Comparison grid"),
    el("div", { class: "table-wrap" }, el("table", { class: "grid-table" },
      el("thead", {}, el("tr", {}, el("th", {}, ""), ...g.columns.map((c) => el("th", { scope: "col" }, c)))),
      el("tbody", {}, ...g.rows.map((r) => el("tr", {}, el("th", { scope: "row" }, r.criterion), ...r.cells.map((c) => el("td", {}, c))))))),
    el("figcaption", {}, "Diagram built from the section's verified evidence. Not a historical source."));
}

export function actorCards(cards) {
  return el("div", { class: "actor-cards" }, ...cards.map((a) => el("div", { class: "actor" },
    el("h4", {}, a.name), el("div", { class: "role" }, a.role), el("p", { class: "small" }, a.whyItMatters))));
}

/** An archival image or a drawn diagram file, always with its credit line. */
export async function mediaFigure(mediaId, { compact = false } = {}) {
  const m = await content.media(mediaId);
  if (!m) return el("p", { class: "bad small" }, `Missing media ${mediaId}`);
  const img = el("img", { src: m.file, alt: m.altText || m.title, loading: "lazy", decoding: "async" });
  if (compact) {
    // Paper 1 source sheets: keep the candidate-facing provenance clean; the credit stays one tap away.
    return el("figure", { "data-media": mediaId }, img,
      el("details", { class: "small muted" }, el("summary", {}, "Image credit"), m.creditLine, m.licence ? ` · ${m.licence.name}` : ""));
  }
  const cap = m.kind === "archival"
    ? el("figcaption", {}, el("strong", {}, m.title), ". ", m.creditLine, m.licence ? ` · ${m.licence.name}` : "")
    : el("figcaption", {}, el("span", { class: "diagram-label" }, m.kind === "schematic diagram" ? "Schematic diagram" : "Diagram"), " ", m.title, ". ", m.creditLine);
  return el("figure", { "data-media": mediaId }, img, cap);
}
