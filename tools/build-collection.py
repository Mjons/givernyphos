#!/usr/bin/env python3
"""Collection viewer — one self-contained page for browsing the hundred.

Reads the identity table (docs/active/token-metadata-v1.json), the
metadata the generator wrote (dist/metadata/<id>.json, summary.csv) and
the previews (dist/metadata/previews), inlines a JPEG thumbnail per
token, and fills tools/collection-template.html into a single file that
opens from a folder, a gateway or the site:

  python3 tools/build-collection.py                 # → collection.html (live links ./index.html?id=N)
  python3 tools/build-collection.py --live-base https://<site>/giverny-phos/ \
      --artifact /path/to/artifact.html             # body-only copy for claude.ai

No build step for the app itself; this page is a derived artefact like
the token bundle. Run tools/build-metadata.py first.
"""
import argparse, base64, csv, io, json, os, re, time
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAMILY_ORDER = [
    "quiet-drift", "dust-storm", "coma", "lattice", "orrery", "milky-way", "sombrero", "horsehead",
    "collision", "whirlpool", "cartwheel", "antennae", "stephans-quintet", "bullet-cluster",
    "virgo-m87", "sagittarius", "event-horizon",
]
TRAITS = ["Palette", "Temperament", "Signature", "Spin", "Doppler", "Exposure"]

ap = argparse.ArgumentParser()
ap.add_argument("--live-base", default="./index.html", help="where index.html is served; ?id=N is appended")
ap.add_argument("--out", default=os.path.join(ROOT, "collection.html"))
ap.add_argument("--artifact", default="", help="also write a body-only copy (no doctype/html/head/body) for claude.ai")
ap.add_argument("--thumb", default="640x360")
ap.add_argument("--quality", type=int, default=78)
ap.add_argument("--meta", default=os.path.join(ROOT, "dist", "metadata"))
args = ap.parse_args()

table = json.load(open(os.path.join(ROOT, "docs", "active", "token-metadata-v1.json"), encoding="utf-8"))
tokens = table["tokens"]
lum, flags = {}, {}
summary = os.path.join(args.meta, "summary.csv")
if os.path.exists(summary):
    for row in csv.DictReader(open(summary, encoding="utf-8")):
        try:
            lum[int(row["id"])] = float(row["lum"] or 0)
        except ValueError:
            pass
        flags[int(row["id"])] = (row.get("flags") or "").strip()

TW, TH = [int(x) for x in args.thumb.lower().split("x")]
from PIL import Image  # noqa: E402


def thumb(i):
    p = os.path.join(args.meta, "previews", f"{i:04d}.png")
    if not os.path.exists(p):
        return ""
    im = Image.open(p).convert("RGB").resize((TW, TH), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=args.quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


out_tokens = []
for t in tokens:
    i = t["id"]
    desc = ""
    mp = os.path.join(args.meta, f"{i}.json")
    if os.path.exists(mp):
        desc = json.load(open(mp, encoding="utf-8")).get("description", "")
    out_tokens.append({
        "id": i,
        "name": t["name"],
        "scene": t["scene"],
        "family": t["traits"].get("Family", t["scene"]),
        "seed": t["seed"],
        "hash": t["hash"],
        "traits": t["traits"],
        "description": desc,
        "lum": lum.get(i, 0.0),
        "flags": flags.get(i, ""),
        "thumb": thumb(i),
    })

fam_names = {t["scene"]: t["family"] for t in out_tokens}
fam_counts = Counter(t["scene"] for t in out_tokens)
families = [{"scene": s, "name": fam_names.get(s, s), "count": fam_counts.get(s, 0)}
            for s in FAMILY_ORDER if s in fam_counts]
values = {}
for k in TRAITS:
    c = Counter(t["traits"].get(k, "—") for t in out_tokens)
    values[k] = [v for v, _ in c.most_common()]

bundle = None
mf = os.path.join(ROOT, "dist", "token.manifest.json")
if os.path.exists(mf):
    bundle = json.load(open(mf, encoding="utf-8")).get("bundleSha256")

data = {
    "generated": time.strftime("%Y-%m-%d"),
    "recipe": 1,
    "edition": table.get("edition", len(out_tokens)),
    "liveBase": args.live_base,
    "bundleSha256": bundle,
    "families": families,
    "values": values,
    "tokens": out_tokens,
}

tpl = open(os.path.join(ROOT, "tools", "collection-template.html"), encoding="utf-8").read()
payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
html, n = re.subn(r"/\*\s*__DATA__\s*\*/\s*null", lambda m: payload, tpl, count=1)
if n != 1:
    raise SystemExit("template placeholder /* __DATA__ */ null not found")
with open(args.out, "w", encoding="utf-8") as f:
    f.write(html)
print(f"wrote {os.path.relpath(args.out, ROOT)}  ({len(html)/1048576:.1f} MB, {len(out_tokens)} tokens, thumbs {TW}x{TH} q{args.quality})")

if args.artifact:
    # claude.ai wraps the file in its own doctype/head/body skeleton: keep
    # <title>, the font link, <style>, then the body's content and scripts.
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
    keep = "".join(re.findall(r"<title>.*?</title>|<link[^>]*>|<style>.*?</style>", head, re.S))
    with open(args.artifact, "w", encoding="utf-8") as f:
        f.write(keep + "\n" + body)
    print(f"wrote {args.artifact} (artifact copy, live base {args.live_base})")
