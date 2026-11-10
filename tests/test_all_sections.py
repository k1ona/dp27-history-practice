"""Smoke test for every section that has a content file: the section page, the visuals and every reading chunk render,
and every archival image used in a chunk loads with its credit line.

Run: pytest tests --browser chromium --browser webkit
"""
import json
from pathlib import Path

import pytest
from playwright.sync_api import expect

from conftest import seed, setup_profile

ROOT = Path(__file__).resolve().parent.parent
FILES = sorted((ROOT / "content" / "sections").glob("*.json"))
RECORDS = {r["sectionId"]: r for r in json.loads((ROOT / "content" / "sections.json").read_text(encoding="utf-8"))["sections"]}


@pytest.mark.parametrize("path", FILES, ids=[p.stem for p in FILES])
def test_section_renders(page, site_url, path):
    sec = json.loads(path.read_text(encoding="utf-8"))
    sid = sec["sectionId"]
    setup_profile(page, site_url)
    page.goto(site_url + f"#/s/{sid}")
    expect(page.locator("h1")).to_contain_text(RECORDS[sid]["title"][:20])
    seed(page, "reading", [[sid, {"chunksRead": [], "prediction": "A first guess.", "revisit": ""}]])
    page.goto(site_url + f"#/s/{sid}/read/1")
    page.wait_for_selector("svg.diagram")
    for k, chunk in enumerate(sec["context"]["chunks"]):
        page.goto(site_url + f"#/s/{sid}/read/{k + 2}")
        expect(page.locator("article.chunk")).to_contain_text(chunk["title"])
        if chunk.get("media"):
            img = page.locator("figure img").first
            img.wait_for()
            page.wait_for_function("(el) => el.complete && el.naturalWidth > 0", arg=img.element_handle())
            expect(page.locator("figure figcaption").first).to_be_visible()
