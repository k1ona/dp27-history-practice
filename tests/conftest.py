"""Shared fixtures: build the site once, serve it on a free local port, and helpers for common steps."""
import json
import re
import subprocess
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import serve  # noqa: E402

GLASNOST = "P3-16-B4-GLASNOST"
P1 = "P1-CS2-CAUSES"


@pytest.fixture(scope="session")
def site_url():
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build.py")], check=True, capture_output=True)
    # Tests never talk to the real class server: device-only mode by default, a fake server where a test connects one.
    cfg_path = ROOT / "site" / "config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    cfg["syncEndpoint"] = ""
    cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    httpd = serve.make_server(0)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{port}/"
    httpd.shutdown()


@pytest.fixture(scope="session")
def content():
    def load(sid):
        return json.loads((ROOT / "content" / "sections" / f"{sid}.json").read_text(encoding="utf-8"))
    return {GLASNOST: load(GLASNOST), P1: load(P1)}


@pytest.fixture
def browser_context_args(browser_context_args):
    return {**browser_context_args, "viewport": {"width": 1024, "height": 1180}, "accept_downloads": True}


def setup_profile(page, site_url, sid="S99", level="HL"):
    page.goto(site_url)
    page.wait_for_selector("#save-profile")
    page.fill("#student-id", sid)
    page.select_option("#level", level)
    page.click("#save-profile")
    page.wait_for_selector("[data-section]")


def go(page, site_url, hash_):
    page.goto(site_url + hash_)
    page.wait_for_function("() => !document.querySelector('main p.muted') || document.querySelector('main').children.length > 1 || !document.querySelector('main').textContent.startsWith('Loading')")
    page.wait_for_timeout(150)


SEED_JS = """
async ({store, records}) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('dp27-history'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite'); const s = t.objectStore(store);
    for (const [k, v] of records) { if (k === null) s.put(v); else s.put(v, k); }
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  db.close();
  return true;
}
"""

READ_JS = """
async (store) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('dp27-history'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = await new Promise((res, rej) => { const t = db.transaction(store, 'readonly'); const q = t.objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  db.close();
  return all;
}
"""


def seed(page, store, records):
    page.evaluate(SEED_JS, {"store": store, "records": records})


def read_store(page, store):
    return page.evaluate(READ_JS, store)


def checkpoint_items(section):
    return [it for c in section["context"]["chunks"] for it in c["checkpoint"]]


def seed_gate(page, section, drills=False):
    """Mark every chunk read and every checkpoint (optionally every drill) as answered correctly."""
    chunks = [c["chunkId"] for c in section["context"]["chunks"]]
    seed(page, "reading", [[section["sectionId"], {"chunksRead": chunks, "prediction": "Partly.", "revisit": ""}]])
    items = checkpoint_items(section) + (section["drills"] if drills else [])
    seed(page, "itemResults", [[it["itemId"], {"best": 1, "last": 1, "history": []}] for it in items])


def answer_item(page, item, correct=True):
    """Answer an auto-marked item on screen (mcq-type, cloze) and press Check."""
    box = page.locator(f'[data-item="{item["itemId"]}"]')
    if item["type"] == "cloze":
        for b in item["blanks"]:
            box.locator("input").first.fill(str(b["answer"]) if correct else "0")
    else:
        opt = next(o for o in item["options"] if o["correct"] == correct)
        box.get_by_label(opt["text"], exact=True).check()
    box.locator("button.check").click()
    box.locator(".result").wait_for()


def submit_answer(page, text):
    page.fill("#answer", text)
    page.click("#submit-answer")
    page.wait_for_selector("#finish-selfcheck")


def finish_selfcheck(page, tap_first=False):
    """Self-check: either tap sentence 1 for every criterion or choose 'I can't find one' for each."""
    n = page.locator("[data-criterion]").count()
    for i in range(n):
        crit = page.locator("[data-criterion]").nth(i)
        if tap_first:
            crit.locator("[data-pick]").click()
            page.locator('[data-sentence="0"]').click()
        else:
            crit.locator("[data-none]").click()
    page.click("#finish-selfcheck")
    page.wait_for_selector("[data-status]")


ENDPOINT = "https://sync.example.test/exec"


class FakeServer:
    """Answers like apps_script/Code.gs: login, submit, progress, feedback, restore (same JSON protocol)."""

    def __init__(self, fail_submits=0, backup=None):
        self.pins = {"S99": "4821"}
        self.calls, self.submissions, self.progress, self.feedback = [], {}, [], []
        self.fail_submits, self.backup = fail_submits, backup

    def token(self, sid):
        return f"{sid}.1.signed"

    def handle(self, route):
        body = json.loads(route.request.post_data or "{}")
        self.calls.append(body)
        sid = body.get("studentId")
        authed = (body.get("pin") and self.pins.get(sid) == body.get("pin")) or (body.get("token") == self.token(sid))
        if not authed:
            return self.reply(route, {"ok": False, "error": "bad_credentials"})
        a = body.get("action")
        if a == "login":
            return self.reply(route, {"ok": True, "studentId": sid, "level": "HL", "token": self.token(sid),
                                      "hasBackup": self.backup is not None, "backupAt": "2026-11-05T10:00:00Z"})
        if a == "submit":
            if self.fail_submits > 0:
                self.fail_submits -= 1
                return route.fulfill(status=500, body="error")
            self.submissions[body["payload"]["submissionId"]] = body["payload"]
            return self.reply(route, {"ok": True})
        if a == "progress":
            self.progress.append(body["payload"])
            return self.reply(route, {"ok": True})
        if a == "feedback":
            return self.reply(route, {"ok": True, "feedback": [f for f in self.feedback if f["studentId"] == sid]})
        if a == "restore":
            return self.reply(route, {"ok": True, "backup": self.backup})
        return self.reply(route, {"ok": False, "error": "bad_action"})

    @staticmethod
    def reply(route, obj):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(obj))


def connect(context, server):
    """Point the app at the fake endpoint (service workers must be blocked so config.json can be intercepted)."""
    def cfg(route):
        body = json.loads(route.fetch().text())
        body["syncEndpoint"] = ENDPOINT
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    context.route(re.compile(r".*/config\.json$"), cfg)
    context.route(ENDPOINT + "*", server.handle)


def sign_in(page, site_url, code="12A", sid="S99", pin="4821", expect_dashboard=True):
    page.goto(site_url + "#/setup")
    page.wait_for_selector("#sign-in")
    page.fill("#class-code", code)
    page.fill("#student-id", sid)
    page.fill("#pin", pin)
    page.click("#sign-in")
    if expect_dashboard:
        page.wait_for_selector("[data-section]")
