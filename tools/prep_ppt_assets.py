#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Prepare local, cropped image assets for the full project deck."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "tools" / "_logs"
OUT = ROOT / "docs" / "ppt_assets"
OUT.mkdir(parents=True, exist_ok=True)

CREAM = (243, 237, 224)


def clean_app(path: Path) -> Image.Image:
    """Remove the top-right phone shortcut and the bottom ICP strip from app screenshots."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    # The launcher is a small white capsule at the very top-right; replace it with a
    # blurred sample of the adjacent background, then trim the ICP strip.
    patch = im.crop((w - 430, 18, w - 220, 145)).filter(ImageFilter.GaussianBlur(16))
    im.paste(patch, (w - 230, 18))
    return im.crop((0, 0, w, h - 58))


def fit(src: Path, size: tuple[int, int], focus=(0.5, 0.5), clean: bool = False) -> Image.Image:
    im = clean_app(src) if clean else Image.open(src).convert("RGB")
    return ImageOps.fit(im, size, method=Image.LANCZOS, centering=focus)


def tint(im: Image.Image, color=(29, 45, 52), alpha: int = 0,
         left_alpha: int = 0, right_alpha: int = 0) -> Image.Image:
    """Darken with a horizontal ink gradient (left -> right), plus flat alpha."""
    im = im.convert("RGBA")
    w, h = im.size
    overlay = Image.new("RGBA", (w, h), color + (0,))
    px = overlay.load()
    for x in range(w):
        t = x / max(1, w - 1)
        a = int(left_alpha + (right_alpha - left_alpha) * t)
        a = min(255, max(0, a + alpha))
        for y in range(h):
            px[x, y] = color + (a,)
    return Image.alpha_composite(im, overlay).convert("RGB")


def save(im: Image.Image, name: str, quality: int = 92) -> None:
    path = OUT / name
    if path.suffix.lower() in (".jpg", ".jpeg"):
        im.save(path, quality=quality, optimize=True)
    else:
        im.save(path, optimize=True)
    print("%-28s %sx%s %.0f KB" % (name, im.width, im.height, path.stat().st_size / 1024))


def phone_cutout(src: Path, name: str) -> None:
    # Shell bbox measured on the 2880x1800 screenshot: x 1114..1765, y 270..1529.
    pad = 6
    box = (1114 - pad, 270 - pad, 1765 + pad + 1, 1529 + pad + 1)
    im = Image.open(src).convert("RGB").crop(box)
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    # Outer shell has a generous corner radius; 74px matches the device.
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=76, fill=255)
    rgba = im.convert("RGBA")
    rgba.putalpha(mask)
    # Soft drop shadow placed on a larger transparent canvas.
    canvas = Image.new("RGBA", (w + 90, h + 90), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((48, 58, 48 + w, 58 + h), radius=76, fill=(24, 35, 40, 78))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.alpha_composite(rgba, (45, 45))
    save(canvas, name)


def main() -> None:
    # 16:9, 1920-wide plates (scene-only shots have no launcher / ICP strip)
    cover = tint(fit(LOGS / "W_5_024.png", (2200, 1238), (0.55, 0.5)),
                 alpha=38, left_alpha=205, right_alpha=82)
    save(cover, "cover_wall.jpg")

    section = tint(fit(LOGS / "J_5_020.png", (2200, 1238), (0.5, 0.5)),
                   alpha=45, left_alpha=205, right_alpha=135)
    save(section, "section_court.jpg")

    closing = tint(fit(LOGS / "SH_022.png", (2200, 1238), (0.5, 0.5)),
                   alpha=24, left_alpha=222, right_alpha=52)
    save(closing, "closing_shop.jpg")

    save(fit(LOGS / "W_5_024.png", (1800, 1013), (0.55, 0.5)), "wall.jpg")
    save(fit(LOGS / "C_final3_026.png", (1800, 1013), (0.5, 0.5)), "court.jpg")
    save(fit(LOGS / "S0r2_018.png", (1500, 844), (0.5, 0.5)), "duty.jpg")
    save(fit(LOGS / "S0r2_018.png", (900, 1200), (0.52, 0.55)), "background_hall.jpg")

    # Portrait crop for the prompt slide: wall scene, focused on the wall + people.
    save(fit(LOGS / "W_5_024.png", (840, 1120), (0.57, 0.47)), "wall_portrait.jpg")
    # Portrait for the "why not cards" slide.
    why = tint(fit(LOGS / "W_5_024.png", (900, 1200), (0.53, 0.50)),
               alpha=30, left_alpha=28, right_alpha=90)
    save(why, "why_portrait.jpg")

    # Phone cutouts.
    phone_cutout(LOGS / "APP_phone_home.png", "phone_home.png")

    # Evaluation card and replay strip.
    src = Image.open(LOGS / "G_review.png").convert("RGB")
    im = src.crop((554, 233, 894, 678))
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=14, fill=255)
    im = im.convert("RGBA")
    im.putalpha(mask)
    canvas = Image.new("RGBA", (w + 44, h + 44), (0, 0, 0, 0))
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((22, 26, 22 + w, 26 + h), radius=14,
                                         fill=(24, 35, 40, 46))
    canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(8)))
    canvas.alpha_composite(im, (20, 20))
    save(canvas, "score_card.png")

    im = Image.open(LOGS / "H_replay.png").convert("RGB").crop((160, 320, 1280, 570))
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=10, fill=255)
    im = im.convert("RGBA")
    im.putalpha(mask)
    save(im, "replay_strip.png")
    # Map phone page, cut out with the same generic rounded mask (approx bbox).
    src = Image.open(LOGS / "E_phone_map.png").convert("RGB")
    # This screenshot's device is smaller; crop tightly, then round the corners.
    box = (566, 160, 874, 742)
    im = src.crop(box)
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=34, fill=255)
    im = im.convert("RGBA")
    im.putalpha(mask)
    canvas = Image.new("RGBA", (w + 56, h + 56), (0, 0, 0, 0))
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((28, 34, 28 + w, 34 + h), radius=34,
                                         fill=(24, 35, 40, 58))
    canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(9)))
    canvas.alpha_composite(im, (26, 26))
    save(canvas, "phone_map.png")


if __name__ == "__main__":
    main()
