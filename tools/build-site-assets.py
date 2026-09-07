#!/usr/bin/env python3
"""Build site/assets/ from the rendered token previews.

Input : dist/metadata/previews/<id4>.png   (100 stills, 1600x900, from
        tools/build-metadata.py), dist/metadata/summary.csv (the `lum`
        column), docs/active/token-metadata-v1.json (ids per family).
Output: site/assets/
          families/<scene>.jpg        1600x900 q80   one hero per family
          families/<scene>-thumb.jpg   640x360 q80
          tokens/<id4>.jpg             400x225 q75   all 100
          posters/enter.jpg, piece.jpg 1600x900       the whirlpool / collision hero
          og.jpg                      1200x630       crop of the strongest hero
          favicon.svg                                 a dot and a thin ring, #8ab4ff

Python 3 + Pillow, nothing else.  See site/README.md.

    python3 tools/build-site-assets.py            # build everything, print sizes
    python3 tools/build-site-assets.py --emit-data  # print the families/ids JS for content.js
"""

import argparse
import csv
import json
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PREVIEWS = REPO / "dist" / "metadata" / "previews"
SUMMARY = REPO / "dist" / "metadata" / "summary.csv"
ARCHIVE = REPO / "docs" / "active" / "token-metadata-v1.json"
OUT = REPO / "site" / "assets"
BUDGET = 12 * 1024 * 1024  # SITE_PLAN.md §2: the whole site/assets/ under 12 MB

# Plan order (SITE_PLAN.md §2).
ORDER = [
    "quiet-drift", "dust-storm", "coma", "lattice", "orrery", "milky-way",
    "sombrero", "horsehead", "collision", "whirlpool", "cartwheel", "antennae",
    "stephans-quintet", "bullet-cluster", "virgo-m87", "sagittarius",
    "event-horizon",
]

# Representative id per family.  Default: the brightest preview by the
# `lum` column of summary.csv.  Overrides where the brightest still does
# not read as the family at a glance — the reasons are in site/README.md.
PICKS = {
    "lattice": 78,    # #1 is brighter but is the crystal after it gives way; #78 is the crystal
    "virgo-m87": 53,  # #99 is a near-tie in lum, off-centre; #53 is centred and shows the jet
}

# Chapter posters: chapter key -> the family whose hero is the frame.
POSTERS = {"enter": "whirlpool", "piece": "collision"}
# The social card is a text-free crop of this family's hero.
OG_FAMILY = "milky-way"

ACCENT = "#8ab4ff"
HERO = (1600, 900)
THUMB = (640, 360)
TOKEN = (400, 225)
OG = (1200, 630)

FAVICON = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="4.5" fill="{ACCENT}"/>
  <circle cx="16" cy="16" r="12" fill="none" stroke="{ACCENT}" stroke-width="1.25"/>
</svg>
"""


def load_ids():
    """scene -> [ids] from the identity archive, in id order."""
    data = json.loads(ARCHIVE.read_text(encoding="utf-8"))
    by = {}
    for t in data["tokens"]:
        by.setdefault(t["scene"], []).append(int(t["id"]))
    missing = [s for s in ORDER if s not in by]
    extra = sorted(set(by) - set(ORDER))
    if missing or extra:
        sys.exit(f"identity table / ORDER mismatch: missing {missing}, extra {extra}")
    total = sum(len(v) for v in by.values())
    if total != 100:
        sys.exit(f"expected 100 tokens in the archive, found {total}")
    return {s: sorted(by[s]) for s in ORDER}


def load_lum():
    with SUMMARY.open(encoding="utf-8") as f:
        return {int(r["id"]): float(r["lum"]) for r in csv.DictReader(f)}


def pick(scene, ids, lum):
    if scene in PICKS:
        chosen = PICKS[scene]
        if chosen not in ids:
            sys.exit(f"PICKS[{scene!r}] = {chosen} is not a {scene} token ({ids})")
        return chosen
    return max(ids, key=lambda i: (lum[i], -i))


def preview(i):
    p = PREVIEWS / f"{i:04d}.png"
    if not p.exists():
        sys.exit(f"missing preview {p}")
    im = Image.open(p)
    if im.mode != "RGB":
        im = im.convert("RGB")
    if im.size != HERO:
        im = im.resize(HERO, Image.LANCZOS)
    return im


def save_jpeg(im, path, quality, size=None):
    if size and im.size != size:
        im = im.resize(size, Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "JPEG", quality=quality, optimize=True, progressive=True)
    return path.stat().st_size


def crop_to(im, size):
    """Scale to cover `size`, then centre-crop."""
    sw, sh = size
    scale = max(sw / im.width, sh / im.height)
    w, h = round(im.width * scale), round(im.height * scale)
    im = im.resize((w, h), Image.LANCZOS)
    x, y = (w - sw) // 2, (h - sh) // 2
    return im.crop((x, y, x + sw, y + sh))


def fmt(n):
    return f"{n / 1024:7.0f} KB"


def emit_data(ids, lum):
    """The per-family id lists as they appear in site/content.js."""
    for s in ORDER:
        print(f'  {s + ":":18s} {json.dumps(ids[s])}  // hero #{pick(s, ids[s], lum)}')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--emit-data", action="store_true",
                    help="print the families/ids table for content.js and exit")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    ids = load_ids()
    lum = load_lum()
    if args.emit_data:
        emit_data(ids, lum)
        return

    out = args.out
    sizes = {"families": 0, "tokens": 0, "posters": 0, "og": 0, "favicon": 0}
    heroes = {}
    print(f"{'family':18s} {'hero':>5s}  {'hero.jpg':>10s}  {'thumb.jpg':>10s}")
    for s in ORDER:
        rep = pick(s, ids[s], lum)
        heroes[s] = rep
        im = preview(rep)
        h = save_jpeg(im, out / "families" / f"{s}.jpg", 80)
        t = save_jpeg(im, out / "families" / f"{s}-thumb.jpg", 80, THUMB)
        sizes["families"] += h + t
        print(f"{s:18s} #{rep:<4d} {fmt(h)}  {fmt(t)}")

    for s in ORDER:
        for i in ids[s]:
            sizes["tokens"] += save_jpeg(preview(i), out / "tokens" / f"{i:04d}.jpg", 75, TOKEN)

    for key, fam in POSTERS.items():
        n = save_jpeg(preview(heroes[fam]), out / "posters" / f"{key}.jpg", 80)
        sizes["posters"] += n
        print(f"posters/{key}.jpg  <- {fam} #{heroes[fam]}  {fmt(n)}")

    og = crop_to(preview(heroes[OG_FAMILY]), OG)
    sizes["og"] = save_jpeg(og, out / "og.jpg", 82)
    print(f"og.jpg  <- {OG_FAMILY} #{heroes[OG_FAMILY]}  {fmt(sizes['og'])}")

    fav = out / "favicon.svg"
    fav.write_text(FAVICON, encoding="utf-8")
    sizes["favicon"] = fav.stat().st_size

    # Anything under site/assets/ that this run did not write.
    expected = set()
    for s in ORDER:
        expected |= {out / "families" / f"{s}.jpg", out / "families" / f"{s}-thumb.jpg"}
        expected |= {out / "tokens" / f"{i:04d}.jpg" for i in ids[s]}
    expected |= {out / "posters" / f"{k}.jpg" for k in POSTERS} | {out / "og.jpg", fav}
    strays = sorted(p for p in out.rglob("*") if p.is_file() and p not in expected)

    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print()
    for k, v in sizes.items():
        print(f"{k:10s} {fmt(v)}")
    print(f"{'total':10s} {fmt(total)}  ({total / 1048576:.2f} MB of {BUDGET / 1048576:.0f} MB)")
    if strays:
        print("not written by this run (stale?):", *[str(p.relative_to(out)) for p in strays])
    if total > BUDGET:
        sys.exit(f"site/assets is over the {BUDGET / 1048576:.0f} MB budget")


if __name__ == "__main__":
    main()
