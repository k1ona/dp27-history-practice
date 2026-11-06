// App start: theme, storage persistence, service worker and routing.
import { db, requestPersistence } from "./db.js";
import { route } from "./router.js";
import { toast } from "./util.js";
import { updateSyncStatus } from "./sync.js";

function applyTheme() {
  let t = null;
  try { t = localStorage.getItem("theme"); } catch { /* private mode */ }
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme();
window.addEventListener("dp27-theme", applyTheme);

async function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    const notify = (w) => {
      w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) {
          toast("A new version is ready. Close and reopen the app to use it.", 8000);
        }
      });
    };
    if (reg.installing) notify(reg.installing);
    reg.addEventListener("updatefound", () => reg.installing && notify(reg.installing));
  } catch (e) {
    console.warn("Service worker registration failed", e);
  }
}

async function boot() {
  await registerWorker();
  requestPersistence();
  window.addEventListener("hashchange", route);
  window.addEventListener("online", updateSyncStatus);
  window.addEventListener("offline", updateSyncStatus);
  const profile = await db.get("profile", "me");
  if (!profile && !location.hash.startsWith("#/setup")) location.hash = "#/setup";
  await route();
  updateSyncStatus();
}

boot();
