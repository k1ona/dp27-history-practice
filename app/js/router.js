// Hash routes, so deep links work on GitHub Pages and offline.
import { el } from "./util.js";
import { dashboard } from "./screens/dashboard.js";
import { sectionHome } from "./screens/section.js";
import { reader, recallSheet } from "./screens/reader.js";
import { itemSet } from "./screens/itemset.js";
import { writtenTask } from "./screens/task.js";
import { attemptScreen } from "./screens/attempt.js";
import { settings, setup } from "./screens/settings.js";
import { inbox } from "./screens/inbox.js";

const routes = [
  [/^#\/?$/, () => dashboard()],
  [/^#\/setup$/, () => setup()],
  [/^#\/settings$/, () => settings()],
  [/^#\/inbox$/, () => inbox()],
  [/^#\/s\/([^/]+)$/, (m) => sectionHome(m[1])],
  [/^#\/s\/([^/]+)\/read(?:\/(\d+))?$/, (m) => reader(m[1], Number(m[2] || 0))],
  [/^#\/s\/([^/]+)\/recall$/, (m) => recallSheet(m[1])],
  [/^#\/s\/([^/]+)\/items\/(retrieval|drills|checkpoint-[A-Z0-9]+)$/, (m) => itemSet(m[1], m[2])],
  [/^#\/s\/([^/]+)\/task\/([^/]+)\/(plan|paragraph|essay|p1q1a|p1q1b|p1q2|p1q3|p1q4)(?:\/redraft\/([^/]+))?$/,
    (m) => writtenTask(m[1], m[2], m[3], m[4] || null)],
  [/^#\/attempt\/([^/]+)(?:\/(selfcheck|feedback|model))?$/, (m) => attemptScreen(m[1], m[2] || "feedback")],
];

let navToken = 0;

export async function route() {
  const main = document.getElementById("main");
  const hash = location.hash || "#/";
  const token = ++navToken; // a slower, older screen must never overwrite a newer one
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      main.replaceChildren(el("p", { class: "muted" }, "Loading…"));
      try {
        const view = await fn(m);
        if (token !== navToken) return;
        main.replaceChildren(view);
      } catch (e) {
        if (token !== navToken) return;
        console.error(e);
        main.replaceChildren(el("div", { class: "card" }, el("h1", {}, "Something went wrong"),
          el("p", {}, String(e.message || e)), el("a", { href: "#/" }, "Back to the dashboard")));
      }
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      return;
    }
  }
  main.replaceChildren(el("div", { class: "card" }, el("h1", {}, "Page not found"), el("a", { href: "#/" }, "Back to the dashboard")));
}
