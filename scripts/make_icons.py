#!/usr/bin/env python3
"""Draw the app icons (a plain monogram; no imagery). Run once: python scripts/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "app" / "icons"
OUT.mkdir(parents=True, exist_ok=True)


def font(size):
    for name in ("/System/Library/Fonts/Supplemental/Georgia Bold.ttf", "/System/Library/Fonts/Supplemental/Georgia.ttf",
                 "/Library/Fonts/Georgia.ttf", "DejaVuSerif-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def icon(size, pad_ratio=0.0, name="icon.png"):
    im = Image.new("RGB", (size, size), "#1f3a5f")
    d = ImageDraw.Draw(im)
    inner = int(size * (1 - 2 * pad_ratio))
    f1, f2 = font(int(inner * 0.36)), font(int(inner * 0.17))
    cx = size / 2
    d.text((cx, size * 0.45), "DP27", fill="#f7f5f0", font=f1, anchor="mm")
    d.text((cx, size * 0.68), "HISTORY", fill="#e09f3e", font=f2, anchor="mm")
    im.save(OUT / name)


icon(192, name="icon-192.png")
icon(512, name="icon-512.png")
icon(512, pad_ratio=0.12, name="icon-512-maskable.png")
icon(180, name="apple-touch-icon.png")
print("icons written to", OUT)
