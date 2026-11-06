#!/usr/bin/env python3
"""Build the static site into site/ and write the offline pre-cache manifest.

Usage: python scripts/build.py
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
CONTENT = ROOT / "content"
SITE = ROOT / "site"
BUDGET_BYTES = 80 * 1024 * 1024
IMAGE_WARN_BYTES = 220 * 1024
MAX_WIDTH = 1600


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    if SITE.exists():
        shutil.rmtree(SITE)
    shutil.copytree(APP, SITE)

    # Content: only what the app reads. Schemas and verification logs stay in the repository.
    out = SITE / "content"
    (out / "sections").mkdir(parents=True)
    (out / "_media").mkdir(parents=True)
    shutil.copy2(CONTENT / "sections.json", out / "sections.json")
    shutil.copy2(CONTENT / "_markbands.json", out / "_markbands.json")
    available = []
    for f in sorted((CONTENT / "sections").glob("*.json")):
        shutil.copy2(f, out / "sections" / f.name)
        available.append(f.stem)
    (out / "available.json").write_text(json.dumps({"sections": available}, indent=1) + "\n", encoding="utf-8")
    credits = CONTENT / "_media" / "credits.json"
    if credits.exists():
        shutil.copy2(credits, out / "_media" / "credits.json")
        for m in json.loads(credits.read_text(encoding="utf-8"))["media"]:
            src = ROOT / m["file"]
            dst = SITE / m["file"]
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    errors, warnings = [], []
    try:
        from PIL import Image
    except ImportError:
        Image = None
    files = []
    for p in sorted(SITE.rglob("*")):
        if not p.is_file() or p.name in ("sw.js", "precache-manifest.json") or p.name.startswith("."):
            continue
        rel = p.relative_to(SITE).as_posix()
        size = p.stat().st_size
        files.append({"path": rel, "bytes": size, "sha256": sha(p)})
        if p.suffix.lower() in (".webp", ".png", ".jpg", ".jpeg") and rel.startswith("content/_media/"):
            if size > IMAGE_WARN_BYTES:
                warnings.append(f"{rel}: {size // 1024} KB (target about 200 KB)")
            if Image is not None:
                with Image.open(p) as im:
                    if im.width > MAX_WIDTH:
                        errors.append(f"{rel}: {im.width}px wide (max {MAX_WIDTH})")
    total = sum(f["bytes"] for f in files)
    if total > BUDGET_BYTES:
        errors.append(f"total cached size {total / 1e6:.1f} MB exceeds 80 MB")
    version = hashlib.sha256("".join(f["sha256"] for f in files).encode()).hexdigest()[:12]
    (SITE / "precache-manifest.json").write_text(json.dumps({"version": version, "files": files}, indent=1) + "\n", encoding="utf-8")
    sw = (SITE / "sw.js").read_text(encoding="utf-8").replace("__VERSION__", version)
    (SITE / "sw.js").write_text(sw, encoding="utf-8")
    (SITE / ".nojekyll").write_text("", encoding="utf-8")

    print(f"Built site/ · version {version} · {len(files)} files · {total / 1e6:.2f} MB · sections with content: {', '.join(available) or 'none'}")
    for w in warnings:
        print(f"WARNING {w}")
    for e in errors:
        print(f"ERROR {e}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
