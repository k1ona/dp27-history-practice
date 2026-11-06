#!/usr/bin/env python3
"""Convert an image to WebP for the app: at most 1600 px on the long side, about 200 KB, metadata stripped.

Usage: python scripts/optimise_images.py INPUT OUTPUT.webp [--target-kb 200]
"""
import argparse
import io
from pathlib import Path
from PIL import Image

MAX_SIDE = 1600


def convert(src: Path, dst: Path, target_kb: int) -> tuple[int, int, int, int]:
    with Image.open(src) as im:
        im = im.convert("RGB") if im.mode not in ("RGB", "L") else im
        scale = min(1.0, MAX_SIDE / max(im.size))
        if scale < 1:
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        for q in (82, 76, 70, 64, 58, 52, 46, 40):
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=q, method=6)
            if buf.tell() <= target_kb * 1024:
                break
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(buf.getvalue())
        return im.width, im.height, buf.tell(), q


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    ap.add_argument("--target-kb", type=int, default=200)
    a = ap.parse_args()
    w, h, size, q = convert(a.src, a.dst, a.target_kb)
    print(f"{a.dst}: {w}x{h}, {size // 1024} KB, quality {q}")
