// Teacher mode (BUILD_PLAN §9): a PIN-protected, offline screen for importing students' exported
// work and jumping to the Register Sheet. Nothing here is synced; imported files stay in memory
// for this visit only, never written to this device's own IndexedDB.
import { el, toast, fmtDate } from "../util.js";
import { content } from "../content.js";

let unlocked = false;
const imported = new Map(); // studentId -> parsed dp27.export.v1 data

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkPin(cfg, pin) {
  return (await sha256Hex(`${cfg.teacherPinSalt}:${pin}`)) === cfg.teacherPinHash;
}

export async function teacherGate() {
  const cfg = await content.config();
  if (!cfg.teacherPinHash) {
    return el("div", { class: "card" }, el("h1", {}, "Teacher mode"),
      el("p", {}, "No teacher PIN is set up yet."),
      el("p", { class: "small muted" },
        "Open a terminal in the project folder and run: ",
        el("code", {}, "python3 scripts/set_teacher_pin.py YOUR-PIN"),
        ". Then commit, push and redeploy the site for the new PIN to take effect."));
  }
  if (unlocked) return teacherHome(cfg);
  const pin = el("input", { type: "password", id: "teacher-pin", inputmode: "numeric", autocomplete: "off" });
  const msg = el("p", { class: "bad", id: "teacher-pin-error", "aria-live": "polite" });
  const go = el("button", { type: "button", id: "teacher-unlock" }, "Unlock");
  const box = el("div", { class: "card" }, el("h1", {}, "Teacher mode"),
    el("p", {}, "Enter your teacher PIN."),
    el("label", { for: "teacher-pin" }, "PIN"), pin, msg,
    el("div", { class: "row", style: "margin-top:1rem" }, go));
  go.addEventListener("click", async () => {
    go.disabled = true;
    if (await checkPin(cfg, pin.value.trim())) {
      unlocked = true;
      box.replaceWith(await teacherHome(cfg));
    } else {
      msg.textContent = "That PIN is not right.";
      pin.value = "";
    }
    go.disabled = false;
  });
  pin.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
  return box;
}

async function teacherHome(cfg) {
  const root = el("div", {});
  const lock = el("button", { type: "button", class: "secondary", id: "teacher-lock" }, "Lock teacher mode");
  lock.addEventListener("click", () => { unlocked = false; imported.clear(); location.hash = "#/"; });
  root.append(el("div", { class: "row" }, el("h1", {}, "Teacher mode"), el("span", { class: "spacer" }), lock));

  root.append(el("div", { class: "card" }, el("h2", { style: "margin-top:0" }, "Register"),
    cfg.registerUrl
      ? el("a", { class: "btn", href: cfg.registerUrl, target: "_blank", rel: "noopener" }, "Open the Register Sheet")
      : el("p", { class: "small muted" }, "No register link is set yet. Add registerUrl in app/config.json.")));

  const file = el("input", { type: "file", id: "teacher-import", accept: "application/json,.json", multiple: true });
  const list = el("div", { id: "teacher-students" });
  file.addEventListener("change", async () => {
    for (const f of file.files) {
      try {
        const data = JSON.parse(await f.text());
        if (data.schema !== "dp27.export.v1") throw new Error(`${f.name} is not a DP27 export file.`);
        imported.set(data.studentId || f.name, data);
      } catch (e) { toast(String(e.message || e)); }
    }
    file.value = "";
    await renderStudents(list);
  });
  root.append(el("div", { class: "card" }, el("h2", { style: "margin-top:0" }, "Import exported work"),
    el("p", {}, "Import one or more students' exported work files (downloaded from their Settings screen). Kept only for this visit, never saved to this device."),
    file, list));
  await renderStudents(list);
  return root;
}

async function renderStudents(list) {
  const map = await content.map();
  const title = (id) => map.sections.find((s) => s.sectionId === id)?.title || id;
  list.replaceChildren();
  if (!imported.size) { list.append(el("p", { class: "small muted" }, "No files imported yet.")); return; }
  for (const [studentId, data] of imported) list.append(studentCard(studentId, data, title));
}

function studentCard(studentId, data, title) {
  const reading = (data.stores.reading || []).map(({ k, v }) => ({ sectionId: k, ...v }));
  const attempts = (data.stores.attempts || []).map((x) => x.v).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = attempts.map((a) => el("tr", {},
    el("td", {}, fmtDate(a.createdAt)), el("td", {}, title(a.sectionId)), el("td", {}, a.taskType), el("td", {}, String(a.draft)),
    el("td", {}, a.local?.scored ? `${a.local.scored.met}/${a.local.scored.total}` : "—"), el("td", {}, String(a.wordCount))));
  const details = attempts.map((a) => el("details", {},
    el("summary", {}, `${title(a.sectionId)} · ${a.taskType} · Draft ${a.draft}`),
    el("p", {}, el("em", {}, a.questionText)),
    el("div", { style: "white-space:pre-wrap;border:1px solid var(--border,#ccc);padding:8px;margin:.4rem 0" }, a.responseText),
    ...(a.local?.points || []).map((p) => el("p", { class: "small" }, `• ${p.quote ? `“${p.quote}” — ` : ""}${p.missing} ${p.action}`))));
  return el("details", { class: "card", open: true },
    el("summary", {}, el("strong", {}, studentId || "(no student ID)"), " · ", attempts.length, " attempt", attempts.length === 1 ? "" : "s",
      " · imported ", fmtDate(data.exportedAt)),
    el("h3", {}, "Context read"),
    reading.length
      ? el("ul", { class: "small" }, ...reading.map((r) => el("li", {}, `${title(r.sectionId)}: ${(r.chunksRead || []).length} chunk(s)`)))
      : el("p", { class: "small muted" }, "No reading progress recorded."),
    el("h3", {}, "Attempts"),
    rows.length
      ? el("div", { class: "table-wrap" }, el("table", { class: "grid-table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Date"), el("th", {}, "Section"), el("th", {}, "Task"), el("th", {}, "Draft"),
            el("th", {}, "Checklist"), el("th", {}, "Words"))),
          el("tbody", {}, ...rows)))
      : el("p", { class: "small muted" }, "No attempts recorded."),
    ...details);
}
