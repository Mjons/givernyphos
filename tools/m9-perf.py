#!/usr/bin/env python3
"""M9 perf gate (BARNES_HUT_PLAN.md section 7b, gate 3).

Real frame rates need real time, so each cell of the matrix launches a
headless Windows Chrome with a DevTools port, navigates to the page,
waits --wait real ms, measures fps two ways — the page's own
__perfSnapshot().fps (0.5 s rolling) and a rAF count over the last
--measure ms — grabs a screenshot, and closes the browser.

    python3 tools/m9-perf.py                       # 99k/262k/518k x webgl/wgpu, WebGPU compute, BH auto
    python3 tools/m9-perf.py --tiers 262k,518k --paths webgl
    python3 tools/m9-perf.py --bh 0                # brute force instead of the tree

If a run comes back without the WebGPU backend, it is retried with the
flag sets in m9_harness.WEBGPU_FALLBACKS (--enable-unsafe-webgpu, then
--enable-features=Vulkan) and the table says which one, if any, worked.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import m9_harness as H  # noqa: E402


def fmt_ms(v):
    try:
        return f"{float(v):.1f}"
    except (TypeError, ValueError):
        return "-"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiers", default="99k,262k,518k")
    ap.add_argument("--paths", default="webgl,wgpu", help="render paths (?render=)")
    ap.add_argument("--compute", default="webgpu", help="compute backend (?compute=); 'auto' to omit")
    ap.add_argument("--bh", default="auto", help="?bh=0|1, or auto to leave it to the page")
    ap.add_argument("--theta", default=None)
    ap.add_argument("--scene", default="quiet-drift")
    ap.add_argument("--seed", default="1")
    ap.add_argument("--wait", type=int, default=20000, help="real ms before sampling")
    ap.add_argument("--measure", type=int, default=5000, help="real ms rAF-count window after --wait")
    ap.add_argument("--viewport", default="1920x1080")
    ap.add_argument("--extra", default="", help="extra query fragment, e.g. 'integrator=verlet'")
    ap.add_argument("--no-fallback", action="store_true", help="do not retry with WebGPU fallback flags")
    ap.add_argument("--out", default=str(H.DEFAULT_OUT / "perf"))
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    H.check_env()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    w, h = args.viewport.lower().split("x")
    tiers = [t.strip() for t in args.tiers.split(",") if t.strip()]
    paths = [p.strip() for p in args.paths.split(",") if p.strip()]
    fallbacks = [[]] if args.no_fallback else H.WEBGPU_FALLBACKS

    rows, problems = [], []
    for tier in tiers:
        for path in paths:
            params = {"intro": "0", "objects": tier, "scene": args.scene, "seed": args.seed, "render": path}
            if args.compute != "auto":
                params["compute"] = args.compute
            if args.bh != "auto":
                params["bh"] = args.bh
            if args.theta:
                params["theta"] = args.theta
            params.update(H.parse_query(args.extra))
            url = H.page_url(params)

            res, used_flags, err = None, None, None
            for extra in fallbacks:
                suffix = "" if not extra else "-" + "+".join(f.strip("-") for f in extra)
                stem = out / f"{tier}-{path}{suffix}"
                H.log(f"{tier} render={path} flags={extra or 'base'} {url}")
                try:
                    r = H.run_page(
                        url, stem, wait_ms=args.wait, window=f"{w},{h}", viewport=args.viewport,
                        measure_ms=args.measure, extra_flags=extra, verbose=args.verbose,
                    )
                except H.HarnessError as e:
                    err = str(e)
                    H.log(f"  FAILED: {err.splitlines()[0]}")
                    continue
                res, used_flags = r, extra
                s = r.get("snapshot") or {}
                H.log(f"  backend={s.get('backend')} render={s.get('renderPath')} bh={s.get('bh')} "
                      f"fps={s.get('fps')} measured={(r.get('measured') or {}).get('fps')} "
                      f"frames={r.get('frames')} {r['_elapsed_s']}s")
                wgpu_errors = [c for c in r.get("console", []) if "exception" in c or "error:" in c]
                if wgpu_errors and args.verbose:
                    for c in wgpu_errors[:5]:
                        H.log("   ", c)
                if s.get("backend") == "webgpu" or args.compute != "webgpu":
                    break
                H.log("  no WebGPU backend; trying next flag set")

            if res is None:
                rows.append([tier, path, "-", "-", "-", "-", "-", "-", "-", "-", "-", "RUN FAILED"])
                problems.append(f"{tier}/{path}: {err}")
                continue
            s = res.get("snapshot") or {}
            t = s.get("timing") or {}
            m = res.get("measured") or {}
            notes = []
            if used_flags:
                notes.append("needed " + " ".join(used_flags))
            if s.get("backend") != "webgpu" and args.compute == "webgpu":
                notes.append("WebGPU UNAVAILABLE (tried: " + "; ".join(" ".join(f) or "base" for f in fallbacks) + ")")
                problems.append(f"{tier}/{path}: no WebGPU backend")
            if path == "wgpu" and s.get("renderPath") != "wgpu":
                notes.append(f"render path fell back ({s.get('renderFailed') or 'not active'})")
            db = s.get("drawingBuffer") or ["?", "?"]
            rows.append([
                tier, path, f"{s.get('backend','?')}/{s.get('renderPath','?')}", str(s.get("bh", "?")),
                str(s.get("fps", "-")), str(m.get("fps", "-")),
                fmt_ms(t.get("velMs")), fmt_ms(t.get("readMs")), fmt_ms(t.get("buildMs")),
                fmt_ms(s.get("importMs")), f"{db[0]}x{db[1]}", "; ".join(notes) or "ok",
            ])

    print()
    print(f"M9 perf gate — scene={args.scene} compute={args.compute} bh={args.bh} "
          f"viewport={args.viewport} wait={args.wait/1000:.0f}s measure={args.measure/1000:.0f}s")
    print(H.fmt_table(
        ["tier", "render", "backend/render", "bh", "fps(page)", "fps(rAF)", "velMs", "readMs", "buildMs",
         "importMs", "drawbuf", "notes"],
        rows,
    ))
    print(f"\nscreenshots + json: {out}")
    if problems:
        print("\nproblems:")
        for p in problems:
            print("  -", p)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
