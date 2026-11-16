"""End-to-end tests for timed full papers and daily/weekly spaced review (BUILD_PLAN §5.3, §7).

Run: pytest tests --browser chromium --browser webkit
"""
import re

from playwright.sync_api import expect

from conftest import GLASNOST, finish_selfcheck, read_store, seed, seed_gate, setup_profile
from test_app import STRONG_PARAGRAPH, WEAK_PARAGRAPH, do_task_with_redraft

P1_PAPER = "P1-CS1-A"
P1_SECTION = "P1-CS1-CAUSES"


def open_app(page, site_url, level="HL"):
    setup_profile(page, site_url, level=level)


def fill_timed_textareas(page, texts):
    tas = page.locator("main textarea")
    for i, text in enumerate(texts):
        tas.nth(i).fill(text)


def walk_timed_parts(page, n):
    """From the first part's self-check through to the summary page, answering every criterion
    'I can't find one' at each part, following the 'Next part' / 'Finish this timed paper' link."""
    for _ in range(n):
        finish_selfcheck(page)
        expect(page.locator("[data-timed-paper]")).to_be_visible()
        if page.locator("#timed-next").count():
            page.click("#timed-next")
            page.wait_for_selector("[data-criterion]")
        else:
            page.click("#timed-finish")
    page.wait_for_url(re.compile(r"#/timed/summary/"))


# ---------------------------------------------------------------- curation / coming-up badges
def test_timed_paper_coming_up_badges_reflect_taught_status(page, site_url):
    """Regression test for the prefer_taught() fix in project_docs/builders/timed_papers_build.py:
    a paper is only flagged "coming up" when it has no choice but to draw on untaught content."""
    open_app(page, site_url)
    page.goto(site_url + "#/timed")
    for cs in (1, 2):
        for letter in "ABC":
            expect(page.locator(f'[data-timed-paper-id="P1-CS{cs}-{letter}"] .badge.coming')).to_have_count(0)
    # Every Topic 9 section is still "coming_up" in content/sections.json, so every P2 paper must draw on one.
    for letter in "ABCDEF":
        expect(page.locator(f'[data-timed-paper-id="P2-{letter}"] .badge.coming')).to_be_visible()
    # §16/§17/§18 each have enough taught sections, so no P3 paper needs to draw on a "coming_up" one.
    for letter in "ABCDEF":
        expect(page.locator(f'[data-timed-paper-id="P3-{letter}"] .badge.coming')).to_have_count(0)


def test_timed_hides_paper3_for_sl(page, site_url):
    open_app(page, site_url, level="SL")
    page.goto(site_url + "#/timed")
    expect(page.locator("text=Paper 3 (150 minutes)")).to_have_count(0)
    expect(page.locator("text=Paper 1 (60 minutes)")).to_be_visible()
    expect(page.locator("text=Paper 2 (90 minutes)")).to_be_visible()


# ---------------------------------------------------------------- Paper 1 full round trip
def test_timed_paper1_full_round_trip(page, site_url):
    open_app(page, site_url)
    page.goto(site_url + f"#/timed/start/{P1_PAPER}")
    expect(page.locator(".sources")).to_have_count(0)  # not shown until the timer starts
    page.get_by_role("button", name="Start the timer").click()
    page.wait_for_selector("#submit-paper")
    expect(page.locator(".sources")).to_be_visible()
    expect(page.locator("main textarea")).to_have_count(5)
    fill_timed_textareas(page, [f"Timed answer {i}." for i in range(5)])
    page.click("#submit-paper")
    page.wait_for_selector("[data-criterion]")
    walk_timed_parts(page, 5)
    expect(page.locator("main li")).to_have_count(5)
    attempts = read_store(page, "attempts")
    assert len(attempts) == 5
    assert all(a["timed"] is True for a in attempts), "every part must carry timed: true for the marking system"
    assert {a["taskType"] for a in attempts} == {"p1q1a", "p1q1b", "p1q2", "p1q3", "p1q4"}, \
        "timed P1 parts use the ordinary taskTypes, never 'timed_p1' (Marking.gs has no branch for it)"
    assert all(a["sectionId"] == P1_SECTION for a in attempts)
    assert all(a["draft"] == 1 and a["afterFeedback"] is False for a in attempts), \
        "a timed-paper attempt alone never counts towards section completion (it is stamina practice)"
    sessions = read_store(page, "timed")
    assert len(sessions) == 1 and sessions[0]["submittedAt"] is not None and sessions[0]["paperId"] == P1_PAPER


def test_timed_second_paper_blocked_while_one_in_progress(page, site_url):
    open_app(page, site_url)
    page.goto(site_url + f"#/timed/start/{P1_PAPER}")
    page.get_by_role("button", name="Start the timer").click()
    page.wait_for_selector("#submit-paper")
    page.goto(site_url + "#/timed/start/P2-A")
    page.wait_for_url(re.compile(r"#/timed$"))
    expect(page.locator("[data-timed-active]")).to_contain_text("Resume it")


# ---------------------------------------------------------------- Paper 2 / Paper 3 selection
def test_timed_paper2_requires_one_essay_per_topic(page, site_url):
    open_app(page, site_url)
    page.goto(site_url + "#/timed/start/P2-A")
    go = page.get_by_role("button", name="Start the timer")
    expect(go).to_be_disabled()
    page.check("#pick-topic9-0")
    expect(go).to_be_disabled()
    page.check("#pick-topic12-0")
    expect(go).to_be_enabled()
    go.click()
    page.wait_for_selector("#submit-paper")
    expect(page.locator("main textarea")).to_have_count(2)
    fill_timed_textareas(page, ["Topic 9 essay answer.", "Topic 12 essay answer."])
    page.click("#submit-paper")
    page.wait_for_selector("[data-criterion]")
    walk_timed_parts(page, 2)
    attempts = read_store(page, "attempts")
    assert len(attempts) == 2
    assert all(a["timed"] is True and a["taskType"] == "essay" and a["paper"] == "P2" for a in attempts)
    assert {a["sectionId"] for a in attempts} == {"P2-9-SA-CONDITIONS", "P2-12-GRAND-ALLIANCE"}


def test_timed_paper3_requires_exactly_three_essays(page, site_url):
    open_app(page, site_url)
    page.goto(site_url + "#/timed/start/P3-A")
    go = page.get_by_role("button", name="Start the timer")
    expect(go).to_be_disabled()
    page.check("#pick-q-0")
    page.check("#pick-q-1")
    expect(go).to_be_disabled()
    page.check("#pick-q-2")
    expect(go).to_be_enabled()
    expect(page.locator("#pick-q-3")).to_be_disabled()  # a 4th choice is blocked once 3 are picked
    page.uncheck("#pick-q-2")
    expect(page.locator("#pick-q-3")).to_be_enabled()
    page.check("#pick-q-2")
    go.click()
    page.wait_for_selector("#submit-paper")
    expect(page.locator("main textarea")).to_have_count(3)
    fill_timed_textareas(page, ["§16 essay.", "§16 essay two.", "§16 essay three."])
    page.click("#submit-paper")
    page.wait_for_selector("[data-criterion]")
    walk_timed_parts(page, 3)
    attempts = read_store(page, "attempts")
    assert len(attempts) == 3
    assert all(a["timed"] is True and a["taskType"] == "essay" and a["paper"] == "P3" for a in attempts)


# ---------------------------------------------------------------- daily review / Leitner
def test_review_queue_updates_leitner_box(page, site_url, content):
    sec = content[GLASNOST]
    open_app(page, site_url)
    seed_gate(page, sec)  # marks the section "started" for the review queue
    page.goto(site_url + "#/review")
    page.wait_for_selector("text=Daily review")
    expect(page.locator("text=This week's unfamiliar question")).to_be_visible()
    # Only a shuffled slice of the pool is due in any one session, so pick whichever evidence
    # card actually landed in it rather than assuming a specific fact.
    card = page.locator("[data-fact]").first
    expect(card).to_be_visible()
    card.get_by_role("button", name="Show the fact").click()
    card.get_by_role("button", name="I recalled this").click()
    expect(card.locator(".result")).to_contain_text("Marked as recalled")
    # reviewed() writes to IndexedDB without the UI awaiting it, so poll briefly rather than
    # reading the store the instant the result text appears.
    leitner = []
    for _ in range(30):
        leitner = read_store(page, "leitner")
        if leitner:
            break
        page.wait_for_timeout(100)
    assert any(r.get("lastResult") == "correct" and r.get("box") == 0 for r in leitner)


def test_review_queue_shows_all_caught_up_when_nothing_due(page, site_url, content):
    sec = content[GLASNOST]
    open_app(page, site_url)
    seed_gate(page, sec)
    far_future = "2099-01-01T00:00:00.000Z"
    ids = [it["itemId"] for it in sec["retrieval"]] + [f["factId"] for f in sec["context"]["evidenceBank"]]
    seed(page, "leitner", [[i, {"box": 4, "dueAt": far_future, "lastResult": "correct", "lastAt": "2026-01-01T00:00:00.000Z"}] for i in ids])
    page.goto(site_url + "#/review")
    expect(page.locator("text=You're all caught up.")).to_be_visible()


def test_weekly_drill_requires_a_completed_p2_or_p3_section(page, site_url, content):
    sec = content[GLASNOST]
    q = sec["essayQuestions"][1]
    open_app(page, site_url)
    page.goto(site_url + "#/review/weekly")
    expect(page.locator("text=Complete a Paper 2 or Paper 3 section first")).to_be_visible()
    seed_gate(page, sec, drills=True)
    for mode in ("plan", "paragraph"):
        do_task_with_redraft(page, site_url, GLASNOST, q["questionId"], mode, WEAK_PARAGRAPH, STRONG_PARAGRAPH)
    do_task_with_redraft(page, site_url, GLASNOST, q["questionId"], "essay", WEAK_PARAGRAPH,
                          STRONG_PARAGRAPH + "\n\n" + STRONG_PARAGRAPH.replace("Openness", "Glasnost, or openness,"))
    page.goto(site_url + "#/review/weekly")
    expect(page.locator("text=Plan it now")).to_be_visible()
    link = page.locator('a:has-text("Plan it now")')
    href = link.get_attribute("href")
    assert href.startswith(f"#/s/{GLASNOST}/task/")
    assert href.endswith("/plan")
