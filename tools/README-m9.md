# M9 verification harness

Headless gates for the WebGPU point-rendering work (BARNES_HUT_PLAN.md
section 7b, gates 2 and 3). Two scripts, one shared driver:

| file            | role                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| `m9-look.py`    | look gate: `render=webgl` vs `render=wgpu` stills, PIL diff, pass/fail |
| `m9-perf.py`    | perf gate: real-time fps table over tiers × render paths               |
| `m9-cdp.mjs`    | DevTools-protocol driver (runs under the _Windows_ node)               |
| `m9_harness.py` | shared plumbing: Chrome launch, path mapping, tables                   |

## Why it looks the way it does

- WSL has no browser and WebGPU needs a secure context, so both scripts
  launch **Windows Chrome** (`/mnt/c/Program Files/Google/Chrome/…`) on
  `file:///L:/projects_claudecode/givernyphos/index.html?…`. Plain-http
  WSL addresses do not get WebGPU.
- Chrome's remote-debugging port binds to 127.0.0.1 _on the Windows
  side_, so the CDP client is `m9-cdp.mjs` run by the Windows node
  (`/mnt/c/Program Files/nodejs/node.exe`, script addressed as
  `L:\…\tools\m9-cdp.mjs`). No npm dependencies: global `WebSocket`,
  `fetch`, `zlib`.
- Everything is **real time**. Chrome's virtual time
  (`--virtual-time-budget`, `Emulation.setVirtualTimePolicy`) does not
  advance this page's rAF loop in `--headless=new` (identical DOM at
  2/15/30 s budgets; the CDP form hangs in `Page.navigate`), so
  determinism comes from the page's `?freeze=<steps>` flag: director
  and drift off, `<steps>` substeps run once the backend has settled,
  then paused.
- Flags that give headless Chrome the RTX 4090 with a WebGPU adapter on
  file:// URLs: `--headless=new --no-sandbox --ignore-gpu-blocklist
--use-angle=d3d11` (+ `--disable-extensions --hide-scrollbars
--mute-audio`). **No `--enable-unsafe-webgpu` is needed** (Chrome 152).
  `m9-perf.py` still retries a cell with `--enable-unsafe-webgpu` and
  then `--enable-features=Vulkan` if the page reports no WebGPU backend,
  and says so in the table.
- Browsers are closed with `Browser.close` over CDP — never
  `taskkill /IM chrome.exe`, which would also kill the user's own
  Chrome. Each run gets a fresh profile (`udd-<port>` under `--out`), so
  no stored density / compute preference leaks between runs.
- Outputs go to `/mnt/c/Users/Public/m9-harness/{look,perf}` by default
  (`--out` must be under `/mnt/<drive>/` so Windows Chrome can write
  there).

## Look gate

```
python3 tools/m9-look.py                              # quiet-drift, collision, event-horizon
python3 tools/m9-look.py --scenes collision --freeze 600 --viewport 1920x1080
python3 tools/m9-look.py --repeat-a                   # adds an A-vs-A row = run-to-run noise floor
python3 tools/m9-look.py --a "render=webgl&nogpu" --b "render=webgl" \
        --label-a webgl-nogpu --label-b webgl-wgpucompute   # any two query fragments
```

Per scene it loads `?intro=0&objects=65k&scene=<s>&seed=1&freeze=300&<variant>`
twice (A = `render=webgl`, B = `render=wgpu` by default), with a seeded
`Math.random` injected and the HUD/rail/panel hidden, waits for
`__perfSnapshot().freeze === 'done'` (or the `[freeze] … paused` console
line), then keeps taking screenshots until consecutive captures stop
changing (`--stable 0.5`, twice in a row): a paused page repeats frames
exactly (diff 0.00), while on the WebGPU backend the frozen state reaches
the render textures a few seconds *after* `freeze=done` and shows up as
a non-zero diff — the first capture would otherwise show the initial
conditions. Each side's HUD stats (ke / temp / rms) are recorded; if
they differ the result is tagged `STATE MISMATCH`, so a sim-state
difference is never mistaken for a render-path difference.

Metrics (PIL, 0–255): per-channel and overall **mean absolute
difference**, **p99** and **max** of the per-pixel max-channel
difference, and the fraction of pixels that changed at all. `--downsample
N` box-averages N×N blocks first (use it if per-frame film grain is ever
live in the stills again — it averages zero-mean noise down by N while
systematic render differences survive).

**Pass:** overall mean < `--threshold` (default **2.0**, i.e. the plan's
"mean absolute pixel difference < 2/255 after tone mapping"). Exit code 1
if any scene fails or a run errors. The table also shows what the page
actually ran (`backend/renderPath[/encoding]`), so a `wgpu` request that
silently fell back to WebGL points is visible.

Reference points measured 2026-09-06 (65k, freeze=300, seed=1, 1280×720,
working-tree revision with the first `render=wgpu` implementation,
encoding `float` = rgba16float canvas):

| comparison                                                  | mean  | p99 | result |
| ----------------------------------------------------------- | ----- | --- | ------ |
| same configuration twice (run-to-run floor)                 | 0.000 | 0   | bit-identical |
| `nogpu` (WebGL2 compute) vs WebGPU compute, WebGL points    | 2.03  | 35  | fp32 divergence of two integrators over 300 steps of a chaotic system — not a render comparison |
| quiet-drift `render=webgl` vs `render=wgpu`                 | 0.043 | 1   | PASS |
| event-horizon `render=webgl` vs `render=wgpu`               | 0.008 | 1   | PASS |
| collision `render=webgl` vs `render=wgpu`                   | 22.25 | 107 | FAIL — the two galaxy-core bodies draw about half the size and much dimmer on the WebGPU path (`collision-cores-zoom.png`); sim state identical on both sides |

Each scene writes `<scene>-<A>.png`, `<scene>-<B>.png`, the driver JSON
(snapshot, console, stability trace) and `<scene>-compare.png`
(A | B | |A−B| ×8).

## Perf gate

```
python3 tools/m9-perf.py                              # 99k/262k/518k × webgl/wgpu, compute=webgpu, BH auto
python3 tools/m9-perf.py --tiers 262k,518k --paths wgpu --bh 1 --theta 0.6
python3 tools/m9-perf.py --paths webgl --compute auto  # let the page choose the backend
```

Per cell it loads `?intro=0&objects=<tier>&scene=quiet-drift&seed=1&render=<path>&compute=webgpu`
at a pinned 1920×1080 viewport, waits `--wait` (20 s) real time, measures
fps two ways — the page's `__perfSnapshot().fps` (0.5 s rolling) and a
rAF count over the following `--measure` (5 s) window — and captures a
screenshot. Columns: `velMs/readMs/buildMs` are the page's WebGPU
timings (`timing.*`), `importMs` the M9 canvas import, `drawbuf` the
real drawing-buffer size.

Caveats: `--headless=new` runs the compositor at 60 Hz, so fps caps at
60; the interesting tiers are well below that. Do not run anything else
on the GPU during the matrix. A cell that never reaches the WebGPU
backend after all fallback flag sets is reported as `WebGPU UNAVAILABLE`
with the flags tried, and the script exits 1.

**Target (gate 3):** ≥ 25 fps at 518k with the tree on, `render=wgpu`.

## Driver on its own

```
"/mnt/c/Program Files/nodejs/node.exe" 'L:\projects_claudecode\givernyphos\tools\m9-cdp.mjs' \
   --port 9411 --url "file:///L:/projects_claudecode/givernyphos/index.html?intro=0&objects=262k" \
   --wait 20000 --measure 5000 --viewport 1920x1080 \
   --shot 'C:\Users\Public\m9-harness\x.png' --json 'C:\Users\Public\m9-harness\x.json' --verbose
```

(after launching Chrome yourself with `--remote-debugging-port=9411
--user-data-dir=C:\…\some-fresh-dir about:blank`). Useful extras:
`--until <js>`, `--until-console <text>`, `--settle ms`, `--stable N`,
`--eval <js>` (returned as `eval`, e.g. the HUD stats text),
`--seed-random N`, `--hide "<css selectors>"`, `--keep-open`,
`--close-only` (just shut that Chrome down).
