#!/usr/bin/env python3
"""Weekly health check (launch board p7-health): open ten token ids from
wherever the collection is served, render each token's deterministic
preview, and flag errors, black or blown frames.

  python3 tools/health-check.py                       # the local bundle (dist/token)
  python3 tools/health-check.py --base https://<gateway>/<cid>   # the pinned bundle
  python3 tools/health-check.py --ids 7,40,88 --out /mnt/c/Users/Public/phos-health

The ten ids are drawn from the ISO week number so the same week reruns
the same set; --ids overrides. Exit code 1 if anything is flagged. Same
Chrome recipe as tools/build-metadata.py (Windows Chrome from WSL, see
tools/README-m9.md); a gateway base needs no file-access flag.
"""
import argparse, datetime, os, random, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="file:///L:/projects_claudecode/givernyphos/dist/token",
                help="where index.html lives (gateway URL or file:// folder)")
ap.add_argument("--ids", default="")
ap.add_argument("--n", type=int, default=10)
ap.add_argument("--edition", type=int, default=100)
ap.add_argument("--out", default="/mnt/c/Users/Public/phos-health")
ap.add_argument("--size", default="1280x720")
ap.add_argument("--par", type=int, default=3)
ap.add_argument("--budget", type=int, default=12000)
args = ap.parse_args()

week = datetime.date.today().isocalendar()
rng = random.Random(f"{week[0]}-W{week[1]}")
ids = [int(x) for x in args.ids.split(",") if x.strip()] or sorted(rng.sample(range(1, args.edition + 1), args.n))
W, H = [int(x) for x in args.size.lower().split("x")]
os.makedirs(args.out, exist_ok=True)
win_out = args.out.replace("/mnt/c/", "C:\\").replace("/", "\\") if args.out.startswith("/mnt/c/") else None
if not win_out:
    sys.exit("--out must be under /mnt/c/ so Windows Chrome can write there")
TOKEN_RE = re.compile(r"\[token\] (\w+) ([\w-]+) (\{.*?\}) seed ([0-9a-f]{8})")


def run(i):
    png = f"{args.out}/{i}.png"
    log = f"{args.out}/{i}.log"
    if os.path.exists(png):
        os.remove(png)
    url = f"{args.base.rstrip('/')}/index.html?id={i}&preview=1&_={int(time.time())}"
    cmd = [CHROME, "--headless=new", "--no-sandbox", "--ignore-gpu-blocklist", "--use-angle=d3d11",
           "--allow-file-access-from-files", "--disable-extensions", "--hide-scrollbars", "--mute-audio",
           f"--user-data-dir={win_out}\\prof-{i}", "--enable-logging=stderr", "--v=1",
           f"--virtual-time-budget={args.budget}", f"--window-size={W},{H}",
           f"--screenshot={win_out}\\{i}.png", url]
    t0 = time.time()
    with open(log, "wb") as f:
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=f, timeout=240)
        except subprocess.TimeoutExpired:
            pass
    scene, errors, seed = "?", [], "?"
    for line in open(log, "rb").read().decode("utf-8", "replace").splitlines():
        if "CONSOLE" not in line:
            continue
        m = TOKEN_RE.search(line.replace('\\"', '"'))
        if m:
            scene, seed = m.group(2), m.group(4)
        if "Uncaught" in line or "TypeError" in line or "ReferenceError" in line or "Failed to load" in line:
            errors.append(re.sub(r".*CONSOLE", "CONSOLE", line)[:140])
    flags = []
    lum = white = None
    try:
        from PIL import Image, ImageStat
        im = Image.open(png).convert("L")
        lum = ImageStat.Stat(im).mean[0] / 255
        hist = im.histogram()
        white = sum(hist[245:]) / (im.width * im.height)
        if lum < 0.015:
            flags.append("black")
        if white > 0.30:
            flags.append("blown")
    except Exception as e:
        flags.append("missing")
    if errors:
        flags.append("error")
    if scene == "?":
        flags.append("no-token-line")
    return dict(id=i, scene=scene, seed=seed, lum=lum, white=white, flags=flags, errors=errors, secs=round(time.time() - t0))


t0 = time.time()
with ThreadPoolExecutor(max_workers=args.par) as ex:
    rows = list(ex.map(run, ids))
bad = [r for r in rows if r["flags"]]
print(f"health check {datetime.date.today()}  base={args.base}  {len(rows)} ids in {time.time()-t0:.0f}s")
print(f"{'id':>4} {'scene':<18} {'seed':<9} {'lum':>6} {'white':>6}  flags")
for r in rows:
    lum = f"{r['lum']:.3f}" if r["lum"] is not None else "-"
    white = f"{r['white']:.3f}" if r["white"] is not None else "-"
    print(f"{r['id']:>4} {r['scene']:<18} {r['seed']:<9} {lum:>6} {white:>6}  {' '.join(r['flags']) or 'ok'}")
    for e in r["errors"][:2]:
        print(f"       {e}")
print(f"{len(rows)-len(bad)} ok, {len(bad)} flagged")
sys.exit(1 if bad else 0)
