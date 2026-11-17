"""End-to-end tests for Teacher mode (BUILD_PLAN §9): PIN gate, importing exported work, the
register link.

Run: pytest tests --browser chromium --browser webkit
"""
import json
import re

from playwright.sync_api import expect

from conftest import GLASNOST, TEACHER_PIN, setup_profile


def goto_teacher(page, site_url):
    page.goto(site_url + "#/teacher")
    page.wait_for_selector("h1")


def unlock(page, site_url, pin=TEACHER_PIN):
    goto_teacher(page, site_url)
    page.fill("#teacher-pin", pin)
    page.click("#teacher-unlock")


def test_wrong_pin_is_rejected(page, site_url):
    setup_profile(page, site_url)
    unlock(page, site_url, pin="9999")
    expect(page.locator("#teacher-pin-error")).to_have_text("That PIN is not right.")
    expect(page.locator("#teacher-import")).to_have_count(0)


def test_correct_pin_unlocks_teacher_mode(page, site_url):
    setup_profile(page, site_url)
    unlock(page, site_url)
    expect(page.locator("text=Import exported work")).to_be_visible()
    expect(page.get_by_role("link", name="Open the Register Sheet")).to_be_visible()
    expect(page.locator("text=No files imported yet.")).to_be_visible()


def test_no_register_url_shows_setup_note(context, site_url):
    def cfg(route):
        body = json.loads(route.fetch().text())
        body["registerUrl"] = ""
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    context.route(re.compile(r".*/config\.json$"), cfg)
    page = context.new_page()
    setup_profile(page, site_url)
    unlock(page, site_url)
    expect(page.locator("text=No register link is set yet.")).to_be_visible()
    expect(page.get_by_role("link", name="Open the Register Sheet")).to_have_count(0)
    page.close()
    context.unroute(re.compile(r".*/config\.json$"))


def test_no_pin_set_shows_setup_instructions(context, site_url):
    def cfg(route):
        body = json.loads(route.fetch().text())
        body["teacherPinHash"] = ""
        body["teacherPinSalt"] = ""
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    context.route(re.compile(r".*/config\.json$"), cfg)
    page = context.new_page()
    setup_profile(page, site_url)
    goto_teacher(page, site_url)
    expect(page.locator("text=No teacher PIN is set up yet.")).to_be_visible()
    expect(page.locator("code")).to_contain_text("set_teacher_pin.py")
    page.close()
    context.unroute(re.compile(r".*/config\.json$"))


def test_lock_requires_the_pin_again(page, site_url):
    setup_profile(page, site_url)
    unlock(page, site_url)
    page.click("#teacher-lock")
    page.wait_for_url(re.compile(r"#/?$"))
    goto_teacher(page, site_url)
    expect(page.locator("#teacher-pin")).to_be_visible()
    expect(page.locator("#teacher-import")).to_have_count(0)


def test_import_exported_work_shows_attempts_and_reading(page, site_url, tmp_path):
    setup_profile(page, site_url)
    export = {
        "schema": "dp27.export.v1", "exportedAt": "2026-11-16T10:00:00.000Z", "studentId": "S07",
        "stores": {
            "reading": [{"k": GLASNOST, "v": {"chunksRead": ["K1", "K2"], "prediction": "Partly.", "revisit": ""}}],
            "attempts": [{"k": "11111111-1111-4111-8111-111111111111", "v": {
                "submissionId": "11111111-1111-4111-8111-111111111111", "sectionId": GLASNOST,
                "questionId": "P3-16-B4-GLASNOST-Q01", "taskType": "plan", "draft": 1,
                "createdAt": "2026-11-16T09:00:00.000Z", "questionText": "q", "responseText": "My plan for glasnost.",
                "wordCount": 4, "local": {"points": [{"missing": "a judgement", "action": "Add one."}],
                                           "scored": {"met": 2, "total": 7}}}}],
        },
    }
    f = tmp_path / "DP27-work-S07.json"
    f.write_text(json.dumps(export), encoding="utf-8")
    unlock(page, site_url)
    page.set_input_files("#teacher-import", str(f))
    card = page.locator("#teacher-students details").first
    expect(card).to_contain_text("S07")
    expect(card).to_contain_text("1 attempt")
    expect(card).to_contain_text("2 chunk(s)")
    expect(card.locator("table")).to_contain_text("plan")
    expect(card.locator("table")).to_contain_text("2/7")
    expect(card).to_contain_text("My plan for glasnost.")


def test_import_rejects_a_non_export_file(page, site_url, tmp_path):
    setup_profile(page, site_url)
    f = tmp_path / "not-an-export.json"
    f.write_text(json.dumps({"schema": "something.else"}), encoding="utf-8")
    unlock(page, site_url)
    page.set_input_files("#teacher-import", str(f))
    expect(page.locator("#toast")).to_contain_text("not a DP27 export file")
    expect(page.locator("text=No files imported yet.")).to_be_visible()
