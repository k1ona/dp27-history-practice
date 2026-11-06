"""Shared fixtures: build the site once, serve it on a free local port, and helpers for common steps."""
import json
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
