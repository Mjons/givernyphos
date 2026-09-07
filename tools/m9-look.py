#!/usr/bin/env python3
"""M9 look gate (BARNES_HUT_PLAN.md section 7b, gate 2).

For each scene, renders the same deterministic still through two page
variants — by default the WebGL point path (render=webgl) and the WebGPU
point path (render=wgpu) — and compares them with PIL.

Determinism comes from the page's ?freeze=<steps> flag (director and
drift off, <steps> substeps run synchronously once the backend has
settled, then paused) plus a fixed scene seed and a seeded Math.random
injected by the driver. The HUD/rail/panel are hidden before capture.

    python3 tools/m9-look.py                       # quiet-drift, collision, event-horizon
    python3 tools/m9-look.py --scenes collision --freeze 600
    python3 tools/m9-look.py --a "render=webgl&compute=webgl" --b "render=webgl&compute=webgpu" \
                             --label-a webgl-compute --label-b webgpu-compute

Pass: mean absolute difference over all channels < --threshold (2.0/255).
Outputs per scene: <scene>-<a>.png, <scene>-<b>.png, <scene>-compare.png
(A | B | amplified diff) and the driver JSON, under --out.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import m9_harness as H  # noqa: E402

DEFAULT_SCENES = ["quiet-drift", "collision", "event-horizon"]
UNTIL_FROZEN = "window.__perfSnapshot && window.__perfSnapshot().freeze === 'done'"
# HUD stats text (ke / temp / rms) — recorded per side so a sim-state
# mismatch can be told apart from a render-path difference.
STATE_EXPR = "(function(e){return e ? e.textContent.replace(/\\s+/g,' ').trim() : null})(document.getElementById('hud-stats'))"


def percentile_from_hist(hist, q):
    total = sum(hist)
    if total == 0:
        return 0
    acc = 0
    for value, count in enumerate(hist):
        acc += count
        if acc >= q * total:
            return value
    return len(hist) - 1


def compare(png_a, png_b, out_png, label_a, label_b, amplify=8, downsample=1):
    from PIL import Image, ImageChops, ImageDraw, ImageStat

    a = Image.open(png_a).convert("RGB")
    b = Image.open(png_b).convert("RGB")
    if a.size != b.size:
        raise H.HarnessError(f"size mismatch {a.size} vs {b.size}")
    if downsample > 1:
        # Box-average NxN blocks: zero-mean per-pixel noise (film grain
        # re-rolls every frame) averages down by N; systematic render
        # differences survive.
        size = (a.width // downsample, a.height // downsample)
        a = a.resize(size, Image.BOX)
        b = b.resize(size, Image.BOX)
    d = ImageChops.difference(a, b)
    means = ImageStat.Stat(d).mean  # per channel, 0-255
    r, g, bl = d.split()
    dmax = ImageChops.lighter(ImageChops.lighter(r, g), bl)  # per-pixel max over channels
    hist = dmax.histogram()
    p99 = percentile_from_hist(hist, 0.99)
    mx = dmax.getextrema()[1]
    frac_changed = 1.0 - hist[0] / max(1, sum(hist))

    # Side-by-side: A | B | amplified diff (x amplify, clipped).
    amp = dmax.point(lambda v: min(255, v * amplify)).convert("RGB")
    w, h = a.size
    pad, cap = 8, 22
    sheet = Image.new("RGB", (3 * w + 4 * pad, h + cap + 2 * pad), (16, 16, 20))
    draw = ImageDraw.Draw(sheet)
    for i, (img, lbl) in enumerate(
        [(a, label_a), (b, label_b), (amp, f"|A-B| x{amplify}  mean={sum(means)/3:.2f}  p99={p99}  max={mx}")]
    ):
        x = pad + i * (w + pad)
        sheet.paste(img, (x, cap + pad))
        draw.text((x + 2, 4), lbl, fill=(230, 230, 230))
    sheet.save(out_png)
    return {
        "mean_r": means[0],
        "mean_g": means[1],
        "mean_b": means[2],
        "mean": sum(means) / 3,
        "p99": p99,
        "max": mx,
        "changed": frac_changed,
    }


def describe(res):
    """backend/renderPath[/encoding] as the page reports them."""
    s = res.get("snapshot") or {}
    parts = [str(s.get("backend", "?")), str(s.get("renderPath", "?"))]
    if s.get("encoding"):
        parts.append(str(s["encoding"]))
    return "/".join(parts)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenes", default=",".join(DEFAULT_SCENES), help="comma-separated scene keys")
    ap.add_argument("--objects", default="65k")
    ap.add_argument("--freeze", type=int, default=300, help="substeps to run before the still")
    ap.add_argument("--seed", default="1", help="scene seed (?seed=)")
    ap.add_argument("--a", default="render=webgl", help="query fragment for variant A")
    ap.add_argument("--b", default="render=wgpu", help="query fragment for variant B")
    ap.add_argument("--label-a", default=None)
    ap.add_argument("--label-b", default=None)
    ap.add_argument("--viewport", default="1280x720")
    ap.add_argument("--threshold", type=float, default=2.0, help="pass if mean |diff| < this (0-255)")
    ap.add_argument("--wait", type=int, default=120000, help="max real ms to wait for the freeze to finish")
    ap.add_argument("--settle", type=int, default=1500, help="real ms after freeze=done before capture")
    ap.add_argument("--stable", type=float, default=0.5,
                    help="capture once two consecutive screenshots differ by less than this mean (0-255); "
                         "a paused page repeats frames exactly (0.00), a late-arriving frozen state shows as >0")
    ap.add_argument("--stable-max", type=int, default=45000, help="max real ms to wait for a stable picture")
    ap.add_argument("--out", default=str(H.DEFAULT_OUT / "look"))
    ap.add_argument("--repeat-a", action="store_true", help="also run A twice and report A-vs-A (run noise)")
    ap.add_argument("--downsample", type=int, default=1,
                    help="box-average NxN blocks before comparing (averages out per-frame film grain)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    H.check_env()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    label_a = args.label_a or args.a.replace("&", "+").replace("=", "-")
    label_b = args.label_b or args.b.replace("&", "+").replace("=", "-")
    w, h = args.viewport.lower().split("x")

    rows, failures = [], 0
    for scene in [s.strip() for s in args.scenes.split(",") if s.strip()]:
        runs = {}
        variants = [("a", label_a, args.a), ("b", label_b, args.b)]
        if args.repeat_a:
            variants.append(("a2", label_a + "#2", args.a))
        for key, label, fragment in variants:
            params = {"intro": "0", "objects": args.objects, "scene": scene, "seed": args.seed,
                      "freeze": args.freeze}
            params.update(H.parse_query(fragment))
            url = H.page_url(params)
            stem = out / f"{scene}-{label}"
            H.log(f"{scene} [{label}] {url}")
            try:
                res = H.run_page(
                    url, stem, wait_ms=args.wait, window=f"{w},{h}", viewport=args.viewport,
                    until=UNTIL_FROZEN, until_console="[freeze]", settle_ms=args.settle,
                    stable=args.stable, stable_max_ms=args.stable_max, seed_random=1,
                    hide=H.HIDE_SELECTORS, eval_expr=STATE_EXPR, verbose=args.verbose,
                )
            except H.HarnessError as e:
                H.log(f"  FAILED: {e}")
                runs[key] = None
                continue
            s = res.get("snapshot") or {}
            note = ""
            if res.get("untilMet") is False:
                note = " (freeze never reported done; still is NOT deterministic)"
            H.log(f"  {describe(res)} freeze={s.get('freeze')} frames={res.get('frames')} "
                  f"state=[{res.get('eval')}] {res['_elapsed_s']}s{note}")
            runs[key] = res

        def row(lbl_a, ra, lbl_b, rb, out_name):
            nonlocal failures
            if not ra or not rb:
                failures += 1
                return [scene, lbl_a, lbl_b, "-", "-", "-", "-", "-", "RUN FAILED"]
            st = compare(ra["_png"], rb["_png"], out / out_name, lbl_a, lbl_b,
                         downsample=args.downsample)
            frozen = (ra.get("untilMet") is not False) and (rb.get("untilMet") is not False)
            ok = st["mean"] < args.threshold
            if not ok:
                failures += 1
            verdict = ("PASS" if ok else "FAIL") + ("" if frozen else " (unfrozen)")
            if ra.get("eval") and rb.get("eval") and ra["eval"] != rb["eval"]:
                verdict += " STATE MISMATCH"
            return [
                scene, describe(ra), describe(rb),
                f"{st['mean_r']:.2f}/{st['mean_g']:.2f}/{st['mean_b']:.2f}",
                f"{st['mean']:.3f}", str(st["p99"]), str(st["max"]),
                f"{100*st['changed']:.1f}%", verdict,
            ]

        rows.append(row(label_a, runs.get("a"), label_b, runs.get("b"), f"{scene}-compare.png"))
        if args.repeat_a:
            rows.append(row(label_a, runs.get("a"), label_a + "#2", runs.get("a2"), f"{scene}-repeatA.png"))

    print()
    print(f"M9 look gate — objects={args.objects} freeze={args.freeze} seed={args.seed} "
          f"viewport={args.viewport} threshold mean<{args.threshold}")
    print(f"A = {args.a}   B = {args.b}")
    print(H.fmt_table(
        ["scene", "A backend/render", "B backend/render", "mean R/G/B", "mean", "p99", "max", "px changed", "result"],
        rows,
    ))
    print(f"\nimages: {out}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
