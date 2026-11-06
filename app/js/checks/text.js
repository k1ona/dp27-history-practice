// Deterministic text utilities for the automatic checks.

const ABBREV = ["c", "ca", "e.g", "i.e", "etc", "cf", "vs", "dr", "mr", "mrs", "ms", "st", "no", "vol", "pp", "p", "u.s", "u.k", "u.s.s.r", "jr", "sr", "gen", "col", "lt", "approx"];

/** Split text into sentences, keeping offsets. */
export function sentences(text) {
  const out = [];
  const src = (text || "").replace(/\r\n/g, "\n");
  let start = 0;
  const re = /([.!?]+)(["'”’)\]]*)(\s+|$)|\n\s*\n/g;
  let m;
  while ((m = re.exec(src))) {
    const end = m.index + (m[1] ? m[1].length + (m[2] || "").length : 0);
    const chunk = src.slice(start, end).trim();
    if (m[1]) {
      const before = src.slice(start, m.index).split(/\s+/).pop().toLowerCase().replace(/^[("'“‘]+/, "");
      if (m[1] === "." && (ABBREV.includes(before) || /^[a-z]$/i.test(before) || /^\d+$/.test(before) && /^\s*\d/.test(src.slice(m.index + 1, m.index + 3)))) continue;
    }
    if (chunk) out.push({ text: chunk, start, end });
    start = m.index + m[0].length;
  }
  const tail = src.slice(start).trim();
  if (tail) out.push({ text: tail, start, end: src.length });
  return out.map((s, i) => ({ ...s, i }));
}

/** Paragraphs separated by blank lines (or single newlines when the student uses no blank lines). */
export function paragraphs(text) {
  const src = (text || "").trim();
  let parts = src.split(/\n\s*\n/);
  if (parts.length === 1) parts = src.split(/\n/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function years(s) {
  return [...(s || "").matchAll(/\b(1[89]\d\d|20[0-2]\d)\b(?:s\b)?/g)].map((m) => ({ year: Number(m[1]), decade: /s$/.test(m[0]), index: m.index }));
}

export function hasNumber(s) {
  return /\b\d[\d,.]*\b/.test(s);
}

export function containsTerm(s, term) {
  const t = term.toLowerCase().trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${esc}`, "i").test(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")) ||
         new RegExp(`(^|[^a-z])${esc}`, "i").test(s.toLowerCase());
}

export function anyTerm(s, terms) {
  return (terms || []).some((t) => containsTerm(s, t));
}

export function tokens(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

/** Share of the student's word n-grams that also appear in the model text. */
export function ngramOverlap(student, model, n = 5) {
  const a = tokens(student), b = tokens(model);
  if (a.length < n || b.length < n) return 0;
  const set = new Set();
  for (let i = 0; i + n <= b.length; i++) set.add(b.slice(i, i + n).join(" "));
  let hit = 0, total = 0;
  for (let i = 0; i + n <= a.length; i++) { total++; if (set.has(a.slice(i, i + n).join(" "))) hit++; }
  return total ? hit / total : 0;
}

export function shorten(s, max = 160) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
