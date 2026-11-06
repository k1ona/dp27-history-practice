"""End-to-end tests for the DP27 History practice app (Playwright + pytest).

Run: pytest tests --browser chromium --browser webkit
"""
import json
import re

import pytest
from playwright.sync_api import expect

from conftest import (GLASNOST, P1, answer_item, finish_selfcheck, read_store, seed, seed_gate, setup_profile,
                      submit_answer)

WEAK_PARAGRAPH = (
    "Gorbachev became the leader of the Soviet Union in 1985. In 1986 there was the disaster at Chernobyl. "
    "In 1988 there was a party conference in Moscow. Then in 1989 there were elections to a new Congress. "
    "Yeltsin's reforms in 1993 also showed that the party had lost control. The party collapsed in the end."
)

STRONG_PARAGRAPH = (
    "Openness under glasnost did most to destroy the authority of the Communist Party, because it ended the party's "
    "control over what people heard. Earlier steps, such as the release of Sakharov in December 1986 and the "
    "publication of Life and Fate in 1987, had already shown that the limits on discussion were moving. In May 1989 "
    "the Congress of People's Deputies was shown on live television for two weeks, which meant that attacks on the "
    "KGB and on Gorbachev reached millions of viewers. As a result the party could no longer claim that criticism "
    "came only from a few dissidents. However, democratisation also mattered, because without the contested "
    "elections of March 1989 there would have been no Congress to broadcast. Overall, glasnost was largely "
    "responsible for the loss of party authority, although it worked together with democratisation and could not "
    "have done so much on its own."
)


def open_app(page, site_url, level="HL"):
    setup_profile(page, site_url, level=level)


def wait_main(page, selector):
    page.wait_for_selector(selector)


# ---------------------------------------------------------------- offline
def test_offline_after_one_visit(page, context, site_url, content):
    open_app(page, site_url)
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    page.wait_for_function("() => !!navigator.serviceWorker.controller")
    context.set_offline(True)
    page.reload()
    wait_main(page, "[data-section]")
    expect(page.locator(f'[data-section="{GLASNOST}"]')).to_be_visible()
    page.goto(site_url + f"#/s/{GLASNOST}")
    expect(page.locator("h1")).to_contain_text("glasnost")
    # A chunk with an archival photograph renders, and the image loads from the cache.
    seed(page, "reading", [[GLASNOST, {"chunksRead": [], "prediction": "Partly.", "revisit": ""}]])
    page.goto(site_url + f"#/s/{GLASNOST}/read/3")
    img = page.locator("figure img").first
    img.wait_for()
    page.wait_for_function("(el) => el.complete && el.naturalWidth > 0", arg=img.element_handle())
    expect(page.locator("figure figcaption").first).to_contain_text("CC BY-SA")
    # A fresh tab in the same context, opened while offline, also starts the app (cold start).
    p2 = context.new_page()
    p2.goto(site_url + f"#/s/{P1}")
    expect(p2.locator("h1")).to_contain_text("German and Italian expansion")
    p2.close()


# ---------------------------------------------------------------- gating
def test_practice_gate_requires_reading_and_80_percent(page, site_url, content):
    sec = content[GLASNOST]
    open_app(page, site_url)
    page.goto(site_url + f"#/s/{GLASNOST}")
    expect(page.locator("[data-locked]")).to_be_visible()
    page.goto(site_url + f"#/s/{GLASNOST}/read/0")
    page.fill("#prediction", "Partly: it exposed weaknesses that already existed.")
    page.click("#save-prediction")
    wait_main(page, "svg.diagram")
    for k, chunk in enumerate(sec["context"]["chunks"]):
        page.goto(site_url + f"#/s/{GLASNOST}/read/{k + 2}")
        page.click("#start-checkpoint")
        expect(page.locator("article.chunk")).to_be_hidden()  # text hidden during retrieval
        for it in chunk["checkpoint"]:
            answer_item(page, it, correct=(k != 0))  # chunk 1 answered wrongly
    page.goto(site_url + f"#/s/{GLASNOST}")
    expect(page.locator("[data-locked]")).to_be_visible()
    expect(page.locator("[data-checkpoint]")).to_have_text("75%")
    # Retake checkpoint 1 correctly: best attempt counts, and the gate opens.
    page.goto(site_url + f"#/s/{GLASNOST}/items/checkpoint-K1")
    for it in sec["context"]["chunks"][0]["checkpoint"]:
        answer_item(page, it, correct=True)
    page.goto(site_url + f"#/s/{GLASNOST}")
    expect(page.locator("[data-locked]")).to_have_count(0)
    expect(page.locator("[data-checkpoint]")).to_have_text("100%")
    expect(page.locator("#practice a", has_text="Retrieval")).to_be_visible()


# ---------------------------------------------------------------- retry and redraft
def test_feedback_redraft_and_model_reveal(page, site_url, content):
    sec = content[GLASNOST]
    q = sec["essayQuestions"][0]
    open_app(page, site_url)
    seed_gate(page, sec)
    page.goto(site_url + f"#/s/{GLASNOST}/task/{q['questionId']}/paragraph")
    page.wait_for_selector("#answer")
    model_first = q["modelParagraph"]["segments"][0]["text"]
    assert model_first not in page.content(), "model must not be visible before submission"
    submit_answer(page, WEAK_PARAGRAPH)
    finish_selfcheck(page, tap_first=False)
    expect(page.locator("[data-status]")).to_contain_text("Checklist score, not an IB mark.")
    points = page.locator(".point")
    assert 2 <= points.count() <= 3
    expect(points.first.locator("q")).to_be_visible()
    expect(page.locator("[data-redraft-instruction]")).to_be_visible()
    assert "1993" in page.locator("main").inner_text(), "the out-of-timeframe year should be quoted"
    # Model is available after submission.
    page.click("#see-model")
    expect(page.locator("main")).to_contain_text(model_first)
    expect(page.locator("main")).to_contain_text("Plain-language paraphrase of the IB markbands")
    page.go_back()
    page.click("#redraft")
    page.wait_for_selector("#answer")
    expect(page.locator(".draft-old")).to_contain_text("Yeltsin")
    expect(page.locator(".draft-old mark.flag").first).to_be_visible()
    assert page.input_value("#answer").startswith("Gorbachev became the leader")
    submit_answer(page, STRONG_PARAGRAPH)
    finish_selfcheck(page, tap_first=True)
    fixed = page.locator("[data-fixed]")
    expect(fixed).to_contain_text("You fixed:")
    expect(fixed).to_contain_text("timeframe")
    expect(fixed).to_contain_text("judgement")
    attempts = read_store(page, "attempts")
    assert sorted(a["draft"] for a in attempts) == [1, 2]
    d2 = next(a for a in attempts if a["draft"] == 2)
    assert d2["parentSubmissionId"] == next(a for a in attempts if a["draft"] == 1)["submissionId"]
    assert d2["counted"] is True


def test_copy_guard_blocks_copied_redraft(page, site_url, content):
    sec = content[GLASNOST]
    q = sec["essayQuestions"][0]
    open_app(page, site_url)
    seed_gate(page, sec)
    page.goto(site_url + f"#/s/{GLASNOST}/task/{q['questionId']}/paragraph")
    page.wait_for_selector("#answer")
    submit_answer(page, WEAK_PARAGRAPH)
    finish_selfcheck(page)
    page.click("#redraft")
    page.wait_for_selector("#answer")
    copied = " ".join(s["text"] for s in q["modelParagraph"]["segments"])
    submit_answer(page, copied)
    finish_selfcheck(page)
    expect(page.locator("[data-copyguard]")).to_contain_text("Use your own words")
    page.goto(site_url + f"#/s/{GLASNOST}")
    expect(page.locator('[data-task="paragraph"]')).to_contain_text("redraft needed")


# ---------------------------------------------------------------- completion
def do_task_with_redraft(page, site_url, sid, qid, mode, text1, text2):
    page.goto(site_url + f"#/s/{sid}/task/{qid}/{mode}")
    page.wait_for_selector("#answer")
    submit_answer(page, text1)
    finish_selfcheck(page)
    page.click("#redraft")
    page.wait_for_selector("#answer")
    submit_answer(page, text2)
    finish_selfcheck(page)


def test_section_completion_rule(page, site_url, content):
    sec = content[GLASNOST]
    q = sec["essayQuestions"][1]
    open_app(page, site_url)
    seed_gate(page, sec, drills=True)
    page.goto(site_url + f"#/s/{GLASNOST}")
    expect(page.locator('[data-task="plan"]')).to_contain_text("Not yet")
    for mode in ("plan", "paragraph"):
        do_task_with_redraft(page, site_url, GLASNOST, q["questionId"], mode, WEAK_PARAGRAPH, STRONG_PARAGRAPH)
    page.goto(site_url + f"#/s/{GLASNOST}")
    expect(page.locator('[data-task="plan"]')).to_contain_text("Done")
    expect(page.locator('[data-task="essay"]')).to_contain_text("Not yet")
    page.goto(site_url)
    expect(page.locator(f'[data-section="{GLASNOST}"] .badge.done')).to_have_count(0)
    do_task_with_redraft(page, site_url, GLASNOST, q["questionId"], "essay", WEAK_PARAGRAPH, STRONG_PARAGRAPH + "\n\n" + STRONG_PARAGRAPH.replace("Openness", "Glasnost, or openness,"))
    page.goto(site_url)
    expect(page.locator(f'[data-section="{GLASNOST}"] .badge.done')).to_be_visible()
    expect(page.locator('[data-paper-progress="P3"]')).to_contain_text("1 of 22 sections complete")


def test_paper1_completion_needs_all_four_questions(page, site_url, content):
    sec = content[P1]
    s = sec["sourceSets"][0]
    open_app(page, site_url)
    seed_gate(page, sec, drills=True)
    text = ("Source A says the Nazis wanted to expand German territory. It also says they wanted the German race to be "
            "the most powerful nation. It says they wanted peace only to rearm.")
    for qq in s["questions"][:4]:  # Q1(a), Q1(b), Q2, Q3
        do_task_with_redraft(page, site_url, P1, qq["questionId"], qq["part"], text, text + " This is a further point.")
    page.goto(site_url + f"#/s/{P1}")
    expect(page.locator('[data-task="p1q1"]')).to_contain_text("Done")
    expect(page.locator('[data-task="p1q4"]')).to_contain_text("Not yet")
    page.goto(site_url)
    expect(page.locator(f'[data-section="{P1}"] .badge.done')).to_have_count(0)
    q4 = s["questions"][4]
    do_task_with_redraft(page, site_url, P1, q4["questionId"], q4["part"], text, text + " Source C and the Rhineland in 1936 support this.")
    page.goto(site_url)
    expect(page.locator(f'[data-section="{P1}"] .badge.done')).to_be_visible()


def test_sl_hides_paper3(page, site_url):
    open_app(page, site_url, level="SL")
    expect(page.locator('[data-paper="P3"]')).to_have_count(0)
    expect(page.locator('[data-paper="P1"]')).to_be_visible()
    expect(page.locator('[data-paper="P2"]')).to_be_visible()


def test_coming_up_badge_is_shown(page, site_url):
    open_app(page, site_url)
    card = page.locator('[data-section="P2-12-SINO"]')
    expect(card.locator(".badge.coming")).to_have_text("Coming up in class")


# ---------------------------------------------------------------- sync queue
def test_sync_queue_offline_then_retry(browser, site_url, content):
    ctx = browser.new_context(service_workers="block", viewport={"width": 1024, "height": 1180})
    calls = []

    def cfg(route):
        body = json.loads(route.fetch().text())
        body["syncEndpoint"] = "https://sync.example.test/exec"
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    def endpoint(route):
        calls.append(route.request.post_data)
        if len(calls) == 1:
            route.fulfill(status=500, body="error")
        else:
            route.fulfill(status=200, content_type="application/json", body='{"ok": true}')

    ctx.route(re.compile(r".*/config\.json$"), cfg)
    ctx.route("https://sync.example.test/**", endpoint)
    page = ctx.new_page()
    sec = content[GLASNOST]
    q = sec["essayQuestions"][0]
    setup_profile(page, site_url)
    seed_gate(page, sec)
    page.goto(site_url + f"#/s/{GLASNOST}/task/{q['questionId']}/plan")
    page.wait_for_selector("#answer")
    ctx.set_offline(True)
    submit_answer(page, WEAK_PARAGRAPH)
    finish_selfcheck(page)
    expect(page.locator("#sync-status")).to_have_text("Offline · 1 answer waiting to send")
    assert calls == []
    ctx.set_offline(False)
    page.wait_for_function("() => true")
    expect(page.locator("#sync-status")).to_have_text("1 answer waiting to send", timeout=10000)
    assert len(calls) == 1
    q_items = read_store(page, "syncQueue")
    assert len(q_items) == 1 and q_items[0]["tries"] == 1
    assert q_items[0]["nextAt"] > page.evaluate("Date.now()"), "a failed send waits for its backoff delay"
    page.evaluate("window.dispatchEvent(new Event('online'))")
    expect(page.locator("#sync-status")).to_have_text("All work sent", timeout=10000)
    assert len(calls) == 2
    sent = json.loads(calls[1])
    assert sent["action"] == "submit" and sent["studentId"] == "S99"
    assert sent["payload"]["schema"] == "dp27.submission.v1"
    assert sent["payload"]["taskType"] == "plan" and sent["payload"]["draft"] == 1
    assert "local" not in sent["payload"] and "counted" not in sent["payload"]
    assert read_store(page, "syncQueue") == []
    ctx.close()


# ---------------------------------------------------------------- export and restore
def test_export_and_restore(browser, page, site_url, content, tmp_path):
    sec = content[GLASNOST]
    q = sec["essayQuestions"][0]
    open_app(page, site_url)
    seed_gate(page, sec)
    page.goto(site_url + f"#/s/{GLASNOST}/task/{q['questionId']}/plan")
    page.wait_for_selector("#answer")
    submit_answer(page, WEAK_PARAGRAPH)
    finish_selfcheck(page)
    page.goto(site_url + "#/settings")
    downloads = []
    page.on("download", lambda d: downloads.append(d))
    page.click("#export-work")
    for _ in range(50):
        if len(downloads) >= 2:
            break
        page.wait_for_timeout(100)
    names = sorted(d.suggested_filename for d in downloads)
    assert len(names) == 2 and {n.rsplit(".", 1)[1] for n in names} == {"json", "html"}, names
    assert all(n.startswith("DP27-") and "S99" in n for n in names), names
    jpath = tmp_path / "work.json"
    next(d for d in downloads if d.suggested_filename.endswith(".json")).save_as(jpath)
    data = json.loads(jpath.read_text())
    assert data["schema"] == "dp27.export.v1" and len(data["stores"]["attempts"]) == 1
    hpath = tmp_path / "report.html"
    next(d for d in downloads if d.suggested_filename.endswith(".html")).save_as(hpath)
    assert "Checklist scores are not IB marks." in hpath.read_text()
    # Restore into a new, empty browser profile.
    ctx2 = browser.new_context()
    p2 = ctx2.new_page()
    setup_profile(p2, site_url)
    p2.goto(site_url + "#/settings")
    p2.set_input_files("#import-file", str(jpath))
    expect(p2.locator("#toast")).to_contain_text("restored")
    assert len(read_store(p2, "attempts")) == 1
    ctx2.close()


# ---------------------------------------------------------------- accessibility and layout
def test_checkpoint_by_keyboard(page, site_url, content):
    it = content[GLASNOST]["context"]["chunks"][0]["checkpoint"][0]
    open_app(page, site_url)
    page.goto(site_url + f"#/s/{GLASNOST}/items/checkpoint-K1")
    correct = next(o for o in it["options"] if o["correct"])
    box = page.locator(f'[data-item="{it["itemId"]}"]')
    box.get_by_label(correct["text"], exact=True).focus()
    page.keyboard.press("Space")
    box.locator("button.check").focus()
    page.keyboard.press("Enter")
    expect(box.locator(".result")).to_contain_text("Correct")


@pytest.mark.parametrize("size", [(768, 1024), (1024, 768), (1280, 800)], ids=["ipad-portrait", "ipad-landscape", "laptop-13"])
def test_no_horizontal_scroll(page, site_url, content, size):
    page.set_viewport_size({"width": size[0], "height": size[1]})
    open_app(page, site_url)
    seed_gate(page, content[P1])
    for h in ["", f"#/s/{GLASNOST}/read/0", f"#/s/{P1}", f"#/s/{P1}/task/P1-CS2-CAUSES-SS01-Q4/p1q4", f"#/s/{GLASNOST}/recall"]:
        page.goto(site_url + h)
        page.wait_for_timeout(500)
        over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert over <= 1, f"{h or 'dashboard'} overflows by {over}px at {size}"


def test_dark_mode(page, site_url):
    page.emulate_media(color_scheme="dark")
    open_app(page, site_url)
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    assert bg == "rgb(21, 23, 27)", bg
