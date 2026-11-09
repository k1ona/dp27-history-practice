"""Tests for the optional automatic-feedback file (apps_script/Marking.gs), with the remote service replaced by a stand-in.

The file is kept outside the public repository, so these tests are skipped when it is not present.
"""
import json
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MARKING = ROOT / "apps_script" / "Marking.gs"
pytestmark = pytest.mark.skipif(not MARKING.exists(), reason="optional private file not present")

HARNESS = (ROOT / "tests" / "gas_harness.js").read_text(encoding="utf-8")
CODE = (ROOT / "apps_script" / "Code.gs").read_text(encoding="utf-8")
SECTION = (ROOT / "content" / "sections" / "P3-16-B4-GLASNOST.json").read_text(encoding="utf-8")
P1 = (ROOT / "content" / "sections" / "P1-CS2-CAUSES.json").read_text(encoding="utf-8")
BANDS = (ROOT / "content" / "_markbands.json").read_text(encoding="utf-8")

ANSWER = ("Glasnost weakened the party because the Congress of People's Deputies was shown on live television in May 1989. "
          "This meant that criticism came from inside an official institution. The party collapsed in the end.")

STUB = """
window.__calls = [];
window.__replies = [];
window.UrlFetchApp = { fetch: (url, opts) => {
  const text = (s) => ({ getResponseCode: () => 200, getContentText: () => s });
  if (url.includes('content/sections/P3-16-B4-GLASNOST.json')) return text(window.__section);
  if (url.includes('content/sections/P1-CS2-CAUSES.json')) return text(window.__p1);
  if (url.includes('content/_markbands.json')) return text(window.__bands);
  window.__calls.push({ url, opts });
  const r = window.__replies.length ? window.__replies.shift() : { code: 500, body: { error: { message: 'no reply set' } } };
  return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body) };
} };
"""


def reply(out, stop="end_turn"):
    return {"code": 200, "body": {"stop_reason": stop, "content": [{"type": "text", "text": json.dumps(out)}]}}


@pytest.fixture
def g(page):
    page.set_content("<!doctype html><title>gas</title>")
    page.add_script_tag(content=HARNESS)
    page.add_script_tag(content=STUB)
    page.add_script_tag(content=CODE)
    page.add_script_tag(content=MARKING.read_text(encoding="utf-8"))
    page.evaluate("([s, p, b]) => { window.__section = s; window.__p1 = p; window.__bands = b; }", [SECTION, P1, BANDS])
    page.evaluate("PARENT_FOLDER_ID = 'root0'")
    ids = page.evaluate("setup()")
    page.evaluate("""() => { __gas.tab('Students').push(['S99', 'Test Student', 'HL', '', true, '4821']); hashNewPins();
      PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', 'test-key'); }""")

    class G:
        def __init__(self):
            self.page, self.ids = page, ids
            self.token = self.post({"action": "login", "studentId": "S99", "pin": "4821"})["token"]

        def post(self, body):
            return page.evaluate("(b) => __gas.post(b)", body)

        def submit(self, **kw):
            s = {"schema": "dp27.submission.v1", "submissionId": str(uuid.uuid4()), "parentSubmissionId": None, "studentId": "S99",
                 "level": "HL", "sectionId": "P3-16-B4-GLASNOST", "questionId": "P3-16-B4-GLASNOST-Q01", "paper": "P3",
                 "taskType": "essay", "draft": 1, "questionText": "To what extent was glasnost responsible…?",
                 "commandTerm": "to what extent", "namedFactor": "glasnost", "timeframe": [1985, 1991], "sourceSetId": None,
                 "responseText": ANSWER, "responses": [], "wordCount": 40, "minutesSpent": 20, "timed": False,
                 "autoCheck": {"met": [], "notMet": [], "details": []}, "selfCheck": {"met": [], "notMet": []},
                 "createdAt": "2026-11-09T09:00:00Z", "appVersion": "0.2.0"}
            s.update(kw)
            assert self.post({"action": "submit", "studentId": "S99", "token": self.token, "payload": s})["ok"]
            return s

        def queue(self, *replies):
            page.evaluate("(rs) => { window.__replies.push(...rs); }", list(replies))

        def run(self):
            return page.evaluate("writeAutomaticFeedback()")

        def calls(self):
            return page.evaluate("window.__calls")

        def tab(self, name):
            return page.evaluate("(n) => __gas.tab(n)", name)

        def feedback_files(self):
            return page.evaluate("(id) => __gas.filesIn(id)", self.ids["feedback"])

        def status_of(self, sub_id, column):
            rows = self.tab("Submissions")
            h = rows[0]
            return next(r for r in rows if r[h.index("submissionId")] == sub_id)[h.index(column)]

    return G()


GOOD = {"band": "7–9", "mark": 8,
        "points": [{"quote": "The party collapsed in the end.", "missing": "a judgement that weighs glasnost", "action": "End by saying how far glasnost was responsible."},
                   {"quote": "words the student never wrote", "missing": "x", "action": "y"}],
        "redraftInstruction": "Rewrite your last sentence so it weighs glasnost against democratisation.",
        "improved": None, "forwardTarget": None}


def test_writes_checked_feedback_for_a_new_essay(g):
    s = g.submit()
    g.queue(reply(GOOD))
    assert g.run()["written"] == 1
    files = g.feedback_files()
    assert [f["name"] for f in files] == [s["submissionId"] + ".feedback.json"]
    assert files[0]["description"] == "dp27-automatic-feedback"
    fb = json.loads(files[0]["content"])
    assert fb["schema"] == "dp27.feedback.v1" and fb["studentId"] == "S99"
    assert fb["placement"] == {"type": "mark", "value": "8 (7–9 band)", "outOf": 15}
    assert [p["quote"] for p in fb["points"]] == ["The party collapsed in the end."], "a quote not in the answer is dropped"
    assert fb["markForPrediction"] == 8 and fb["markOutOf"] == 15 and fb["improved"] is None
    assert g.status_of(s["submissionId"], "autoFeedback").startswith("done")
    # What was sent: the answer, the section's evidence and the rules; never the student's name or the key in the body.
    body = json.loads(g.calls()[0]["opts"]["payload"])
    sent = json.dumps(body)
    assert ANSWER in sent and "Congress of People's Deputies" in sent and "Test Student" not in sent and "test-key" not in sent
    assert body["output_config"]["format"]["type"] == "json_schema" and body["fallbacks"] == "default"
    assert g.calls()[0]["opts"]["headers"]["x-api-key"] == "test-key"
    # Code.gs releases it as automatic feedback, without the mark.
    assert g.page.evaluate("ingestFeedback()")["ingested"] == 1
    assert g.status_of(s["submissionId"], "feedbackStatus") == "ready"
    rows = g.tab("Feedback")
    assert rows[1][rows[0].index("source")] == "automatic"
    resp = g.post({"action": "feedback", "studentId": "S99", "token": g.token})
    assert resp.get("ok"), resp
    out = resp["feedback"]
    assert len(out) == 1 and "markForPrediction" not in out[0]


def test_plan_and_paper1_placements(g):
    plan = g.submit(taskType="plan", responseText="Thesis: glasnost largely caused it. 1) The party collapsed in the end.")
    p1 = g.submit(sectionId="P1-CS2-CAUSES", questionId="P1-CS2-CAUSES-SS01-Q1A", paper="P1", taskType="p1q1a",
                  commandTerm=None, namedFactor=None, timeframe=[1933, 1940], sourceSetId="P1-CS2-CAUSES-SS01",
                  responseText="Source A says the Nazis wanted to expand German territory. It says they wanted peace to rearm.")
    g.queue(reply({**GOOD, "mark": None, "band": "7-9"}),
            reply({"band": "points-based", "mark": 2, "points": [{"quote": "they wanted peace to rearm", "missing": "a third distinct point", "action": "Add the racial aim the source states."}],
                   "redraftInstruction": "Add one more distinct point from Source A.", "improved": None, "forwardTarget": None}))
    assert g.run()["written"] == 2
    by_id = {json.loads(f["content"])["submissionId"]: json.loads(f["content"]) for f in g.feedback_files()}
    assert by_id[plan["submissionId"]]["placement"] == {"type": "band", "value": "caps at 7–9 quality", "outOf": 15}
    assert by_id[plan["submissionId"]]["markForPrediction"] is None
    assert by_id[p1["submissionId"]]["placement"] == {"type": "mark", "value": "2", "outOf": 3}
    sent = json.loads(g.calls()[1]["opts"]["payload"])["messages"][0]["content"]
    assert "THE FOUR SOURCES" in sent and "Douglas Miller" in sent


def test_bad_replies_are_retried_then_given_up(g):
    s = g.submit()
    bad = {**GOOD, "points": [{"quote": "not in the answer at all", "missing": "x", "action": "y"}]}
    g.queue(reply(bad))
    g.run()
    assert g.status_of(s["submissionId"], "autoFeedback").startswith("retry 1:")
    g.queue(reply(GOOD, stop="refusal"))
    g.run()
    assert g.status_of(s["submissionId"], "autoFeedback").startswith("retry 2: declined")
    g.queue(reply({**GOOD, "mark": 22}))
    g.run()
    assert g.status_of(s["submissionId"], "autoFeedback").startswith("error: essay mark out of range")
    g.queue(reply(GOOD))
    g.run()
    assert g.feedback_files() == [] and len(g.calls()) == 3, "an answer in error is left for the teacher"


def test_skips_held_teacher_written_switched_off_and_capped(g):
    held = g.submit()
    rows = g.tab("Submissions")
    g.page.evaluate(f"""(() => {{ const rows = __gas.tab('Submissions'); const h = rows[0];
        rows.find(r => r[h.indexOf('submissionId')] === '{held['submissionId']}')[h.indexOf('feedbackStatus')] = 'hold'; }})()""")
    own = g.submit()
    g.page.evaluate("([id, n]) => __gas.dropFile(id, n, '{}')", [g.ids["feedback"], own["submissionId"] + ".feedback.json"])
    g.run()
    assert g.calls() == [], "held answers and answers the teacher already marked are skipped"
    g.page.evaluate("(() => { const r = __gas.tab('Settings').find(x => x[0] === 'autofeedback.enabled'); r[1] = false; })()")
    g.submit()
    g.run()
    assert g.calls() == [], "switched off in Settings"
    g.page.evaluate("""(() => { const s = __gas.tab('Settings');
        s.find(x => x[0] === 'autofeedback.enabled')[1] = true; s.find(x => x[0] === 'autofeedback.maxPerDay')[1] = 1; })()""")
    g.submit()
    g.queue(reply(GOOD), reply(GOOD))
    assert g.run()["written"] == 1, "the daily cap stops further marking"


def test_redraft_gets_redraft_feedback(g):
    d1 = g.submit()
    g.queue(reply(GOOD))
    g.run()
    g.page.evaluate("ingestFeedback()")
    better = ANSWER.replace("The party collapsed in the end.", "Glasnost was therefore largely responsible, more than democratisation.")
    d2 = g.submit(draft=2, parentSubmissionId=d1["submissionId"], responseText=better)
    g.queue(reply({"band": "10–12", "mark": 11, "points": [{"quote": "more than democratisation", "missing": "a criterion", "action": "Say by what test glasnost mattered more."}],
                   "redraftInstruction": "Add the criterion to your final sentence.",
                   "improved": "Your ending now weighs: \"largely responsible, more than democratisation\".", "forwardTarget": "Name the criterion every time you judge."}))
    g.run()
    fb = next(json.loads(f["content"]) for f in g.feedback_files() if d2["submissionId"] in f["name"])
    assert fb["improved"].startswith("Your ending now weighs") and fb["forwardTarget"] and fb["markForPrediction"] == 11
    sent = json.loads(g.calls()[-1]["opts"]["payload"])["messages"][0]["content"]
    assert "PREVIOUS DRAFT (draft 1)" in sent and "FEEDBACK GIVEN ON THE PREVIOUS DRAFT" in sent


def test_predicted_tab_shows_how_many_marks_are_automatic(g):
    for mark in (8, 11):
        g.submit()
    g.queue(reply({**GOOD, "mark": 8}), reply({**GOOD, "mark": 11}))
    g.run()
    g.page.evaluate("ingestFeedback()")
    rows = g.page.evaluate("updatePredicted()")
    s99 = next(r for r in rows if r[0] == "S99")
    assert s99[9] == 9.5 and s99[-1] == "2 of 2"
