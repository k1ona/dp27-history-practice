# Data contract

The interface between the DP27 practice app (through the Apps Script endpoint) and the system that writes feedback files.

```json
// Submission: Submissions/<submissionId>.json
{
  "schema": "dp27.submission.v1",
  "submissionId": "uuid",
  "parentSubmissionId": "uuid|null",
  "studentId": "S01",
  "level": "HL|SL",
  "sectionId": "P3-16-B4-GLASNOST",
  "questionId": "P3-16-B4-GLASNOST-Q03",
  "paper": "P1|P2|P3",
  "taskType": "plan|paragraph|essay|p1q1a|p1q1b|p1q2|p1q3|p1q4|timed_p1|timed_p2|timed_p3",
  "draft": 1,
  "questionText": "…",
  "commandTerm": "to what extent",
  "namedFactor": "…|null",
  "timeframe": [1985, 1991],
  "sourceSetId": "…|null",
  "responseText": "…",
  "responses": [{"questionId": "…", "text": "…"}],
  "wordCount": 0,
  "minutesSpent": 0,
  "timed": false,
  "autoCheck": {"met": ["evidence", "timeframe"], "notMet": ["judgement"], "details": []},
  "selfCheck": {"met": ["…"], "notMet": ["…"]},
  "createdAt": "ISO-8601",
  "appVersion": "x.y.z"
}
```

```json
// Feedback: Feedback/<submissionId>.feedback.json (written by the feedback system, not the app)
{
  "schema": "dp27.feedback.v1",
  "submissionId": "uuid",
  "studentId": "S01",
  "placement": {"type": "band|mark", "value": "10–12 quality", "outOf": 15},
  "points": [{"quote": "student's words", "missing": "…", "action": "…"}],
  "redraftInstruction": "…",
  "improved": "…|null",
  "forwardTarget": "…|null",
  "markForPrediction": 11,
  "markOutOf": 15,
  "writtenAt": "ISO-8601"
}
```

How the fields are used:
- `responses` is used for timed papers and Paper 1 sets, which have several answers. `responseText` is used for single tasks.
- `markForPrediction` is teacher-only. The Apps Script copies it to the `Predicted` tab and **strips it before returning feedback to the app**.
