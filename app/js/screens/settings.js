import { el, toast, download, escapeHtml, fmtDate } from "../util.js";
import { db } from "../db.js";
import { content } from "../content.js";
import { updateSyncStatus, api, flush, restoreFromServer, syncEnabled } from "../sync.js";

const SIGN_IN_ERRORS = {
  bad_credentials: "That student ID and PIN do not match. Check them with your teacher.",
  bad_student: "Your student ID looks like S01.",
  locked: "Too many wrong PINs. Wait an hour, then try again.",
  network: "The class server could not be reached. Check the internet connection and try again.",
  not_set_up: "The class server is not set up yet. Tell your teacher.",
};

export async function setup() {
  const cfg = await content.config();
  const existing = await db.get("profile", "me");
  if (!cfg.syncEndpoint) return localSetup(existing);
  const code = el("input", { type: "text", id: "class-code", autocomplete: "off", autocapitalize: "characters", value: existing ? cfg.classCode : "" });
  const id = el("input", { type: "text", id: "student-id", placeholder: "for example S01", autocomplete: "username", autocapitalize: "characters", value: existing?.studentId || "" });
  const pin = el("input", { type: "password", id: "pin", inputmode: "numeric", autocomplete: "current-password" });
  const msg = el("p", { class: "bad", id: "signin-error", "aria-live": "polite" });
  const go = el("button", { type: "button", id: "sign-in" }, "Sign in");
  const box = el("div", { class: "card" }, el("h1", {}, "Sign in"),
    el("p", {}, "Sign in once while you are online. After that the app works offline, and your work is sent to your teacher whenever you are connected."),
    el("label", { for: "class-code" }, "Class code"), code,
    el("label", { for: "student-id", style: "margin-top:.6rem" }, "Student ID"), id,
    el("p", { class: "small muted" }, "Your teacher gives you your student ID and PIN. Never type your name here."),
    el("label", { for: "pin", style: "margin-top:.6rem" }, "PIN"), pin,
    msg, el("div", { class: "row", style: "margin-top:1rem" }, go));
  go.addEventListener("click", async () => {
    msg.textContent = "";
    const sid = id.value.trim().toUpperCase();
    if (code.value.trim().toUpperCase() !== String(cfg.classCode).toUpperCase()) { msg.textContent = "That class code is not right."; return; }
    if (!/^S\d{2}$/.test(sid)) { msg.textContent = SIGN_IN_ERRORS.bad_student; return; }
    if (!pin.value.trim()) { msg.textContent = "Type your PIN."; return; }
    if (!navigator.onLine) { msg.textContent = "The first sign-in needs the internet. Connect, then try again."; return; }
    go.disabled = true;
    try {
      const r = await api("login", { studentId: sid, pin: pin.value.trim() });
      const profile = { ...(existing || {}), studentId: r.studentId, level: r.level, token: r.token, signedInAt: new Date().toISOString(),
        needsSignIn: false, createdAt: existing?.createdAt || new Date().toISOString() };
      await db.put("profile", profile, "me");
      pin.value = "";
      const localAttempts = (await db.all("attempts")).length;
      if (r.hasBackup && localAttempts === 0) { box.replaceWith(restorePrompt(r.backupAt)); return; }
      updateSyncStatus();
      flush({ force: true });
      location.hash = "#/";
    } catch (e) {
      msg.textContent = SIGN_IN_ERRORS[e.message] || "Sign-in did not work. Try again in a moment.";
    } finally {
      go.disabled = false;
    }
  });
  return box;
}

function restorePrompt(backupAt) {
  const yes = el("button", { type: "button", id: "restore-yes" }, "Restore my work");
  const no = el("button", { type: "button", class: "secondary", id: "restore-no" }, "Not now");
  const card = el("div", { class: "card" }, el("h1", {}, "Your saved work"),
    el("p", {}, `Work you saved on another device was found on the class drive${backupAt ? ` (last saved ${fmtDate(backupAt)})` : ""}. Restore it to this device?`),
    el("div", { class: "row" }, yes, no));
  yes.addEventListener("click", async () => {
    yes.disabled = true;
    try { await restoreFromServer(); toast("Your work has been restored."); } catch { toast("The backup could not be restored. Try again from Settings."); }
    updateSyncStatus();
    location.hash = "#/";
  });
  no.addEventListener("click", () => { location.hash = "#/"; });
  return card;
}

/** Before the class server is set up, the app can still be used on this device alone. */
function localSetup(existing) {
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
  const sync = await syncEnabled();
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
      el("p", {}, `Student ID: ${profile.studentId || "not set"}`),
      sync ? el("p", { class: "small" }, profile.token && !profile.needsSignIn ? "Signed in to the class server." : "Not signed in: your work is kept on this device until you sign in.") : null,
      sync ? null : el("label", { for: "settings-level" }, "Level"), sync ? el("p", {}, `Level: ${profile.level}`) : level,
      el("p", { class: "small" }, el("a", { href: "#/setup" }, sync ? "Sign in again" : "Change student ID"))),
    el("div", { class: "card" }, el("h2", { style: "margin-top:0" }, "Appearance"), el("label", { for: "theme" }, "Theme"), themeSel),
    el("div", { class: "card" }, el("h2", { style: "margin-top:0" }, "Back up your work"),
      el("p", {}, "Export a backup file (to restore your work) and a readable report. Keep the file somewhere safe, such as your school drive."),
      el("div", { class: "row" }, el("button", { type: "button", id: "export-work", onclick: exportWork }, "Export my work")),
      el("h3", {}, "Restore from a backup file"), file,
      sync && profile.token ? el("div", {}, el("h3", {}, "Restore from the class drive"),
        el("p", { class: "small" }, "Brings back the work you last sent from any device."),
        el("button", { type: "button", class: "secondary", id: "restore-server", onclick: async (ev) => {
          ev.target.disabled = true;
          try { (await restoreFromServer()) ? toast("Your work has been restored.") : toast("No saved work was found on the class drive."); }
          catch { toast("Restore needs the internet and a signed-in account."); }
          ev.target.disabled = false; updateSyncStatus();
        } }, "Restore from the class drive")) : null),
    el("div", { class: "card" }, el("h2", { style: "margin-top:0" }, "Storage"),
      el("p", {}, persist?.granted ? "This device has agreed to keep your work (persistent storage is on)." :
        "Persistent storage is not confirmed on this device. Export your work regularly."),
      est ? el("p", { class: "small muted" }, `Using about ${Math.round((est.usage || 0) / 1e6)} MB.`) : null,
      el("p", { class: "small muted" }, `App version ${cfg.appVersion}.`)));
}

export async function exportWork() {
  const stores = await db.dumpAll();
  stores.profile = (stores.profile || []).map(({ k, v }) => ({ k, v: { ...v, token: undefined, needsSignIn: undefined } }));
  stores.syncQueue = [];
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
