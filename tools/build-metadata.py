#!/usr/bin/env python3
"""Metadata generator for the 100-token edition (launch board p6-meta).

For every id it renders the token's preview from the built bundle
(dist/token/index.html?id=N&preview=1 — the same deterministic still the
100-token gate measured), reads the traits / seed / hash the page logs on
its `[token]` console line, and writes:

  dist/metadata/<id>.json            ERC-721 metadata (name, description,
                                     image, animation_url, attributes)
  dist/metadata/previews/<id4>.png   1600×900 preview
  dist/metadata/summary.csv          one row per token (flags included)
  docs/active/token-metadata-v1.json identity archive (--archive): id,
                                     name, scene, seed, hash, traits

  python3 tools/build-metadata.py                       # all 100, render
  python3 tools/build-metadata.py --ids 1,7,63          # a few
  python3 tools/build-metadata.py --no-render \\
      --base ipfs://<bundle-cid> --images ipfs://<images-cid>   # re-write
                                     JSON with the final URLs, no renders

Requires: node tools/build-token.mjs first (the bundle), Windows Chrome
reachable from WSL (see tools/README-m9.md), PIL for the flags.
Copy: docs/active/TOKEN_COPY.md (name pattern, description template,
family sentences).
"""
import argparse, csv, json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
PUB = "/mnt/c/Users/Public/phos-meta"
WIN_ROOT = "L:\\projects_claudecode\\givernyphos"
FILE_ROOT = "file:///L:/projects_claudecode/givernyphos"

ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=100)
ap.add_argument("--ids", default="")
ap.add_argument("--base", default="ipfs://BUNDLE_CID", help="animation_url base (the pinned bundle folder)")
ap.add_argument("--images", default="ipfs://IMAGES_CID", help="image base (the pinned previews folder)")
ap.add_argument("--out", default=os.path.join(ROOT, "dist", "metadata"))
ap.add_argument("--size", default="1600x900")
ap.add_argument("--par", type=int, default=4)
ap.add_argument("--budget", type=int, default=12000, help="virtual-time budget ms per still")
ap.add_argument("--no-render", action="store_true", help="reuse existing previews and console logs")
ap.add_argument("--archive", action="store_true", help="also write docs/active/token-metadata-v1.json")
ap.add_argument("--source", default="dist/token/index.html", help="html to render (relative to repo)")
ap.add_argument("--tier", default="", help="density tier for the stills (default: the preview default, standard); the gate used lush")
args = ap.parse_args()

ids = [int(x) for x in args.ids.split(",") if x.strip()] or list(range(1, args.n + 1))
W, H = [int(x) for x in args.size.lower().split("x")]
os.makedirs(os.path.join(args.out, "previews"), exist_ok=True)
os.makedirs(PUB, exist_ok=True)
src = os.path.join(ROOT, args.source)
if not args.no_render and not os.path.exists(src):
    sys.exit(f"no {args.source} — run: node tools/build-token.mjs")

# ---- copy (docs/active/TOKEN_COPY.md) --------------------------------
NAME = "Giverny Phos #{id} — {family}"
DESCRIPTION = (
    "{sentence}. Temperament: {temperament}; its signature shot is a {signature}. "
    "Seed 0x{seed}. The still is the token at its first moments; the live piece is what it becomes."
)
FAMILY_SENTENCE = {
    "quiet-drift": "A cold, diffuse field settling into threads under its own weight",
    "dust-storm": "Eight heavy attractors and a sky of dust learning where to fall",
    "coma": "A cluster of galaxies, each a knot of light, circling a common centre",
    "lattice": "A crystal of stars, perfectly ordered, and the moment order gives way",
    "orrery": "A sun and its planets in clean, patient orbits",
    "milky-way": "A barred spiral with its dust lanes, seen from above the disc",
    "sombrero": "An edge-on galaxy with a bright bulge and a dark lane across it",
    "horsehead": "A dense stellar nursery, light pressing through dust",
    "collision": "Two galaxies on a {scenario} course — tidal tails, a bridge, a merger",
    "whirlpool": "A grand-design spiral grown live from a cold disc and a passing companion",
    "cartwheel": "A compact intruder punching through a disc; a ring wave expanding outward",
    "antennae": "Two spirals torn into long tidal arms as they fall together",
    "stephans-quintet": "A compact group of galaxies interacting all at once",
    "bullet-cluster": "Two galaxy clusters passing through each other, gas and halos parting ways",
    "virgo-m87": "A giant elliptical around a supermassive black hole, with its jet",
    "sagittarius": "The Galactic Centre: stars swinging close around the black hole",
    "event-horizon": "An accretion disc, a photon ring, and the shadow at the centre",
}
ATTRS = ["Family", "Temperament", "Signature", "Variant", "Palette", "Channel", "Exposure", "Spin", "Doppler"]

TOKEN_RE = re.compile(r'\[token\] (\w+) ([\w-]+) (\{.*?\}) seed ([0-9a-f]{8}) hash (\S+?)(?:"|$)')


def render(i):
    png_win = f"C:\\Users\\Public\\phos-meta\\{i}.png"
    png = f"{PUB}/{i}.png"
    log = f"{PUB}/{i}.log"
    if os.path.exists(png):
        os.remove(png)
    tier = f"&objects={args.tier}" if args.tier else ""
    url = f"{FILE_ROOT}/{args.source}?id={i}&preview=1{tier}&_={int(time.time())}"
    cmd = [
        CHROME, "--headless=new", "--no-sandbox", "--ignore-gpu-blocklist", "--use-angle=d3d11",
        "--allow-file-access-from-files",  # the bundle's ./vendor module imports on file://
        "--disable-extensions", "--hide-scrollbars", "--mute-audio",
        f"--user-data-dir=C:\\Users\\Public\\phos-meta\\prof-{i}",
        "--enable-logging=stderr", "--v=1", f"--virtual-time-budget={args.budget}",
        f"--window-size={W},{H}", f"--screenshot={png_win}", url,
    ]
    with open(log, "wb") as f:
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=f, timeout=240)
        except subprocess.TimeoutExpired:
            pass


def parse(i):
    log = f"{PUB}/{i}.log"
    info, errors = None, []
    if os.path.exists(log):
        for line in open(log, "rb").read().decode("utf-8", "replace").splitlines():
            if "CONSOLE" not in line:
                continue
            m = TOKEN_RE.search(line.replace('\\"', '"'))
            if m:
                info = dict(platform=m.group(1), scene=m.group(2), traits=json.loads(m.group(3)),
                            seed=m.group(4), hash=m.group(5))
            if "Uncaught" in line or "TypeError" in line or "ReferenceError" in line:
                errors.append(re.sub(r".*CONSOLE", "CONSOLE", line)[:160])
    return info, errors


def flags_for(png):
    try:
        from PIL import Image, ImageStat
        im = Image.open(png).convert("L")
        st = ImageStat.Stat(im)
        lum = st.mean[0] / 255
        hist = im.histogram()
        white = sum(hist[245:]) / (im.width * im.height)
        f = []
        if lum < 0.015:  # a truly black frame; dark compositions (orrery) sit near 0.02
            f.append("black")
        if white > 0.30:
            f.append("blown")
        return round(lum, 3), round(white, 3), f
    except Exception as e:
        return None, None, [f"pil:{e}"]


if not args.no_render:
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.par) as ex:
        list(ex.map(render, ids))
    print(f"rendered {len(ids)} stills in {time.time()-t0:.0f}s", file=sys.stderr)

rows, archive, bad = [], [], 0
for i in ids:
    info, errors = parse(i)
    png = f"{PUB}/{i}.png"
    lum, white, flags = flags_for(png) if os.path.exists(png) else (None, None, ["missing"])
    if errors:
        flags.append("error")
    if not info:
        flags.append("no-traits")
        bad += 1
        rows.append(dict(id=i, flags=" ".join(flags), errors=" | ".join(errors)))
        continue
    t = info["traits"]
    scene = info["scene"]
    family = t.get("Family", scene)
    variant = t.get("Variant", "—")
    if scene == "collision" and variant and variant != "—":
        family_text = f"Collision · {variant}"
        sentence = FAMILY_SENTENCE["collision"].format(scenario=variant.lower())
    else:
        family_text = family
        sentence = FAMILY_SENTENCE.get(scene, family)
    name = NAME.format(id=i, family=family_text)
    desc = DESCRIPTION.format(sentence=sentence, temperament=t.get("Temperament", "").lower(),
                              signature=t.get("Signature", "").lower(), seed=info["seed"])
    attrs = [{"trait_type": k, "value": t[k]} for k in ATTRS if k in t and t[k] not in ("—", "", None)]
    attrs.append({"display_type": "number", "trait_type": "Number", "value": i, "max_value": args.n})
    img = f"{i:04d}.png"
    meta = {
        "name": name,
        "description": desc,
        "image": f"{args.images.rstrip('/')}/{img}",
        "animation_url": f"{args.base.rstrip('/')}/index.html?id={i}",
        "attributes": attrs,
    }
    with open(os.path.join(args.out, f"{i}.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")
    if os.path.exists(png):
        import shutil
        shutil.copyfile(png, os.path.join(args.out, "previews", img))
    if flags:
        bad += 1
    rows.append(dict(id=i, name=name, scene=scene, seed=info["seed"], lum=lum, white=white,
                     flags=" ".join(flags), errors=" | ".join(errors)))
    archive.append(dict(id=i, name=name, scene=scene, seed=info["seed"], hash=info["hash"], traits=t))

with open(os.path.join(args.out, "summary.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["id", "name", "scene", "seed", "lum", "white", "flags", "errors"])
    w.writeheader()
    for r in rows:
        w.writerow(r)
if args.archive:
    p = os.path.join(ROOT, "docs", "active", "token-metadata-v1.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"edition": args.n, "generated": time.strftime("%Y-%m-%d"), "copy": "docs/active/TOKEN_COPY.md",
                   "tokens": archive}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("archive:", os.path.relpath(p, ROOT), file=sys.stderr)
print(f"{len(rows) - bad} ok, {bad} flagged → {os.path.relpath(args.out, ROOT)}/", file=sys.stderr)
for r in rows:
    if r.get("flags"):
        print(f"  #{r['id']}: {r['flags']} {r.get('errors','')}", file=sys.stderr)
