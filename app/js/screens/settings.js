import { el, toast, download, escapeHtml, fmtDate } from "../util.js";
import { db } from "../db.js";
import { content } from "../content.js";
import { updateSyncStatus } from "../sync.js";

export async function setup() {
  const existing = await db.get("profile", "me");
  const id = el("input", { type: "text", id: "student-id", placeholder: "for example S01", value: existing?.studentId || "", autocomplete: "off",
    pattern: "S[0-9]{2}", "aria-describedby": "id-help" });
  const level = el("select", { id: "level" }, el("option", { value: "HL" }, "HL (Papers 1, 2 and 3)"), el("option", { value: "SL" }, "SL (Papers 1 and 2)"));
  if (existing) level.value = existing.level;
  const go = el("button", { type: "button", id: "save-profile" }, "Start");
  go.addEventListener("click", async () => {
    const sid = id.value.trim().toUpperCase();
    if (sid && !/^S\d{2}$/.test(sid)) { toast("Your student ID looks like S01. Leave it empty if you do not know it yet."); return; }
    await db.put("profile", { ...(existing || {}), studentId: sid, level: level.value, createdAt: existing?.createdAt || new Date().toISOString() }, "me");
    location.hash = "#/";
  });
  return el("div", { class: "card" }, el("h1", {}, "Welcome"),
    el("p", {}, "This app works offline. Your work is saved on this device and can be exported as a backup at any time."),
    el("label", { for: "student-id" }, "Student ID"), id,
    el("p", { id: "id-help", class: "small muted" }, "Your teacher gives you this ID. Never type your name here."),
    el("label", { for: "level", style: "margin-top:.6rem" }, "Level"), level,
    el("div", { class: "row", style: "margin-top:1rem" }, go));
}

export async function settings() {
  const profile = (await db.get("profile", "me")) || { level: "HL" };
  const cfg = await content.config();
  const persist = await db.get("meta", "persist");
  let est = null;
  try { est = await navigator.storage.estimate(); } catch { /* unsupported */ }
  const level = el("select", { id: "settings-level" }, el("option", { value: "HL" }, "HL"), el("option", { value: "SL" }, "SL"));
  level.value = profile.level;
  level.addEventListener("change", async () => { profile.level = level.value; await db.put("profile", profile, "me"); toast(`Level set to ${level.value}.`); });
  let theme = "auto";
  try { theme = localStorage.getItem("theme") || "auto"; } catch { /* ignore */ }
  const themeSel = el("select", { id: "theme" }, el("option", { value: "auto" }, "Match the device"), el("option", { value: "light" }, "Light"), el("option", { value: "dark" }, "Dark"));
  themeSel.value = theme;
  themeSel.addEventListener("change", () => {
    try { themeSel.value === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", themeSel.value); } catch { /* ignore */ }
    window.dispatchEvent(new Event("dp27-theme"));
  });
  const file = el("input", { type: "file", id: "import-file", accept: "application/json,.json" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.schema !== "dp27.export.v1") throw new Error("This is not a DP27 export file.");
      await db.restore(data.stores, { skip: ["profile"] });
      toast("Your work has been restored.");
      updateSyncStatus();
    } catch (e) { toast(String(e.message || e)); }
  });
  return el("div", {}, el("h1", {}, "Settings"),
    el("div", { class: "card" }, el("h2", { style: "margin-top:0" }, "Profile"),
      el("p", {}, `Student ID: ${profile.studentId || "not set"}`), el("label", { for: "settings-level" }, "Level"), level,
      el("p", { class: "small" }, el("a", { href: "#/setup" }, "Change student ID"))),
    el("div", { class: "card" }, el("h2", { style: "margin-top:0" }, "Appearance"), el("label", { for: "theme" }, "Theme"), themeSel),
    el("div", { class: "card" }, el("h2", { style: "margin-top:0" }, "Back up your work"),
      el("p", {}, "Export a backup file (to restore your work) and a readable report. Keep the file somewhere safe, such as your school drive."),
      el("div", { class: "row" }, el("button", { type: "button", id: "export-work", onclick: exportWork }, "Export my work")),
      el("h3", {}, "Restore from a backup file"), file),
    el("div", { class: "card" }, el("h2", { style: "margin-top:0" }, "Storage"),
      el("p", {}, persist?.granted ? "This device has agreed to keep your work (persistent storage is on)." :
        "Persistent storage is not confirmed on this device. Export your work regularly."),
      est ? el("p", { class: "small muted" }, `Using about ${Math.round((est.usage || 0) / 1e6)} MB.`) : null,
      el("p", { class: "small muted" }, `App version ${cfg.appVersion}.`)));
}

export async function exportWork() {
  const stores = await db.dumpAll();
  const profile = (await db.get("profile", "me")) || {};
  const stamp = new Date().toISOString().slice(0, 10);
  const who = profile.studentId || "student";
  const data = { schema: "dp27.export.v1", exportedAt: new Date().toISOString(), studentId: profile.studentId || "", stores };
  download(`DP27-work-${who}-${stamp}.json`, JSON.stringify(data, null, 1), "application/json");
  download(`DP27-report-${who}-${stamp}.html`, await htmlReport(data), "text/html");
}

async function htmlReport(data) {
  const map = await content.map();
  const title = (id) => map.sections.find((s) => s.sectionId === id)?.title || id;
  const attempts = data.stores.attempts.map((x) => x.v).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = attempts.map((a) => `<tr><td>${escapeHtml(fmtDate(a.createdAt))}</td><td>${escapeHtml(title(a.sectionId))}</td><td>${escapeHtml(a.taskType)}</td>
    <td>${a.draft}</td><td>${a.local?.scored ? `${a.local.scored.met}/${a.local.scored.total}` : "—"}</td><td>${a.wordCount}</td></tr>`).join("");
  const bodies = attempts.map((a) => `<section><h3>${escapeHtml(title(a.sectionId))} · ${escapeHtml(a.taskType)} · Draft ${a.draft}</h3>
    <p><em>${escapeHtml(a.questionText)}</em></p><div style="white-space:pre-wrap;border:1px solid #ccc;padding:8px">${escapeHtml(a.responseText)}</div>
    ${(a.local?.points || []).map((p) => `<p>• ${p.quote ? `“${escapeHtml(p.quote)}” — ` : ""}${escapeHtml(p.missing)} ${escapeHtml(p.action)}</p>`).join("")}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DP27 History work report</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}</style></head>
<body><h1>DP27 History work report</h1><p>Student ID: ${escapeHtml(data.studentId || "not set")} · exported ${escapeHtml(fmtDate(data.exportedAt))}</p>
<p>Checklist scores are not IB marks.</p>
<table><thead><tr><th>Date</th><th>Section</th><th>Task</th><th>Draft</th><th>Checklist</th><th>Words</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Answers</h2>${bodies}</body></html>`;
}
