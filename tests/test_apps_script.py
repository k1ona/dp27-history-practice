"""Tests for apps_script/Code.gs, run in a browser page against in-memory Apps Script stand-ins (tests/gas_harness.js)."""
import json
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
HARNESS = (ROOT / "tests" / "gas_harness.js").read_text(encoding="utf-8")
CODE = (ROOT / "apps_script" / "Code.gs").read_text(encoding="utf-8")


@pytest.fixture
def gas(page):
    page.set_content("<!doctype html><title>gas</title>")
    page.add_script_tag(content=HARNESS)
    page.add_script_tag(content=CODE)
    page.evaluate("PARENT_FOLDER_ID = 'root0'")
    ids = page.evaluate("setup()")
    # Students the teacher types in: two active students with new PINs, one inactive.
    page.evaluate("""() => {
      const rows = __gas.tab('Students');
      rows.push(['S99', 'Test Student', 'HL', '', true, '4821']);
      rows.push(['S98', 'Second Test', 'SL', '', true, '1111']);
      rows.push(['S97', 'Left the class', 'HL', '', false, '2222']);
      return hashNewPins();
    }""")

    class G:
        def __init__(self):
            self.page, self.ids = page, ids

        def post(self, body):
            return page.evaluate("(b) => __gas.post(b)", body)

        def get(self, params, path_info=None):
            return page.evaluate("([p, pi]) => __gas.get(p, pi)", [params, path_info])

        def tab(self, name):
            return page.evaluate("(n) => __gas.tab(n)", name)

        def files(self, key):
            return page.evaluate("(id) => __gas.filesIn(id)", self.ids[key])

        def call(self, js):
            return page.evaluate(js)

        def drop_feedback(self, fb, name=None):
            return page.evaluate("([id, n, c]) => __gas.dropFile(id, n, c)",
                                 [self.ids["feedback"], name or f"{fb['submissionId']}.feedback.json", json.dumps(fb)])

    return G()


def submission(student="S99", task="essay", paper="P3", **kw):
    s = {
        "schema": "dp27.submission.v1", "submissionId": str(uuid.uuid4()), "parentSubmissionId": None, "studentId": student,
        "level": "HL", "sectionId": "P3-16-B4-GLASNOST", "questionId": "P3-16-B4-GLASNOST-Q01", "paper": paper, "taskType": task,
        "draft": 1, "questionText": "To what extent…?", "commandTerm": "to what extent", "namedFactor": "glasnost",
        "timeframe": [1985, 1991], "sourceSetId": None, "responseText": "An answer.", "responses": [], "wordCount": 2,
        "minutesSpent": 5, "timed": False, "autoCheck": {"met": ["timeframe"], "notMet": ["judgement"], "details": []},
        "selfCheck": {"met": [], "notMet": ["counter"]}, "createdAt": "2026-11-06T10:00:00Z", "appVersion": "0.2.0",
    }
    s.update(kw)
    return s


def feedback(sub, mark=None, out_of=15, written="2026-11-06T12:00:00Z"):
    return {
        "schema": "dp27.feedback.v1", "submissionId": sub["submissionId"], "studentId": sub["studentId"],
        "placement": {"type": "band", "value": "10–12 quality", "outOf": 15},
        "points": [{"quote": "An answer.", "missing": "a judgement", "action": "End with a weighed judgement."}],
        "redraftInstruction": "Rewrite your last sentence so it weighs glasnost against democratisation.",
        "improved": None, "forwardTarget": "Name the factor in every topic sentence.",
        "markForPrediction": mark, "markOutOf": out_of, "writtenAt": written,
    }


def login(g, sid="S99", pin="4821"):
    r = g.post({"action": "login", "studentId": sid, "pin": pin})
    assert r["ok"], r
    return r["token"]


def test_hash_known_vector(page):
    page.set_content("<!doctype html><title>x</title>")
    page.add_script_tag(content=HARNESS)
    assert page.evaluate("__gas.sha256hex('abc')") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_setup_creates_folders_tabs_settings_and_trigger(gas):
    folders = gas.call("Object.values(__gas.folders).map(f => f.name)")
    for name in ["DP27 Practice", "Submissions", "Feedback", "Backups"]:
        assert name in folders
    tabs = gas.call("Object.values(__gas.sheets)[0].tabs.map(t => t.name)")
    assert tabs == ["Students", "Submissions", "Feedback", "Progress", "Predicted", "Settings"]
    settings = {r[0]: (r[1], r[2]) for r in gas.tab("Settings")[1:]}
    assert settings["weight.HL.P3"] == (0.35, "verify against the legacy guide")
    assert settings["weight.SL.IA"] == (0.25, "verify against the legacy guide")
    assert settings["boundary.7"] == (86, "placeholder; replace with session boundaries")
    assert settings["boundary.2"][0] == 26
    assert "74/100" in settings["reference.Nov2025.HL7"][1]
    assert gas.call("__gas.triggers") == [{"fn": "hourly", "h": 1}]
    assert any("Register sheet" in line for line in gas.call("__logs"))


def test_pins_are_stored_hashed(gas):
    rows = gas.tab("Students")[1:]
    for row in rows:
        assert row[5] == "", "the typed PIN is cleared"
        assert len(row[3]) == 64 and row[3] not in ("4821", "1111", "2222")


def test_login_checks_pin_and_issues_token(gas):
    assert gas.post({"action": "login", "studentId": "S99", "pin": "0000"}) == {"ok": False, "error": "bad_credentials"}
    r = gas.post({"action": "login", "studentId": "S99", "pin": "4821"})
    assert r["ok"] and r["level"] == "HL" and r["hasBackup"] is False and r["token"].startswith("S99.")
    assert gas.post({"action": "login", "studentId": "S98", "pin": "1111"})["level"] == "SL"
    assert gas.post({"action": "login", "studentId": "S97", "pin": "2222"})["error"] == "bad_credentials", "inactive students are refused"
    assert gas.post({"action": "feedback", "studentId": "S99", "token": r["token"]})["ok"]
    assert gas.post({"action": "feedback", "studentId": "S98", "token": r["token"]})["error"] == "bad_credentials", "a token only works for its own student"


def test_repeated_wrong_pins_lock_the_account(gas):
    for _ in range(10):
        gas.post({"action": "login", "studentId": "S98", "pin": "9999"})
    assert gas.post({"action": "login", "studentId": "S98", "pin": "1111"})["error"] == "locked"


def test_submit_saves_file_and_row_once(gas):
    token = login(gas)
    s = submission()
    r = gas.post({"action": "submit", "studentId": "S99", "token": token, "payload": s})
    assert r == {"ok": True, "submissionId": s["submissionId"]}
    files = gas.files("submissions")
    assert [f["name"] for f in files] == [s["submissionId"] + ".json"]
    assert json.loads(files[0]["content"]) == s
    rows = gas.tab("Submissions")
    header = rows[0]
    assert len(rows) == 2 and rows[1][header.index("feedbackStatus")] == "pending"
    assert rows[1][header.index("timeframe")] == "1985–1991"
    again = gas.post({"action": "submit", "studentId": "S99", "token": token, "payload": s})
    assert again["duplicate"] is True and len(gas.tab("Submissions")) == 2, "a retried send is not stored twice"


def test_submit_rejections(gas):
    token = login(gas)
    other = submission(student="S98")
    assert gas.post({"action": "submit", "studentId": "S99", "token": token, "payload": other})["error"] == "wrong_student"
    assert gas.post({"action": "submit", "studentId": "S99", "token": token, "payload": {"schema": "x"}})["error"] == "bad_schema"
    big = submission(responseText="x" * 210_000)
    assert gas.post({"action": "submit", "studentId": "S99", "token": token, "payload": big})["error"] == "too_large"
    gas.call("(() => { const rows = __gas.tab('Settings'); rows.find(r => r[0] === 'limit.submitsPerHour')[1] = 2; })()")
    for _ in range(2):
        assert gas.post({"action": "submit", "studentId": "S99", "token": token, "payload": submission()})["ok"]
    assert gas.post({"action": "submit", "studentId": "S99", "token": token, "payload": submission()})["error"] == "rate_limited"


def test_progress_backup_and_restore(gas):
    token = login(gas)
    payload = {"schema": "dp27.progress.v1", "studentId": "S99", "level": "HL",
               "sections": [{"sectionId": "P3-16-B4-GLASNOST", "chunksRead": "4/4", "checkpoint": 1, "drills": 0.9, "tasksDone": 1, "tasksTotal": 3, "complete": False}],
               "backup": {"schema": "dp27.export.v1", "stores": {"attempts": [{"k": "a", "v": {"submissionId": "a"}}]}}}
    assert gas.post({"action": "progress", "studentId": "S99", "token": token, "payload": payload})["ok"]
    payload["sections"][0]["tasksDone"] = 2
    assert gas.post({"action": "progress", "studentId": "S99", "token": token, "payload": payload})["ok"]
    assert [f["name"] for f in gas.files("backups")] == ["S99.json"], "one backup file per student, overwritten"
    prog = gas.tab("Progress")
    assert len(prog) == 2 and prog[1][7] == 2, "one progress row per student and section, updated in place"
    r = gas.post({"action": "restore", "studentId": "S99", "token": token})
    assert r["backup"]["stores"]["attempts"][0]["v"]["submissionId"] == "a"
    assert gas.post({"action": "login", "studentId": "S99", "pin": "4821"})["hasBackup"] is True
    assert gas.get({"path": "restore", "studentId": "S99", "pin": "4821"})["backup"]["schema"] == "dp27.export.v1"
    assert gas.post({"action": "restore", "studentId": "S98", "pin": "1111"})["backup"] is None, "students never see another backup"


def test_feedback_ingestion_release_hold_and_stripping(gas):
    token = login(gas)
    s1, s2 = submission(), submission(task="paragraph")
    s3 = submission(student="S98", paper="P2")
    for s, who, tok in [(s1, "S99", token), (s2, "S99", token), (s3, "S98", login(gas, "S98", "1111"))]:
        assert gas.post({"action": "submit", "studentId": who, "token": tok, "payload": s})["ok"]
    assert gas.post({"action": "feedback", "studentId": "S99", "token": token})["feedback"] == []
    # The teacher puts the paragraph on hold before its feedback arrives.
    gas.call(f"""(() => {{ const rows = __gas.tab('Submissions'); const h = rows[0];
        rows.find(r => r[h.indexOf('submissionId')] === '{s2['submissionId']}')[h.indexOf('feedbackStatus')] = 'hold'; }})()""")
    gas.drop_feedback(feedback(s1, mark=11))
    gas.drop_feedback(feedback(s2, mark=8))
    gas.drop_feedback(feedback(s3, mark=9))
    bad = feedback(s1, mark=3)
    bad["studentId"] = "S98"
    gas.drop_feedback(bad, name="mismatch.feedback.json")
    result = gas.call("ingestFeedback()")
    assert result["ingested"] == 3 and len(result["problems"]) == 1 and "does not match" in result["problems"][0]
    assert gas.call("ingestFeedback()")["ingested"] == 0, "files are ingested once"
    mine = gas.post({"action": "feedback", "studentId": "S99", "token": token})["feedback"]
    assert [f["submissionId"] for f in mine] == [s1["submissionId"]], "held feedback is not released"
    assert "markForPrediction" not in mine[0] and "markOutOf" not in mine[0]
    assert mine[0]["redraftInstruction"].startswith("Rewrite your last sentence")
    other = gas.post({"action": "feedback", "studentId": "S98", "pin": "1111"})["feedback"]
    assert [f["submissionId"] for f in other] == [s3["submissionId"]]
    via_get = gas.get({"studentId": "S99", "pin": "4821"}, "feedback")["feedback"]
    assert [f["submissionId"] for f in via_get] == [s1["submissionId"]]
    fb_rows = gas.tab("Feedback")
    assert fb_rows[0].index("markForPrediction") and any(r[6] == 11 for r in fb_rows[1:]), "the mark is kept for the teacher"
    assert all("markForPrediction" not in r[-1] for r in fb_rows[1:]), "stored student-facing JSON has no mark"


def test_predicted_grades(gas):
    token = login(gas)
    marks = [("essay", "P3", 11, 15), ("essay", "P3", 12, 15), ("essay", "P3", 9, 15), ("essay", "P2", 10, 15), ("essay", "P2", 12, 15),
             ("p1q4", "P1", 7, 9), ("p1q4", "P1", 6, 9), ("paragraph", "P3", 2, 15), ("plan", "P2", 1, 15)]
    for i, (task, paper, m, out_of) in enumerate(marks):
        s = submission(task=task, paper=paper)
        assert gas.post({"action": "submit", "studentId": "S99", "token": token, "payload": s})["ok"]
        gas.drop_feedback(feedback(s, mark=m, out_of=out_of, written=f"2026-11-06T12:{i:02d}:00Z"))
    s = submission(student="S98", paper="P2")
    assert gas.post({"action": "submit", "studentId": "S98", "pin": "1111", "payload": s})["ok"]
    gas.drop_feedback(feedback(s, mark=10))
    gas.call("ingestFeedback()")
    rows = gas.call("updatePredicted()")
    s99 = next(r for r in rows if r[0] == "S99")
    assert s99[4] == pytest.approx(72.2) and s99[7] == pytest.approx(73.3) and s99[10] == pytest.approx(71.1)
    assert s99[5] == 2 and s99[8] == 2 and s99[11] == 3, "plans and paragraphs are not counted"
    assert s99[13] == "insufficient data", "no IA mark yet"
    # The teacher enters the IA mark; it survives the next rebuild.
    gas.call("(() => { const rows = __gas.tab('Predicted'); rows.find(r => r[0] === 'S99')[12] = 20; })()")
    s99 = next(r for r in gas.call("updatePredicted()") if r[0] == "S99")
    # 0.20*72.22 + 0.25*73.33 + 0.35*71.11 + 0.20*80 = 73.67 → grade 5 on the placeholder scale
    assert s99[12] == 20 and s99[13] == pytest.approx(73.7) and s99[14] == 5
    s98 = next(r for r in gas.call("updatePredicted()") if r[0] == "S98")
    assert s98[6] == "insufficient data" and s98[3] == "insufficient data" and s98[9] == "—", "fewer than 2 marks; SL has no Paper 3"
