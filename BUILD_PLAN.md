# Build plan

DP27 History practice app · Ali Dukayev · Stage 0 (plan, no code) · 2026-11-06

Companion files: `SECTION_MAP.md`, `content/sections.json`, `content/schema/`, `content/_verification/_section-map.md`.

---

## 1. Decisions needed before Stage 1

| # | Question | Default if you say nothing |
|---|---|---|
| D1 | **Guide wording.** 8 of 51 bullets are verified against fetched secondary reproductions of the guide. The other 43 are flagged `WORDING UNVERIFIED`. Can you add the official legacy guide PDF (and the IB's 2020 amendments document, if held) to `reference/`? | Keep the flags; content is built to the plan/outline wording. |
| D2 | **Bullet text in a public repo.** Guide bullets are IB text. They are short syllabus headings, not past-paper or markscheme text, so the brief's ban does not name them. Keep exact wording in `sections.json` and show it in the app? | Keep it in `sections.json` and show it in the app as "Syllabus bullet". |
| D3 | **What goes in the public repository.** `project_docs/` and the build-brief file in the project root contain internal tool instructions and attribution words. `reference/` holds copyrighted books. | All three are excluded through `.git/info/exclude` (local only, so their names never appear in the repository) and never published. The markband paraphrases from `DP27_Assessment_Marking_Feedback.md` §1 are copied into `content/_markbands.json` with the required label. |
| D4 | **§17 b4 Spain end year.** The plan teaches Spain to 2000; the outline bullet says "to 1982". | Paper 3 section ends in 1982; Topic 9 Spain (`P2-9-ES`) runs to 2000. |
| D5 | **Topic 12 crises granularity.** Six crisis sections (two Berlin crises kept separate). | Six sections. Merging the two Berlin crises would save one section. |
| D6 | **`P2-12-CONTAINMENT`** (containment and peaceful co-existence) is a verified sub-bullet but is not listed separately in the Year 1 outline. | Kept, status `taught`. |
| D7 | **Fact-check source quality.** Proposed order: primary documents and archives (Avalon, FRUS / Office of the Historian, Wilson Center, Seventeen Moments, NSA, TRC site, CONADEP text); then university and museum pages; then Britannica. Wikipedia is a pointer to sources, never the verifying page. | As proposed. |
| D8 | **Git identity and tooling.** The folder is not a git repo, and the GitHub CLI (`gh`) is not installed. Which email should commits show publicly (your GitHub no-reply address is recommended)? | You install `gh` and run `gh auth login`; I ask before creating `dp27-history-practice`. |

Also noted: the plan header says "first assessment 2020" while the brief and outline say 2017. Both refer to the same legacy course (the 2017 guide, with amendments for first examinations in 2020). The app says "legacy guide (first assessment 2017)".

---

## 2. Architecture

**Stack (changed in Stage 1).** Plain JavaScript ES modules, no framework and no Node toolchain: this Mac has no Node, and Python covers the build, validation and tests. `scripts/build.py` assembles `site/`; GitHub Pages hosting; hash routing (`#/s/P3-16-B4-GLASNOST/read`) so deep links work on Pages and offline.

**Offline.**
- A hand-written service worker (`app/sw.js`, no third-party worker library, so no tool text is injected into the build output).
- At build time `scripts/build.py` lists every file in `site/` (HTML, JS, CSS, icons, `content/**/*.json`, `content/_media/**`) with a content hash and writes `precache-manifest.json`. System fonts are used, so there are no font files to cache. On install the worker caches all of it; on activate it deletes caches from older versions.
- Strategy: cache-first for everything precached; network only for the sync endpoint.
- An update toast ("New version ready, reload") appears when a new worker is waiting. No silent reload mid-attempt.
- Installability: `manifest.webmanifest` (standalone display, icons in 192/512 + Apple touch icon), plus the iOS meta tags Safari needs for Add to Home Screen.
- Size budget check at build: fail above 80 MB total; warn on any image over 220 KB or 1600 px.

**Storage (IndexedDB, small hand-written wrapper in `app/js/db.js`).** Calls `navigator.storage.persist()` at first launch and shows the result in Settings.

| Store | Key | Holds |
|---|---|---|
| `profile` | `"me"` | studentId, level (HL/SL), class code, token from login, settings |
| `reading` | sectionId | chunks read, prediction text, revisited prediction |
| `itemResults` | itemId | every answer with timestamp, best score |
| `attempts` | submissionId | written attempts in the `dp27.submission.v1` shape, plus local-only fields (self-check sentence taps, draft diff) |
| `progress` | sectionId | derived completion state (recomputed, never trusted alone) |
| `leitner` | cardId | box 1–5, due date |
| `timed` | paperAttemptId | timed-paper state, autosaved every 10 s |
| `syncQueue` | auto | pending submissions and progress snapshots, attempt count, next retry time |
| `feedback` | submissionId | teacher feedback from the inbox (no `markForPrediction`: the server strips it) |

"Export my work" writes one JSON file (all stores except the token) and one readable HTML report. Import of that JSON is available to the student (restore) and to teacher mode.

**Rendering.** Small typed render functions per screen; content JSON is validated against the schemas at build time, not at runtime. Diagrams (timeline, causal chain, comparison grid) are inline SVG drawn from section data, each captioned "Diagram". Dark mode follows `prefers-color-scheme`, with a manual toggle. Type sizes are set for an iPad held at arm's length. Every control is reachable by keyboard; focus outlines stay visible.

**Levels.** SL hides every `P3` section, P3 timed papers and P3 dashboard rows. Completion and the dashboard count only visible sections.

**Sync (Stage 2).** Apps Script web app ("Execute as me", access "Anyone"). Requests use `Content-Type: text/plain` so the browser sends no CORS preflight (Apps Script cannot answer one). The queue flushes on `online` events and on app start, with exponential backoff (30 s → 1 h, plus jitter). The status pill reads "3 answers waiting to send". The endpoint URL lives in `config.json` with no secrets.

**Teacher mode.** Unlocked by a PIN checked against a salted SHA-256 hash in `config.json`. This is a convenience lock, not real security: the repository is public and a short PIN hash can be brute-forced. So teacher mode holds nothing secret. It only reads export files you import on your own device, previews section status, and links to the Register Sheet. No predicted grades anywhere in the app.

---

## 3. Folder layout

```
dp27-history-practice/
├─ app/                         served as-is
│  ├─ index.html  manifest.webmanifest  config.json  sw.js
│  ├─ css/app.css
│  ├─ icons/                    drawn by scripts/make_icons.py (monogram only)
│  └─ js/
│     ├─ main.js  router.js  db.js  content.js  progress.js  sync.js  diagrams.js  util.js
│     ├─ items/index.js         renderers and markers for every item and drill type
│     ├─ checks/                text.js, auto.js (automatic checks), feedback.js (self-check, scoring, points)
│     └─ screens/               dashboard, section, reader, itemset, task, attempt, settings
├─ content/
│  ├─ sections.json  _markbands.json
│  ├─ sections/<sectionId>.json
│  ├─ timed/                   (Stage 4)
│  ├─ schema/
│  ├─ _media/credits.json, *.webp
│  └─ _verification/<sectionId>.md, _section-map.md
├─ scripts/  build.py  serve.py  validate_content.py  optimise_images.py  make_icons.py
├─ tests/    conftest.py  test_app.py   (pytest + Playwright)
├─ apps_script/  Code.gs, appsscript.json, SETUP.md   (Stage 2)
├─ docs/     DATA_CONTRACT.md (Stage 2), INSTALL_GUIDE.md (Stage 4)
├─ .github/workflows/pages.yml  build with Python and publish site/ to GitHub Pages
├─ .gitignore   .venv/, site/, caches
└─ (.git/info/exclude, local only: project_docs/, reference/, the build brief, the local tool settings folder)
```

IDs: section `P3-16-B4-GLASNOST`; items `…-R01` (retrieval), `…-C01` (checkpoint), `…-D01` (drill); essays `…-Q01`; source sets `P1-CS2-CAUSES-SS01` with questions `…-SS01-Q1A`; facts `F-<SECTION>-01`; media `M-<slug>`.

Every constructed item, question, model and source set carries `"label": "Teacher-constructed practice material. Not an IB publication."` The schema enforces it as a constant, and the app prints it under each one.

---

## 4. Item and drill types

**Retrieval / checkpoint (auto-marked).** Every option carries its own explanation (schema-enforced).

| Type | What the student does |
|---|---|
| `mcq` | One correct answer; each distractor explains why it is wrong |
| `multi_select` | Choose all that apply; partial credit per correct choice and per correct non-choice |
| `chronology` | Drag or keyboard-sort 4–6 events; validator checks years are inside the section timeframe and unique |
| `match` | Actor ↔ role (or term ↔ meaning) |
| `cloze` | Fill a date or figure; numeric tolerance where set |
| `which_argument` | Which argument does this fact support? |
| `spot_error` | Find the wrong date, name or causal claim in a short passage |
| `in_timeframe` | Inside or outside the question's timeframe? |

**Skill drills (auto-marked; skill tag S1–S14 required).**

| Type | Skill | What the student does |
|---|---|---|
| `decode` | S1 | Tag verb, factor, timeframe, scope, judgement in an unfamiliar question |
| `pick_thesis` | S11 | Four theses; distractors ignore the factor, use the wrong timeframe, narrate, or give no judgement |
| `narrative_or_analysis` | S2/S4 | Sort sentences |
| `evidence_to_claim` | S3 | Match facts to claims |
| `upgrade_sentence` | S4/S10 | Choose the best analytical upgrade of a vague sentence |
| `strongest_counter` | S12 | Pick the strongest counter-argument |
| `judgement_criterion` | S13 | Pick the conclusion that weighs rather than recaps |
| `two_part_balance` | S1/S11 | Split a plan into CAUSES \| EFFECTS (or SUCCESSES \| FAILURES) |
| `p1_point_harvest` | — | Tap the distinct points in a source (Q1) |
| `p1_purpose` | S5 | AUDIENCE + ACTION + MOMENT |
| `p1_value_limitation` | S7 | Feature → consequence → value or limitation; reject "The origin is…" |
| `p1_pair_statements` | S8 | Pair statements on the same issue across Sources A and B (Q3) |

**Written tasks.** Papers 2 and 3: plan (7 min), paragraph (12–15 min), full essay (45 min for P2, 50 min for P3). Paper 1: Q1(a), Q1(b), Q2, Q3, Q4. Timers are visible but do not lock the text during section practice. The text locks only in timed papers.

---

## 5. Feedback engine (offline, rule-based)

**Self-check (evidence-anchored).** For each criterion the student taps the sentence that meets it. An untapped criterion counts as not met. P2/P3 criteria are the eight in the brief (`explicit_comparison` only when the question needs it). Paper 1 criteria come per question type from the markband paraphrase rules and the examiner-report routines.

**Automatic checks.** Each check returns `{id, met, quote, missing, action}`. The text is split into sentences and paragraphs with a deterministic splitter (abbreviation list for "c.", "U.S.", "Dr." etc.).

| Check | Rule |
|---|---|
| `focus` | Factor terms or synonyms appear in the thesis and in the first or last sentence of each body paragraph; flags any paragraph that never mentions them |
| `timeframe` | Any four-digit year 1800–2029 outside the question range is quoted and flagged |
| `evidence` | Counts dates, numbers and section-lexicon proper nouns per sentence; flags claim sentences (with evaluative verbs) that carry none |
| `narrative` | Flags runs of three or more date-led sentences with no analytical connective (because, therefore, which meant, as a result, so, consequently) |
| `counter` | Requires a contrast marker (however, although, on the other hand, yet) followed within the sentence by a factor or claim term, not just a filler |
| `judgement` | Final paragraph contains weighing language for the command term (to what extent → largely, partly, to a limited extent; evaluate → criterion language such as "more significant because", "the decisive test"; compare and contrast → whereas, similarly, unlike, both) |
| `historiography` | A historian's surname not followed within the sentence by an argument verb (argues, contends, suggests…) and a link to the claim is flagged as name-dropping |
| `p1q1` | Distinct points vs marks; flags sentences whose key terms are absent from the source (added own knowledge) |
| `p1q2` | Requires "valuable because / limited because" reasoning tied to origin, purpose and content; flags the label pattern "The origin is…" |
| `p1q3` | Counts sentences that name both sources on the same issue; flags separate summaries |
| `p1q4` | Detects explicit source references and own-knowledge lexicon items; flags answers that run in A→B→C→D order |
| `length` | Against the task type (configurable per question) |
| `copyGuard` | 5-gram overlap with the model text; above the threshold, shows "Use your own words" and the redraft does not count |

**Feedback screen.** "Checklist score, not an IB mark": criteria met out of total. Then 2–3 improvement points chosen by a fixed priority (focus → timeframe → judgement → evidence → narrative → counter → other). Each point quotes the student's sentence, names what is missing and says what to do. Then one redraft instruction (a single operation). Choices: **Redraft** (Draft 1 beside Draft 2, checks re-run, "You fixed: timeframe, judgement"), **See the model** (only after a submitted attempt) and **Try another question**. Markband references use `content/_markbands.json`, labelled "Plain-language paraphrase of the IB markbands". No predicted grade anywhere in student mode.

---

## 6. Gating, completion, review

- **Practice gate:** all chunks read, and at least 80% across checkpoints (best attempt per checkpoint; retakes allowed).
- **Section complete:** checkpoints ≥ 80% **and** drills ≥ 80% (best attempt) **and** every written task type attempted and redrafted once after feedback (P2/P3: plan, paragraph, essay; P1: Q1, Q2, Q3, Q4. Q1 counts when (a) and (b) are both done). A redraft after teacher feedback also counts. A redraft blocked by the copy guard does not.
- **Dashboard:** per section (reading, checkpoints, drills, written tasks) and per paper.
- **Daily Review:** Leitner boxes at 1/3/7/14/30 days. Cards are retrieval items and evidence-bank facts from every *started* section, interleaved so no two consecutive cards share a section where possible. A wrong answer drops the card to box 1. The session is 10–15 minutes (stops at 15 min or when the queue is empty).
- **Weekly unfamiliar question:** a random essay question from a completed section, in Plan mode, 7 minutes, once per ISO week.
- **Timed papers:** P1 (60 min, one case-study set), P2 (90 min; the app enforces one Topic 9 and one Topic 12 essay), P3 (150 min; three essays from §16–§18 questions). Timer, autosave, no model until submission. Timed-paper questions are written fresh, not reused from section banks. A split task is never labelled a full-paper simulation.

---

## 7. Content volume (minimums)

51 sections: P1 6 · P2 23 (Topic 12: 13, Topic 9: 10) · P3 22 (§16: 11, §17: 5, §18: 6).

| Per paper | Sections | Chunks (≈4 each) | Checkpoint items | Retrieval | Drills | Essays | P1 source sets | Evidence facts |
|---|---|---|---|---|---|---|---|---|
| P1 | 6 | ~24 | ~84 | 120 | 90 | — | 24 (96 sources, 120 questions) | ~40 |
| P2 | 23 | ~92 | ~320 | 460 | 230 | 138 | — | ~150 |
| P3 | 22 | ~88 | ~310 | 440 | 220 | 132 | — | ~145 |
| **Total** | **51** | **~204 (~77,000 words)** | **~714** | **1,020** | **540** | **270** | **24** | **~335** |

Timed papers add: P1 6 papers (6 sets, 24 sources); P2 6 papers (6 questions each: 3 Topic 9 + 3 Topic 12 = 36); P3 6 papers (2 questions per section × 3 sections = 36).

Each essay carries a decode key, a model plan, an annotated model paragraph, self-check criteria and an auto-check configuration. Each P1 set carries points models (Q1, Q2) and band-annotated models (Q3, Q4).

**Verification load.** About 20–30 logged checks per section (evidence bank, chunk facts, timeline, item answers, historiography, source provenance): roughly 1,200–1,500 log rows. This is the pacing constraint for Stage 3.

**Media.** About 4 archival images per section plus P1 visual sources: ~230 images × ~180 KB ≈ 42 MB. Add JSON (~8 MB), fonts (~1 MB) and code (<1 MB): ≈ 52 MB, under the 80 MB budget.

**Coverage risk.** Reference files exist only for §17/§18 (Judt), Topic 9 South Africa and Germany (Cambridge) and FRUS (Spain, FRG, Italy). §16, Topic 12, Paper 1 and Argentina depend on online primary and archival sources (D7). Batches with thin sources will be smaller and flagged, never padded.

---

## 8. Validator (`scripts/validate_content.py`, Stage 1)

Python 3 + `jsonschema`. Exit code 0 only with zero errors; prints every error with file and JSON path.

1. Every JSON file against its schema (`sections.json`, each section file, `credits.json`).
2. Minimum quantities per section type (§7), and that every `sections.json` record has a content file once its batch is delivered.
3. Every constructed item, question, model and source set carries the exact label.
4. Timeframe consistency: timeline, chronology and recall-sheet years inside the section timeframe; question timeframes inside the section timeframe; `in_timeframe` answer keys agree with the years.
5. Every image: a `credits.json` entry with credit line and licence (archival) or `dataFrom` facts (diagram); file exists; width ≤ 1600 px; size budget.
6. Banned words in student-facing text: the four words listed in the brief (§10, Stage 1), matched whole-word and case-insensitive. The list lives in the validator only.
7. Every `factId` used anywhere has a row in `content/_verification/<sectionId>.md` with claim, URL or file plus location, and access date.
8. Extra: cross-link section IDs exist; essay questions meet the command-term and feature mix (≥4 command terms, ≥2 named-factor/proposition, ≥1 two-part, ≥1 comparative where allowed); P1 sets rotate visual types; no option lacks an explanation.

A separate repository scan (same script, `--repo` flag) checks code, README, `package.json` and the last commit messages for attribution words and co-author trailers.

---

## 9. Tests (pytest + Playwright, Python; Stage 1, extended in Stages 2 and 4)

Run against `vite preview` in Chromium and WebKit (WebKit approximates Safari; the real iPad check is manual in Stage 4), with iPad portrait, iPad landscape and 13" laptop viewports.

| Area | Tests |
|---|---|
| Offline | First visit online → worker installed → `context.set_offline(True)` → reload → dashboard, reader, practice and a pilot image all load; a cold start offline in a fresh page on the same context |
| Gating | Practice locked → read all chunks → score below 80% → still locked → retake to ≥ 80% → unlocked |
| Retry and redraft | Paragraph attempt → feedback screen shows checklist score label and 2–3 quoted points → Redraft shows Draft 1 beside Draft 2 → fixed check listed → model hidden before submit, visible after |
| Copy guard | Pasting the model triggers "Use your own words" and the redraft does not count |
| Completion | Completing all task types marks the section complete on the dashboard; SL profile hides P3 |
| Sync queue | Offline submissions queue with the visible count; going online against a mocked endpoint (route interception) flushes with retry/backoff; failures keep items queued |
| Storage | Export JSON/HTML downloads; import restores attempts into a fresh context |
| Accessibility | Keyboard-only path through a checkpoint; dark-mode screenshot sanity; no horizontal scroll at iPad portrait |

---

## 10. Stage sequence

- **Stage 1.** Engine, PWA and offline, IndexedDB, all item and drill types, written tasks, self-check, auto-checks, feedback, redraft, model reveal, completion and dashboard. Two pilot sections: `P3-16-B4-GLASNOST` and `P1-CS2-CAUSES` (4 full source sets). Validator and tests. Deploy to GitHub Pages after you approve the repo. STOP with full output.
- **Stage 2.** Apps Script, SETUP.md, login, queue, inbox, restore, `docs/DATA_CONTRACT.md` (verbatim from the brief). End-to-end test with S99. STOP.
- **Stage 3.** Batches in the brief's order (`stage3Batch` 1–8 in `sections.json`). Each batch: section JSON, verification logs, media credits, full validator output. STOP after each.
- **Stage 4.** Timed papers, review queue, install guide with screenshots, full QA. STOP before the final deploy.
