// Automatic text checks (BUILD_PLAN §5). Each check returns a specific, quoted improvement point.
import { sentences, paragraphs, years, hasNumber, anyTerm, containsTerm, ngramOverlap, shorten } from "./text.js";

export const CONNECTIVES = ["because", "therefore", "which meant", "this meant", "as a result", "consequently", "so that", "which led", "leading to", "thus", "hence", "meant that", "so "];
const CONTRAST = ["however", "although", "on the other hand", "nevertheless", "yet", "but it could be argued", "despite", "even so", "conversely", "this is challenged", "a counter", "critics"];
const ALT = ["alternative", "another", "other factor", "more important", "rather than", "instead", "outweigh", "more significant", "less significant", "challenge", "limit", "only partly", "not simply"];
const CLAIM = ["important", "significant", "main", "key", "crucial", "decisive", "led to", "caused", "undermined", "weakened", "strengthened", "failed", "succeeded", "destabil", "because", "major", "primarily", "mainly", "responsible", "reason", "factor", "contributed", "explains"];
const COMPARE = ["whereas", "similarly", "unlike", "both", "in contrast", "likewise", "while", "compared with", "by contrast", "just as", "same as", "differ"];
const HIST_VERBS = ["argue", "argues", "argued", "contend", "contends", "suggest", "suggests", "claim", "claims", "show", "shows", "maintain", "maintains", "emphasise", "emphasises", "emphasize", "emphasizes", "interpret", "interprets", "sees", "believes", "insists", "stresses", "concludes"];
const HIST_LINKS = ["which", "this", "support", "supports", "suggests", "challenge", "challenges", "because", "therefore", "so", "confirms", "undermines", "fits", "explains"];

export const JUDGEMENT_LEXICON = {
  "to what extent": ["largely", "partly", "to a large extent", "to a great extent", "to a limited extent", "to some extent", "mostly", "primarily", "only partly", "significantly", "to a considerable extent", "in large part"],
  evaluate: ["more significant", "less significant", "most significant", "most important", "decisive", "strongest", "outweigh", "the key test", "criterion", "measured by", "judged by", "ultimately", "more convincing", "more important"],
  "compare and contrast": ["whereas", "similarly", "unlike", "both", "in contrast", "likewise", "more similar", "more different", "overall"],
  discuss: ["on balance", "overall", "more convincing", "ultimately", "largely", "partly", "most significant", "more persuasive"],
  examine: ["ultimately", "overall", "most significant", "on balance", "largely", "partly", "more important", "the key"],
  analyse: ["ultimately", "overall", "most significant", "on balance", "largely", "partly", "more important", "the key"],
};

const DEFAULT_LENGTH = { plan: [60, 300], paragraph: [150, 380], essay: [650, 1700], p1q1a: [25, 160], p1q1b: [15, 120], p1q2: [90, 300], p1q3: [120, 400], p1q4: [250, 700] };

function point(id, met, criterion, extra = {}) {
  return { id, met, criterion, quote: null, missing: null, action: null, ...extra };
}

/** Essay-type checks for plan, paragraph and full essay modes. */
export function essayChecks(text, q, section, taskType) {
  const cfg = q.autoCheck || {};
  const factor = [...(cfg.factorTerms || []), ...(cfg.synonyms || [])];
  const sents = sentences(text);
  const paras = paragraphs(text);
  const [y0, y1] = q.timeframe;
  const lexicon = evidenceLexicon(section, cfg);
  const out = [];
  const factorName = q.namedFactor || (cfg.factorTerms || [])[0] || "the task";

  // 1. Question focus
  {
    const thesis = sents.slice(0, taskType === "essay" ? 2 : 1).map((s) => s.text).join(" ");
    const thesisOk = anyTerm(thesis, factor);
    let badPara = null;
    const bodyParas = taskType === "essay" && paras.length > 2 ? paras.slice(1, -1) : paras;
    if (taskType !== "plan") {
      for (const p of bodyParas) {
        const ps = sentences(p);
        const openClose = [ps[0]?.text || "", ps[ps.length - 1]?.text || ""].join(" ");
        if (!anyTerm(p, factor) || !anyTerm(openClose, factor)) { badPara = ps[0]?.text || p; break; }
      }
    }
    const met = thesisOk && !badPara;
    out.push(point("focus", met, "exact_question", met ? {} : {
      quote: shorten(!thesisOk ? thesis : badPara),
      missing: !thesisOk ? `Your opening does not name ${factorName}.` : `This paragraph never ties its point to ${factorName}.`,
      action: !thesisOk ? `Rewrite your first sentence so it names ${factorName} and gives your judgement.` :
        `Start this paragraph with a sentence that names ${factorName} and says how far it explains the question.`,
    }));
  }
  // 2. Timeframe
  {
    let bad = null;
    for (const s of sents) {
      for (const y of years(s.text)) {
        const end = y.decade ? y.year + 9 : y.year;
        if (end < y0 || y.year > y1) { bad = { s, y }; break; }
      }
      if (bad) break;
    }
    out.push(point("timeframe", !bad, "decoded", bad ? {
      quote: shorten(bad.s.text),
      missing: `${bad.y.year}${bad.y.decade ? "s" : ""} is outside the question's timeframe (${y0}–${y1}).`,
      action: `Replace this with evidence from ${y0}–${y1}, or cut it to one clause of background.`,
    } : {}));
  }
  // 3. Two-part questions: both parts addressed
  if (cfg.parts && cfg.parts.length) {
    const missingPart = cfg.parts.find((p) => !anyTerm(text, p.terms));
    out.push(point("parts", !missingPart, "decoded", missingPart ? {
      quote: shorten(sents[0]?.text || text),
      missing: `The question has two parts, and your answer does not deal with the ${missingPart.name} part.`,
      action: `Split your plan into two columns and give the ${missingPart.name} part at least one full argument.`,
    } : {}));
  }
  // 4. Evidence density
  {
    const ev = sents.map((s) => evidenceIn(s.text, lexicon));
    const total = ev.reduce((a, b) => a + b, 0);
    const need = { plan: 3, paragraph: 2, essay: 6 }[taskType] || 2;
    let flagged = null;
    sents.forEach((s, i) => {
      if (flagged || ev[i] > 0) return;
      if (!anyTerm(s.text, CLAIM)) return;
      if ((ev[i - 1] || 0) > 0 || (ev[i + 1] || 0) > 0) return;
      flagged = s;
    });
    const met = total >= need && !flagged;
    out.push(point("evidence", met, "precise_evidence", met ? {} : {
      quote: shorten((flagged || sents[0] || { text }).text),
      missing: flagged ? "This claim has no precise evidence near it: no date, figure, law, name or event." :
        `Your answer has ${total} precise evidence item${total === 1 ? "" : "s"}; this task needs at least ${need}.`,
      action: "Add one precise fact from the evidence bank (a name, date, figure or law) directly after this claim.",
    }));
  }
  // 5. Narrative detection and mechanism
  if (taskType !== "plan") {
    let run = [], badRun = null;
    for (const s of sents) {
      const dateLed = /^(in|on|by|during|after|then|later|from|at the end of)\b[^.]{0,30}\b(1[89]\d\d|20[0-2]\d)/i.test(s.text) || /^(1[89]\d\d|20[0-2]\d)\b/.test(s.text) || /^then\b/i.test(s.text);
      if (dateLed && !anyTerm(s.text, CONNECTIVES)) { run.push(s); if (run.length >= 3 && !badRun) badRun = run.slice(); }
      else run = [];
    }
    const connectives = sents.filter((s) => anyTerm(s.text, CONNECTIVES)).length;
    const needConn = taskType === "essay" ? Math.max(3, paras.length - 1) : 1;
    const met = !badRun && connectives >= needConn;
    out.push(point("mechanism", met, "mechanism", met ? {} : badRun ? {
      quote: shorten(badRun.map((s) => s.text).join(" ")),
      missing: "These sentences tell the story in date order but do not explain why it mattered.",
      action: "After the second date, add a sentence beginning “This meant that…” that links the event to the question.",
    } : {
      quote: shorten(sents.find((s) => evidenceIn(s.text, lexicon) > 0)?.text || sents[0]?.text || ""),
      missing: "The evidence is stated but the causal link to your claim is not explained.",
      action: "Add “which meant that…” after this evidence and finish the causal chain.",
    }));
  }
  // 6. Counter / test
  {
    const counter = sents.find((s) => anyTerm(s.text, CONTRAST) && s.text.split(/\s+/).length >= 8 &&
      (anyTerm(s.text, ALT) || evidenceIn(s.text, lexicon) > 0 || anyTerm(s.text, factor)));
    out.push(point("counter", !!counter, "counter", counter ? {} : {
      quote: shorten(sents[Math.min(sents.length - 1, 2)]?.text || ""),
      missing: "There is no real counter-argument or test of your claim.",
      action: "Add a sentence starting “However,” that gives the strongest alternative and one piece of evidence for it.",
    }));
  }
  // 7. Judgement suited to the command term
  {
    const lex = cfg.judgementLexicon || JUDGEMENT_LEXICON[q.commandTerm] || JUDGEMENT_LEXICON.examine;
    const ending = taskType === "essay" ? (paras[paras.length - 1] || "") : sents.slice(-2).map((s) => s.text).join(" ");
    const met = anyTerm(ending, lex);
    out.push(point("judgement", met, "judgement_criterion", met ? {} : {
      quote: shorten(sentences(ending).slice(-1)[0]?.text || ending),
      missing: `Your ending summarises but does not weigh. “${q.commandTerm}” needs language such as “${lex.slice(0, 3).join("”, “")}”.`,
      action: `Rewrite your last sentence to give a judgement (for example “${lex[0]}…”) and the criterion behind it.`,
    }));
  }
  // 8. Question words in, question words out
  if (taskType !== "plan") {
    const last = (taskType === "essay" ? paras[paras.length - 1] : sents.slice(-1)[0]?.text) || "";
    const met = anyTerm(last, factor);
    out.push(point("question_words", met, "question_words", met ? {} : {
      quote: shorten(sentences(last).slice(-1)[0]?.text || last),
      missing: "Your final judgement does not reuse the key words of the question.",
      action: `Use the question's own words (“${(cfg.factorTerms || [factorName])[0]}”) in your final sentence.`,
    }));
  }
  // 9. Explicit comparison where required
  if (cfg.comparisonRequired || (q.features || []).some((f) => ["comparative", "two_state", "two_region"].includes(f))) {
    const n = sents.filter((s) => anyTerm(s.text, COMPARE)).length;
    const need = taskType === "essay" ? 3 : 1;
    out.push(point("comparison", n >= need, "explicit_comparison", n >= need ? {} : {
      quote: shorten(sents[1]?.text || sents[0]?.text || ""),
      missing: "The cases are discussed side by side but not compared directly.",
      action: "Add a sentence that links both cases on the same point, using “whereas”, “similarly” or “unlike”.",
    }));
  }
  // 10. Historiography misuse (only when a historian is named)
  {
    const names = historianNames(section, cfg);
    const hs = sents.filter((s) => names.some((n) => containsTerm(s.text, n)));
    if (hs.length) {
      const bad = hs.find((s) => !(anyTerm(s.text, HIST_VERBS) && anyTerm(s.text, HIST_LINKS)));
      out.push(point("historiography", !bad, null, bad ? {
        quote: shorten(bad.text),
        missing: "The historian is named, but their argument is not used to support or challenge your claim.",
        action: "Say what the historian argues and add “which suggests…” to show how it helps your judgement.",
      } : {}));
    }
  }
  // 11. Length
  out.push(lengthCheck(text, taskType, cfg));
  return out;
}

/** Paper 1 checks per question part. */
export function p1Checks(text, q, set, section) {
  const sents = sentences(text);
  const paras = paragraphs(text);
  const out = [];
  const srcText = set.sources.map((s) => s.text || (s.table ? JSON.stringify(s.table) : "") || "").join(" ").toLowerCase();
  const sourceTerms = q.autoCheck?.sourceTerms || [];
  const lexicon = evidenceLexicon(section, {});
  const ownLex = (q.autoCheck?.ownKnowledgeLexicon && q.autoCheck.ownKnowledgeLexicon.length ? q.autoCheck.ownKnowledgeLexicon :
    lexicon.filter((t) => !srcText.includes(t.toLowerCase())));

  if (q.part === "p1q1a" || q.part === "p1q1b") {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const pts = Math.max(lines.length > 1 ? lines.length : 0, sents.length);
    const expected = q.autoCheck?.expectedPoints || q.marks;
    const enough = pts >= expected;
    out.push(point("points", enough, "q1_points", enough ? {} : {
      quote: shorten(text), missing: `There are ${q.marks} marks, and you have made ${pts} distinct point${pts === 1 ? "" : "s"}.`,
      action: `Write ${expected} separate sentences, each with a different point from the source.`,
    }));
    const ok = sents.find((s) => anyTerm(s.text, ownLex) && !anyTerm(s.text, sourceTerms));
    out.push(point("own_knowledge", !ok, "q1_no_ok", ok ? {
      quote: shorten(ok.text), missing: "This looks like own knowledge. Q1 rewards only what the source says or shows.",
      action: "Replace it with a point you can point to in the source itself.",
    } : {}));
  }
  if (q.part === "p1q2") {
    const label = sents.find((s) => /^(the\s+)?(origin|purpose|content)\s+(of\s+(the\s+)?source\s+[a-d]\s+)?(is|was)\b/i.test(s.text));
    out.push(point("label_pattern", !label, "q2_feature", label ? {
      quote: shorten(label.text), missing: "This names the origin, purpose or content instead of explaining what it means for the source's value.",
      action: "Turn it into “Because the source was …, it is valuable/limited for … since …”.",
    } : {}));
    const val = sents.some((s) => /valu|useful/i.test(s.text) && anyTerm(s.text, ["because", "since", "as it", "as the", "which means", "so it", "therefore"]));
    const lim = sents.some((s) => /limit|less useful|cannot|does not show|restricted/i.test(s.text) && anyTerm(s.text, ["because", "since", "as it", "as the", "which means", "so it", "therefore"]));
    out.push(point("value", val, "q2_value", val ? {} : {
      quote: shorten(sents[0]?.text || text), missing: "Value is not explained with a reason.",
      action: "Add “The source is valuable because…” and tie it to who made it, when, or why.",
    }));
    out.push(point("limitation", lim, "q2_limitation", lim ? {} : {
      quote: shorten(sents[sents.length - 1]?.text || text), missing: "A limitation is not explained with a reason.",
      action: "Add “However, it is limited because…” and tie it to its purpose or what it leaves out.",
    }));
    const opc = {
      origin: /\b(origin|written by|produced by|author|created by|drawn by|published|issued|photograph(ed)? by|date[ds]?|in 19\d\d|official|government|newspaper|cartoonist|speech by)\b/i.test(text),
      purpose: /\b(purpose|in order to|aim(ed)?|intended|to persuade|to justify|to convince|to encourage|audience|propaganda|designed to)\b/i.test(text),
      content: /\b(content|states|shows|claims|describes|depicts|says|tone|language|mentions|omits|refers)\b/i.test(text),
    };
    const missing = Object.entries(opc).filter(([, v]) => !v).map(([k]) => k);
    out.push(point("opc", !missing.length, "q2_opc", missing.length ? {
      quote: shorten(text), missing: `No clear reference to the source's ${missing.join(" and ")}.`,
      action: `Add one sentence that uses the ${missing[0]} to explain value or limitation.`,
    } : {}));
  }
  if (q.part === "p1q3") {
    const [a, b] = q.sources;
    const refA = (s) => new RegExp(`\\b(source\\s+${a}|${a}\\b(?=\\s*(says|shows|states|claims|argues|suggests|and|,)))`, "i").test(s) || new RegExp(`\\bsource\\s+${a}\\b`, "i").test(s);
    const refB = (s) => new RegExp(`\\bsource\\s+${b}\\b`, "i").test(s) || new RegExp(`\\b${b}\\b(?=\\s*(says|shows|states|claims|argues|suggests|,))`, "i").test(s);
    const both = sents.filter((s) => (refA(s.text) && refB(s.text)) || (/\bboth\b/i.test(s.text) && /\bsources?\b/i.test(s.text)));
    const need = 4;
    out.push(point("linked", both.length >= need, "q3_linked", both.length >= need ? {} : {
      quote: shorten(sents.find((s) => !(refA(s.text) && refB(s.text)))?.text || text),
      missing: `Only ${both.length} sentence${both.length === 1 ? "" : "s"} link both sources on the same issue.`,
      action: `Rewrite this so one sentence covers both: “Source ${a} … whereas/similarly Source ${b} …”.`,
    }));
    const half = Math.ceil(sents.length / 2);
    const firstOnlyA = sents.slice(0, half).every((s) => !refB(s.text));
    const secondOnlyB = sents.slice(half).every((s) => !refA(s.text));
    const separate = sents.length >= 4 && firstOnlyA && secondOnlyB;
    out.push(point("separate", !separate, "q3_linked", separate ? {
      quote: shorten(sents[0].text), missing: "This reads as two separate summaries, one per source.",
      action: "Organise by issue: one paragraph for similarities, one for differences, each naming both sources.",
    } : {}));
    const sim = sents.some((s) => anyTerm(s.text, ["both", "similarly", "likewise", "agree", "same", "also"]));
    const diff = sents.some((s) => anyTerm(s.text, ["whereas", "however", "unlike", "in contrast", "differ", "while", "but"]));
    out.push(point("sim_diff", sim && diff, sim ? "q3_contrast" : "q3_compare", sim && diff ? {} : {
      quote: shorten(sents[0]?.text || text), missing: sim ? "There are no points of difference." : "There are no points of similarity.",
      action: sim ? "Add a difference on the same issue using “whereas”." : "Add a similarity using “Both sources…”.",
    }));
  }
  if (q.part === "p1q4") {
    const letters = set.sources.map((s) => s.letter);
    const cited = letters.filter((l) => new RegExp(`\\b(source\\s+${l}|\\(${l}\\))`, "i").test(text));
    const okItems = ownLex.filter((t) => containsTerm(text, t));
    out.push(point("sources_used", cited.length >= Math.min(3, letters.length), "q4_sources", cited.length >= 3 ? {} : {
      quote: shorten(sents[0]?.text || text), missing: `You refer explicitly to ${cited.length} source${cited.length === 1 ? "" : "s"} (${cited.join(", ") || "none"}).`,
      action: `Use the remaining sources (${letters.filter((l) => !cited.includes(l)).join(", ")}) as evidence, naming each one.`,
    }));
    out.push(point("own_knowledge", okItems.length >= 2, "q4_ok", okItems.length >= 2 ? {} : {
      quote: shorten(sents[1]?.text || sents[0]?.text || text), missing: "There is little or no own knowledge beyond the sources.",
      action: "Add two precise facts from your own knowledge that are not in any source, each tied to an argument.",
    }));
    const order = paras.map((p) => letters.find((l) => new RegExp(`\\bsource\\s+${l}\\b`, "i").test(p))).filter(Boolean);
    const sourceOrder = paras.length >= 3 && order.length >= 3 && order.every((l, i) => i === 0 || letters.indexOf(l) > letters.indexOf(order[i - 1])) &&
      paras.every((p) => letters.filter((l) => new RegExp(`\\bsource\\s+${l}\\b`, "i").test(p)).length <= 1);
    out.push(point("argument_order", !sourceOrder, "q4_argument", sourceOrder ? {
      quote: shorten(paras[0]), missing: "The answer works through the sources in order (A, then B, then C) instead of by argument.",
      action: "Reorganise into arguments; each paragraph should combine two or more sources with own knowledge.",
    } : {}));
    const ending = sents.slice(-2).map((s) => s.text).join(" ");
    const judged = anyTerm(ending, [...JUDGEMENT_LEXICON["to what extent"], ...JUDGEMENT_LEXICON.evaluate, "overall", "on balance"]);
    out.push(point("judgement", judged, "q4_judgement", judged ? {} : {
      quote: shorten(ending), missing: "There is no final judgement on the question.",
      action: "End with one sentence that answers the question and says why, e.g. “Overall, … largely because …”.",
    }));
  }
  out.push(lengthCheck(text, q.part, q.autoCheck || {}));
  return out;
}

export function lengthCheck(text, taskType, cfg) {
  const words = (text.trim().match(/\S+/g) || []).length;
  const [lo, hi] = (cfg.lengthWords && cfg.lengthWords[taskType]) || DEFAULT_LENGTH[taskType] || [50, 2000];
  const met = words >= lo && words <= hi;
  return point("length", met, null, met ? {} : {
    quote: null,
    missing: words < lo ? `${words} words is short for this task (about ${lo}–${hi} expected).` : `${words} words is long for this task (about ${lo}–${hi} expected).`,
    action: words < lo ? "Develop one argument further with evidence and explanation." : "Cut narrative and keep the sentences that argue.",
  });
}

export function copyGuard(text, modelText, cfg = {}) {
  const n = (cfg.copyGuard && cfg.copyGuard.ngram) || 5;
  const t = (cfg.copyGuard && cfg.copyGuard.threshold) || 0.3;
  const overlap = ngramOverlap(text, modelText || "", n);
  return { overlap, tooClose: overlap >= t };
}

export function evidenceLexicon(section, cfg) {
  const terms = new Set(cfg.extraLexicon || []);
  for (const f of section?.context?.evidenceBank || []) for (const t of f.lexicon || []) terms.add(t);
  return [...terms];
}

function evidenceIn(s, lexicon) {
  let n = years(s).length + (hasNumber(s.replace(/\b(1[89]\d\d|20[0-2]\d)\b/g, "")) ? 1 : 0);
  for (const t of lexicon) if (containsTerm(s, t)) n++;
  return n;
}

function historianNames(section, cfg) {
  const names = new Set(cfg.historians || []);
  for (const d of section?.context?.historiography || []) names.add(d.historian.split(/\s+/).pop());
  return [...names].filter(Boolean);
}
