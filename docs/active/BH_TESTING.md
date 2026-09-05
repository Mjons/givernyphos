# Testing the Barnes-Hut pipeline (M1–M5 code drop)

The LBVH gravity path landed 2026-07-01 behind a flag. **None of its
browser gates have run yet** — this file is the recipe. Everything is
driven from the devtools console, same as the `__wgpu*` harness.

Requirements: Chrome/Edge (WebGPU + `timestamp-query`), the WebGPU
backend active, and ideally a discrete GPU.

## 0. Baseline sanity (nothing should have changed)

Open the page with no flags. Everything must behave exactly as before
— BH is inert unless asked for. Check the console for `[wgpu]` lines;
there must be no `[bh]` errors.

## 1. Enable + smoke test

```
http://localhost:8000/index.html?objects=65k&bh=1
```

1. Switch compute backend to WebGPU (settings panel, or however you
   normally activate it; `__wgpuStatus`-era helpers still apply).
2. Watch for the `Barnes-Hut on θ=0.5` toast once pipelines compile.
   If compilation fails you get `[bh] pipeline compile: …` in the
   console and `__bhStatus().failed` holds the reason — report that
   string back and the sim keeps running on the brute kernel.
3. `Shift+D` → debug overlay now has a `bh` line:
   `bh  on  θ=0.5  build=X.XXms  force=X.XXms`.
4. Visual: the scene should look _identical_ to `?bh=0`. If particles
   fountain outward or freeze, the tree is wrong — run step 2 gates.

## 2. Correctness gates (paused sim gives stable numbers)

Press `space` to pause, then in the console:

```js
await __bhTree(); // M1–M4: sort order, kind segments, reachability,
// rope walk, mass/COM per segment, convergence
await __bhCompare(); // M5/M6: BH accel vs brute accel, same input
```

Pass criteria (printed as OK/FAIL):

- `__bhTree`: zero structural errors, `notConverged=0`.
- `__bhCompare`: `rmsRel < 1%` and `p99 < 5%` at θ=0.5.

Run both on several scenes — minimum set: `quiet-drift` (near-uniform),
`collision` (two dense clumps + cross-kind K), `cartwheel` (disc +
inbound clump), `petrova-line` (extreme kind imbalance, 65k of kind 7),
`event-horizon` (deep central mass). K-matrix exactness (M6) is what
`collision` exercises — its K preset is non-neutral.

Repeat at `?objects=4k`, `65k`, `99k`. Tree verify above 99k works but
reads back ~30 MB+; prefer ≤99k.

## 3. Performance

```js
await __bhBench(); // 60 substeps brute, then 60 BH; ms/substep each
```

Note: the bench advances the sim (it's a live painting, that's fine).
Expectations on a 4090 (priors from BARNES_HUT_PLAN.md §4 — replace
with measured numbers in the table below):

| tier          | brute ms/substep | bh ms/substep | speedup | date       |
| ------------- | ---------------- | ------------- | ------- | ---------- |
| lush 65k      | 5.98             | 10.07 ¹       | 0.59×   | 2026-07-01 |
| titanic 99k   |                  |               |         |            |
| colossal 262k |                  |               |         |            |
| abyssal 518k  |                  |               |         |            |

¹ Measured on the M1–M6 drop _before_ the dispatch-overhead cuts that
landed the same day (fused scan −16 dispatches, internal-only
aggregate −½ threads, tunable `bhSim.aggIters`). Re-measure.

Same-day gate results at 65k (alive 64,223): `__bhTree` clean,
`__bhCompare` rmsRel 0.38% / p99 1.07% / max 46.6% — PASS. (A large
max on a handful of bodies is expected: near-cancellation makes the
relative denominator tiny; rms/p99 are the gates.)

At 65k, BH is _slower_ than brute — confirmed by the numbers above:
the tiled O(N²) kernel is very fast at small N and the build's ~95
dispatches are fixed overhead. Crossover should land between 65k and
262k; at 518k BH should win big. If it doesn't, look at `build=` vs
`force=` in the overlay: a fat build means the sort/aggregate stages
need work; a fat force means walk divergence.

Two knobs once the gates pass:

- `bhSim.aggIters` (console) — aggregate wavefront count, default 56.
  `__bhTree()` now prints the scene's measured `maxDepth`; setting
  aggIters to maxDepth + margin and confirming `notConverged=0` via
  `__bhTree()` shaves build time. Depth scales with clumpiness, so
  keep margin generous (+6) and re-check on collision/cartwheel.
- θ sweep: `?bh=1&theta=0.7` trades accuracy for speed. Re-run
  `__bhCompare()` at each θ you try.

## 4. The Cartwheel scene (also new)

```
?scene=cartwheel&objects=65k        (any backend — works on WebGL2 too)
```

- 0–15 s: cool blue disc rotating, warm intruder clump falling in
  from above.
- ~15–20 s: punch-through. Then an expanding ring wave with radial
  spokes; the intruder keeps going / loiters below.
- The ring is emergent — if the disc flies apart _before_ impact, the
  analytic v_circ seeding regressed; if nothing visible happens after
  impact, check the intruder mass constants.
- Scene browser (`B`) shows it after Dust Storm; hotkeys 1–8 are
  untouched. It auto-captures its own thumbnail (no cover art yet).
- Best A/B for BH: `?scene=cartwheel&objects=262k&bh=1` vs `&bh=0` —
  same ring, ~10× cheaper gravity (to be confirmed by the table).

## 5. Regression checks after any BH fix

1. `?nogpu` — WebGL2 path untouched.
2. WebGPU on, `bh=0` — brute WGSL path untouched.
3. Density tier change while `bh=1` (buffers + bind groups rebuild —
   watch for `[bh] buffers allocated` and no validation errors).
4. Scene change while `bh=1` (forceVelRead + fresh kinds; petrova ⇄
   cartwheel is the stress pair).
5. Pause/step/reverse (`space`, `.`, `,`, `T`) under `bh=1`.

## Known limits of this drop

- The astrophage kind-7 thrust branch is still missing on _both_
  WebGPU kernels (petrova-line stays WebGL-only, tracked in
  CHANGELOG "Unreleased").
- Aggregation uses 56 fixed wavefront dispatches (spec-safe, not
  optimal). If `build` dominates at 262k+, that's the first thing to
  optimize — see BARNES_HUT_PLAN.md §2.
- No new density tiers yet — that's M8, gated on these tests passing.
