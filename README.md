# DP27 History Practice

An offline exam-practice app for IB DP History (legacy guide, first assessment 2017), class 12A.
Author: Ali Dukayev.

Each syllabus section has a context builder (a short reader with retrieval checkpoints) and exam-style
practice with feedback, redrafting and a completion rule. All content is bundled; after one online visit
the app works fully offline. Student work is stored on the device (IndexedDB) and can be exported.

All questions, models and source sets are teacher-constructed practice material, not IB publications.

## Working on the app

Requirements: Python 3.12 or later.

```
python3 -m venv .venv
.venv/bin/pip install jsonschema pillow pytest pytest-playwright
.venv/bin/python -m playwright install chromium webkit
```

| Task | Command |
|---|---|
| Check all content | `.venv/bin/python scripts/validate_content.py` (add `--repo` to scan the repository) |
| Build the site into `site/` | `.venv/bin/python scripts/build.py` |
| Serve it locally | `.venv/bin/python scripts/serve.py 8000`, then open http://127.0.0.1:8000/ |
| Run the tests | `.venv/bin/python -m pytest tests --browser chromium --browser webkit` |
| Convert an image | `.venv/bin/python scripts/optimise_images.py input.jpg content/_media/name.webp` |

To release a section, change its `status` in `content/sections.json` from `coming_up` to `taught`.

Images are archival photographs and cartoons with the licence recorded in `content/_media/credits.json`;
every fact is logged in `content/_verification/`.
