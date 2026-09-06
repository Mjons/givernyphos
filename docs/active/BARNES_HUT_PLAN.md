# Barnes-Hut on WebGPU — the 1M–4M body plan

This is Phase 3 from [PARTICLE_SCALING.md](../reference/PARTICLE_SCALING.md),
designed for real. Goal: replace the O(N²) all-pairs gravity with an
O(N log N) tree walk so the ceiling moves from 518k (`abyssal`, where
the pair count hits the complexity wall) to 1M–4M bodies on a 4090 —
without changing what the project looks like. Long-range gravity stays
exact-ish everywhere; that's what makes filaments, clusters, and wide
orbits look like themselves.

Read [PARTICLE_SCALING.md](../reference/PARTICLE_SCALING.md) first for
why O(N²) cannot reach 1M (≈1.8 PFLOPS at 60 fps — a complexity wall,
not an implementation gap).

---

## 0. Algorithm choice: LBVH, not classic octree insertion

PARTICLE_SCALING.md cites Burtscher/Pingali 2011 (CUDA octree with
atomic insertion). On WebGPU that's the wrong construction:

- WGSL atomics are u32/i32 on storage buffers only — no 64-bit CAS, no
  atomic floats. The B/P insertion loop leans on rich atomics.
- Insertion-built trees have data-dependent memory layout; WGSL wants
  fixed-size, pre-allocated buffers.

The GPU-native alternative is **sort-based LBVH** (Karras 2012):

1. Compute a **Morton code** (Z-order curve position) per body.
2. **Radix-sort** bodies by Morton code.
3. Build the **binary radix tree** over the sorted codes: exactly N−1
   internal nodes, each built independently by one thread from prefix
   arithmetic — no atomics, no insertion, deterministic layout.
4. Aggregate mass / center-of-mass bottom-up.
5. Walk the tree per body with the Barnes-Hut θ criterion.

Every stage is embarrassingly parallel, uses only u32 atomics (one
flag per node in stage 4), and allocates everything up front. This is
the well-trodden path for GPU BVHs in ray tracing; the physics on top
(θ-criterion multipole acceptance) is the easy part.

**Accuracy:** with θ = 0.5, force errors vs brute-force are <1% RMS —
invisible in this renderer (validated explicitly in M5 below).

---

## 1. The project-specific design problem: the K matrix

This is the one place where textbook Barnes-Hut does not fit us and
some real design is needed. **Do not skip this section.**

The gravity kernel is not `G·m/r²` — it's `G·m·K[kindA][kindB]/r²`
with an 8×8 per-kind interaction matrix (`WGSL_VEL_SHADER`,
`buildVelocityShader`). A tree node aggregates bodies of _mixed_
kinds, so a single (mass, COM) per node cannot reproduce a
kind-dependent force. Options considered:

- **(a) Per-kind mass+COM per node** — 8 × vec4 = 128 B/node, ~2N
  nodes → 1 GB at 4M bodies. Dead on memory.
- **(b) Newtonian far field + K-corrected near field** — decompose
  K = 1 + ΔK, apply ΔK only within the direct-sum radius. Cheap, but
  wrong for scenes that set cross-galaxy K ≠ 1 _globally_ (two-galaxy
  scenes tune long-range cross-attraction). Changes the look. Reject
  as the default; keep as a per-scene fast path if K ≈ 1 everywhere.
- **(c) Rank-1 factorization** K[a][b] ≈ f(a)·g(b), store g-weighted
  mass/COM per node. Exact only for rank-1 K; our matrices aren't
  guaranteed rank-1, and the SVD-error story is hard to reason about
  per scene. Reject: cleverness with a correctness asterisk.
- **(d) Per-kind segmented trees** ← **recommended.** Sort bodies by
  (kind, Morton) and build one LBVH per kind _segment_ (≤8 trees,
  typically 2–4 kinds alive in a scene). The force on body `a` is

  ```
  Σ over kinds b:  K[a][b] × BH-walk( tree_b, position_a )
  ```

  Each walk is pure Newtonian with a scalar multiplier hoisted out —
  **exact for arbitrary K matrices** (within the BH approximation).
  Total node count is the same ~2N as one big tree; the walks are
  correspondingly shallower. Kinds cluster spatially in practice
  (galaxyA bodies live together), so per-kind aggregation loses
  little. Empty segments cost nothing.

Sorting detail that makes (d) free: LSD radix sort is stable, so sort
the 30-bit Morton key first, then one extra 3-bit pass on kind →
final order is kind-major, Morton-minor. One sort pipeline, one extra
pass, and the per-kind trees are just contiguous ranges of the sorted
array with 8 root offsets.

**Dead bodies** (mass ≤ 0): give them Morton key `0xFFFFFFFF` and sort
them to the tail of their segment; segments track an alive-count so
builds and walks never see them (mirrors the `max(posB.w, 0.0)`
convention in the brute kernel).

---

## 2. Frame pipeline

Rebuild the tree **every substep** — at these body speeds a stale tree
visibly lags, and the build is ~20% of the force cost, so refitting
tricks aren't worth their complexity.

```
pass 1  AABB reduce      two-level reduction → scene bounding box
pass 2  Morton encode    per body: 10 bits/axis on the AABB grid → u30 key
pass 3  radix sort       LSD, 4-bit digits × 8 passes + 1 kind pass
                         (histogram → exclusive scan → stable scatter)
pass 4  LBVH build       Karras: thread i computes internal node i's
                         range/split from common-prefix lengths; writes
                         children + parent. Per kind segment.
pass 5  aggregate + ropes bottom-up mass/COM/extent via per-node atomic
                         arrival flag (second child's thread proceeds);
                         then a top-down pass writes skip pointers
pass 6  force            per body: for each alive kind b, stackless
                         rope walk of tree_b; s/d < θ → accept node;
                         leaf → direct pair with exact K; multiply
                         walk total by K[a][b]. Then add the existing
                         flock/radiation/spin/hand terms unchanged.
pass 7  position         existing posStep, unchanged
```

Traversal is **stackless via ropes** (escape/skip pointers precomputed
in pass 5): `advance = accepted || leaf ? node.skip : node.left`. No
per-thread stack array → no register/local-memory pressure → high
occupancy. This matters more than any micro-optimization in the walk.

Karras tie-break: duplicate Morton codes (dense clumps _will_ produce
them) break prefix arithmetic — augment the key comparison with body
index as the low-order tiebreak (the standard fix; treat key as
conceptually `(morton << 32) | index` in the delta function).

The stochastic flocking/radiation block, spin vorticity, and hand
brush port unchanged — they're already O(1) per body and live after
the gravity accumulation in the same kernel. The astrophage (kind 7)
early-return branch slots in exactly as in the brute kernel — and
since astrophage skips pair gravity entirely, its tree segment is
walk-_source_ only (other kinds feel it via K[a][7]).

---

## 3. Memory & limits budget

Per-body (existing): pos/vel ping-pong = 4 × 16 B. New:

| buffer                                   | bytes/body | 1M     | 4M      |
| ---------------------------------------- | ---------- | ------ | ------- |
| morton keys ×2 (sort pingpong)           | 8          | 8 MB   | 32 MB   |
| body index ×2 (sort payload)             | 8          | 8 MB   | 32 MB   |
| node COM+mass (vec4, 2N)                 | 32         | 32 MB  | 128 MB  |
| node meta (child/skip/extent, 2N × 16 B) | 32         | 32 MB  | 128 MB  |
| sort histograms + misc                   | —          | ~2 MB  | ~4 MB   |
| **new total**                            |            | ~82 MB | ~324 MB |

Default WebGPU limits are `maxStorageBufferBindingSize` = 128 MiB and
`maxBufferSize` = 256 MiB — the 4M node buffers exceed neither _per
buffer_ only if we split COM and meta into separate buffers (done
above) **and** request elevated limits at device creation:

```js
adapter.requestDevice({
  requiredFeatures: [...],
  requiredLimits: {
    maxStorageBufferBindingSize: Math.min(512 << 20, adapter.limits.maxStorageBufferBindingSize),
    maxBufferSize:               Math.min(1  << 30, adapter.limits.maxBufferSize),
  },
})
```

Discrete GPUs grant this trivially; integrated GPUs may not → tier
gating (§6). Dispatch limits are fine: 4M / 256 = 15,625 workgroups,
far under 65,535.

---

## 4. Perf model (honest priors, to be replaced by timestamps)

Per-pass priors at 1M bodies on a 4090, per substep:

| pass          | prior     | basis                                                                          |
| ------------- | --------- | ------------------------------------------------------------------------------ |
| AABB + Morton | ~0.1 ms   | 2 streaming passes over 16 MB                                                  |
| radix sort    | ~1.5 ms   | ~9 passes × 3 streaming touches of 8 MB                                        |
| LBVH build    | ~0.3 ms   | N−1 independent threads, prefix math                                           |
| aggregate     | ~0.4 ms   | bottom-up with atomics, bandwidth-shaped                                       |
| force walk    | ~4–6 ms   | ~N × few-hundred node visits, cache-friendly (Morton order = spatial locality) |
| **total**     | **~7 ms** | → 60 fps with headroom at substeps=1                                           |

4M: sort/build scale linearly (~9 ms), force ~N·log → ~20–28 ms →
**30–45 fps**. 2M lands ~60 fps. These match the published GPU-BH
numbers scaled by 4090 bandwidth; they are priors, not promises — the
timestamp plumbing added in the 2026-07-01 commit (querySet slots are
extensible) gives per-pass ground truth from M1 onward, and every
milestone below has a measure-before-proceeding gate.

θ per tier: 0.5 up to 1M; consider 0.6 at 4M (error ~2%, still
invisible; ~30% fewer node visits) — decide from M5 error data.

---

## 5. The second wall: the render bridge

BH fixes compute. At 1M+ the CPU bridge becomes the binding
constraint: readback + DataTexture re-upload is 2 × N × 16 B each way
— **64 MB down + 64 MB up per refresh at 4M**. Today's mitigations
(readbackStride, velStrideMul) cap traffic but cap _motion smoothness_
with it: stride 8 at 60 fps = 7.5 Hz particle motion. Chunky.

Browsers have **no WebGPU↔WebGL interop** — there is no way to hand a
WebGPU buffer to the WebGL renderer without the CPU round-trip. (The
"plumb the buffer directly into Three.js" idea in
[PERFORMANCE_AUDIT.md](PERFORMANCE_AUDIT.md) suspect #5 is not
implementable; this plan supersedes that line.) So:

- **1M tier can ship on the existing bridge** — 16 MB/frame at stride
  2 ≈ 30 Hz motion, borderline but shippable behind "experimental".
- **2M–4M tiers need M9**: render the points from the WebGPU side.
  Realistic shape: keep the WebGL compositor for post (bloom/grain/
  lens are screen-space), render points in a raw WebGPU pass to an
  offscreen canvas, and feed that canvas into the WebGL post chain as
  a texture (`texImage2D` from canvas — GPU-internal copy in Chrome,
  no CPU bounce). Point sprites + additive blend + palette lookup is
  ~200 lines of WGSL; the hard part is matching `pointMat`'s look
  (size attenuation, doppler, channel mixing, kind tints) pixel-close.
  Alternative (bigger): full Three.js `WebGPURenderer` migration —
  rejected for now; the post chain and 15+ custom GLSL shaders make it
  a rewrite, and r160's WebGPU renderer is not at parity.
- CPU consumers stay cheap either way: barycenter / stats / picking
  read the throttled mirror as today; at 2M+ add a tiny GPU reduction
  pass (1 vec4 out) for the barycenter instead of mirroring positions
  at full rate.

Fill rate note: 4M additively-blended sprites will be ROP-bound in
dense views regardless of renderer. Per-tier point-size clamps and the
existing per-tier FX caps are the lever; expect to tune them in M8.

---

## 6. Tiers, gating, UX

New density tiers (names to taste, sizes locked by texSize²):

| key         | texSize | bodies | gate                                  |
| ----------- | ------- | ------ | ------------------------------------- |
| leviathan   | 1024    | 1.05M  | WebGPU + BH + elevated limits granted |
| maelstrom   | 1448    | 2.10M  | + M9 render path                      |
| singularity | 2048    | 4.19M  | + M9 render path                      |

- BH also becomes a toggle on existing experimental tiers
  (`?bh=1` / settings) — same physics, ~10× headroom at colossal/
  abyssal, and the A/B needed for trust.
- Tiers appear only when the device grants the required limits
  (probe at startup, same pattern as the existing WebGPU probe).
- Existing density-tier confirm modal covers the "your fans will
  spin" consent; extend copy for the new tiers.
- WebGL2-only users: unchanged, capped at lush/titanic as today.
- The brute-force WGSL path stays permanently — it is the oracle for
  validation and the fallback for K-matrix scenes if a BH bug ships.

---

## 7. Milestones

Each lands separately, each has a verify gate, all behind flags until
M8. Follows the repo's step convention (PHASE1_WEBGPU style). LoC are
WGSL+JS estimates.

> **Status 2026-07-01:** M1–M6 **code landed** in one drop behind
> `?bh=1` — see the `1c. BARNES-HUT LBVH PIPELINE` section of
> index.html. Implementation deltas from this plan: aggregation uses
> 56 spec-safe wavefront dispatches instead of the atomic-counter
> trick (WGSL atomics are relaxed; dispatch boundaries are ordered);
> the sort key packs kind into the top 3 bits ([kind:3|morton:27],
> 9 bits/axis) so segmenting falls out of one stable LSD sort; M5+M6
> shipped together since segment walks and K-rows are one structure;
> M7's flock/spin/hand parity is already in (astrophage kind-7 still
> TODO in both kernels).
>
> **Gates, same day at 65k (lush):** `__bhTree` structurally clean
> (alive 64,223), `__bhCompare` rmsRel **0.38%** / p99 1.07% —
> **M1–M6 correctness gates PASS** at this tier. Bench: brute
> 5.98 ms vs BH 10.07 ms per substep (0.59×) — BH slower at 65k as
> §4 predicted; dispatch overhead dominates. Same-day follow-up cut
> it: scan stages fused (3 dispatches → 1 per radix pass), aggregate
> now internal-nodes-only (half the threads), and the wavefront count
> became runtime-tunable (`bhSim.aggIters`, guided by the maxDepth
> that `__bhTree()` now measures). Next: re-bench 65k → 518k to find
> the crossover; gates still owed on collision / petrova-line /
> event-horizon and at 99k+. Recipes: [BH_TESTING.md](BH_TESTING.md).

- **M0 — instrumentation** _(done, 2026-07-01 commit)_: timestamp
  queries + debug-overlay GPU timings. Extend query slots per pass as
  they land.
- **M1 — AABB + Morton (~150 LoC)**: two-level reduction, encode pass.
  _Verify:_ JS reference on a 4k-body readback, exact match.
- **M2 — radix sort (~400 LoC)**: histogram/scan/scatter, ping-pong,
  kind pass. _Verify:_ GPU sortedness check pass (adjacent-pair
  compare writes a violation counter) + JS spot-check; timestamp
  budget ≤2 ms @1M.
- **M3 — LBVH build (~250 LoC)**: Karras ranges/splits with index
  tie-break, per-segment roots. _Verify:_ readback structural checker
  — every body reachable exactly once from its segment root, parent/
  child mutual, no cycles (JS, 4k–65k).
- **M4 — aggregate + ropes (~200 LoC)**: atomic-flag bottom-up, skip
  pointers. _Verify:_ per-segment Σmass and COM equal brute-force
  reduction to 1e-5 rel; rope walk visits each leaf exactly once.
- **M5 — force kernel (~300 LoC)**: stackless walk, θ-MAC, near-field
  exact-K direct sum, `?bh=1` flag on existing tiers. _Verify:_ the
  existing `wgpuStep` verify harness pattern — RMS accel error vs
  brute <1% at θ=0.5 across all 8 scene presets; energy drift over
  1k steps within 2× of brute; visual A/B of two-galaxies + filament.
- **M6 — K-matrix exactness**: per-kind segment walks wired to K rows
  (this is mostly M5 structure; kept separate so a K-heavy scene —
  two-galaxies with cross-K ≠ 1 — gets its own verify gate vs brute).
- **M7 — parity extras**: flock/radiation/spin/hand in the BH kernel;
  astrophage branch (fold in the pending WGSL kind-7 TODO from
  [PETROVA_LINE.md](PETROVA_LINE.md) — do it once, in both kernels).
  _Verify:_ petrova-line forms its beam on WebGPU.
- **M8 — leviathan tier ships**: elevated-limits probe, tier +
  presets + modal copy, θ/point-size tuning, PERF numbers recorded in
  PERFORMANCE_AUDIT.md appendix. _Gate:_ 1M ≥ 50 fps on 4090, ≥ 24 fps
  on a mid laptop dGPU, no regression at lush on integrated.
- **M9 — WebGPU point rendering** (unlocks 2M/4M): offscreen-canvas
  WebGPU point pass → WebGL post chain; pixel-close match to
  `pointMat`. Then maelstrom/singularity tiers.

Effort: M1–M5 ≈ 1–1.5 weeks focused; M6–M8 ≈ 3–5 days; M9 ≈ 1 week.
Matches the "1–2 weeks" PARTICLE_SCALING guess for the core, plus the
render wall it didn't price in.

Rule from CHANGELOG applies throughout: any silent-truncation trap
(buffer sizing, NUM_KINDS-dependent layouts) gets a bug-ledger entry.
BH adds several such layouts — size everything from named constants.

---

## 7b. M9 execution plan (tightened 2026-09-06)

Measured on an RTX 4090 the same day: the tree costs 31 / 37 ms per
substep at 262k / 518k, but frames run at 32 / 14 fps — the CPU bounce
(`wgpuFrameStep` readback + DataTexture re-upload, 16–33 MB/frame) and
fill rate set the ceiling now. M9 removes the bounce. Design, with the
July vagueness resolved:

**Shape.** The WebGPU side renders the bodies into an offscreen canvas
(instanced quads — WebGPU has no point sprites — reading pos/vel
straight from the compute buffers, WGSL that mirrors `pointVert` /
`pointFrag` term for term). The WebGL side imports that canvas with
`texImage2D` (GPU-internal in Chrome) and draws it as a screen-space
additive quad *inside the existing scene* while the `bodies` Points
mesh is hidden. RenderPass, bloom, trails, CA, vignette and the capture
paths are untouched; the starfield, rings, Petrova sprites, ships,
trails and solar systems keep rendering in WebGL as before.

**The seam (decides everything, so it goes first, standalone).** A
canvas import may arrive as 8 bits per channel and this look is HDR
(additive sums ≫ 1 feed the bloom). Three encodings, tested in a
throwaway page before any integration: (1) `rgba16float` WebGPU canvas
imported into an RGBA16F WebGL texture — lossless if the browser keeps
the floats; (2) lossless pack: each 16-bit half split across two
`rgba8unorm` texels in a double-width canvas, decoded in GLSL; (3)
RGBM8 (rgb/M, M in alpha, range 0–16) — lossy, last resort. The test
renders a known 0–16 gradient, imports it, reads it back in WebGL and
reports the max value recovered and the import cost per frame at
2560×1440 (100 imports, `performance.now` around `texImage2D` + a
readPixels fence). Pass: an encoding that recovers ≥ 16.0 within 1 %
and imports in < 2 ms.

> **Seam result (2026-09-06, Chrome 152, RTX 4090, `tools/seam-test.html`):**
> the `rgba16float` canvas imported with `texImage2D(RGBA16F, RGBA,
> HALF_FLOAT, canvas)` is lossless (max 16 recovered within ½ f16 ulp),
> same-task fresh, and costs 0.5–0.8 ms per frame at 2560×1440 including
> GPU completion — the same as a plain RGBA8 import. The lossless pack
> is bit-exact too (0.7–1.1 ms); RGBM only survives with
> `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`; importing a float canvas
> into an RGBA8 texture clamps to 1.0. `createImageBitmap` is a CPU
> readback (100+ ms) — never per frame. **Decision: float canvas,
> direct import; pack kept as the fallback for other browsers.**

**CPU consumers.** With no per-frame mirror, `wgpuFrameStep` reads
back every `mirrorEvery` frames (default 30) for stats, barycenter,
picking and the movie subject finder; click-to-follow forces one fresh
mirror. Follow-cam and track shots get a 32-byte async reader (copy
one body's pos + vel to a tiny staging buffer, `mapAsync`) so they stay
per-frame and smooth.

**Flags.** `?render=wgpu|webgl`, `__setRenderPath()`, an overlay line.
Default stays `webgl` until the look gate passes; then auto-on whenever
the WebGPU backend is active.

**Gates.**
1. Seam experiment passes (above).
2. Look: at lush, `render=wgpu` vs `render=webgl` screenshots of three
   scenes (quiet-drift, collision, event-horizon) after the same
   pre-roll, mean absolute pixel difference < 2/255 after tone mapping.
3. Speed: `__perfSnapshot()` at 262k and 518k with the tree on — target
   ≥ 25 fps at 518k on the 4090 (compute allows ~27).
4. Regressions: BH_TESTING.md §5 list, plus follow-cam smoothness,
   click-to-follow, `e` export, thumbnail capture, recording, token
   mode at lush, both integrators.

**Work split.** (A) seam experiment — throwaway page + headless run;
(B) the renderer + composite + flags + mirror throttle + single-body
reader in `index.html`, encoding pluggable behind a constant;
(C) headless verification harness (WebGPU needs a secure context: run
Windows Chrome headless on `file:///L:/…/index.html?…`, not the http
WSL address) producing the look diff and the perf table. A and C run
in parallel with B; integration picks the encoding from A.

## 8. Risks

| risk                                                       | mitigation                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Duplicate Morton codes break Karras                        | index tie-break in delta() (M3 checker catches it)                                |
| Atomics contention in aggregate pass                       | it's one flag write per node, not a loop; if slow, switch to level-sync bottom-up |
| Walk divergence in dense clumps                            | Morton-ordered bodies → neighbors walk near-identical paths; accept, measure      |
| Limits not granted (iGPU)                                  | tiers hidden; BH still usable at ≤518k where default limits suffice               |
| K-scenes regress subtly                                    | M6 gate + brute path kept as oracle + per-scene A/B toggle                        |
| WGSL compiler perf cliffs (loop unrolling, register spill) | keep walk kernel branch-lean; timestamp every pass; test Chrome + Safari TP       |
| 33-bit (kind,morton) key doesn't fit u32                   | never form it — stable LSD passes: 30-bit morton then 3-bit kind                  |

## 9. Non-goals

- FMM, particle-mesh/FFT far field (different look, different project)
- Incremental tree refit across frames
- CPU/WebGL2 Barnes-Hut fallback
- Exact match of brute trajectories (chaotic system — validate on
  force error and statistics, not trajectories)

## 10. Decisions needed before M1

1. **Bless per-kind segmented trees (§1d)?** It's the only exact
   option that fits memory; (b) would be a look-changing shortcut.
2. **Tier names** for 1M/2M/4M (leviathan/maelstrom/singularity are
   placeholders).
3. **Ship order:** M8 (1M on existing bridge) before M9 (render
   rewrite), or hold all new tiers until M9? Recommendation: ship 1M
   first — it's the headline ("a million-body galaxy in one HTML
   file") and M9 risk stays off its critical path.
