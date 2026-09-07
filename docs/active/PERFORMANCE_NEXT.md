---
status: proposal, 2026-09-06 — what is left to try for 262k–1M bodies, ranked
last-updated: 2026-09-06
---

# Performance, next — the tricks we have not tried yet

Where we are after the September push (RTX 4090, WebGPU compute,
Barnes-Hut on, real window unless noted):

| tier          | force ms / substep  | fps   | what limits it now      |
| ------------- | ------------------- | ----- | ----------------------- |
| lush 65k      | 6 (brute)           | 60    | vsync                   |
| titanic 99k   | 16 (BH) / ~14 brute | 54–60 | vsync, then the substep |
| colossal 262k | 31 (44 headless)    | 22–32 | the tree walk           |
| abyssal 518k  | 37 (77 headless)    | 13–14 | the tree walk           |

Everything around the substep has been taken off the frame: async
readback (`TexelReader`), the amortized pre-roll, the lean post chain,
the render scale, the WebGPU point path (M9) that removes the CPU
bounce. The frame is now the physics, and the physics is a first-cut
Barnes-Hut: one thread per body, a stackless θ-MAC rope walk per kind
segment, monopoles only, θ = 0.5, full rebuild every substep. For scale:
Bonsai-class codes do a million bodies in 5–10 ms on far weaker cards,
so there is roughly a 5–10× gap between our kernel and the hardware.
None of what follows is a browser flag. They are the algorithmic and
GPU-programming moves that close that gap, ranked by expected gain per
week of work. Items marked **new** rely on WebGPU features that shipped
in 2024–2025.

## Tier 1 — the tree walk (2–6× on 262k+)

### 1. Walk once per group, not once per body

The biggest single win in every production tree code. Bodies are
already in Morton order; take each leaf (or run of 16–32 consecutive
bodies) as a _group_, walk the tree once with the group's bounding
sphere in the multipole acceptance test, and write an interaction list
(cells to use as monopoles, leaves to open). Then every body in the
group evaluates that same list. Node visits per body drop by roughly
the group size; memory traffic collapses because the group reads each
node once. Expected 2–3× at 262k+. Effort ~1 week. This is the change
that makes items 2 and 3 pay off.

### 2. **new** — cooperative traversal with `subgroups`

WebGPU's `subgroups` extension (Chrome 2025; `subgroupBallot`,
`subgroupBroadcast`, `subgroupShuffle`) is the warp-vote machinery that
Bonsai and Gadget-GPU are built on. With it the group walk in item 1
runs as one lane-per-body traversal that opens a cell if _any_ lane
needs it (ballot), keeps the stack in shared memory, and never diverges.
Without it we emulate the same thing with workgroup barriers, which
costs 1.5–2× more. Check `adapter.features.has("subgroups")`; fall
back to the barrier version. Expected 1.5–2× on top of item 1. Effort
3–4 days once item 1 exists.

### 3. Quadrupole moments, then open θ

Storing a quadrupole per node (6 floats) lets θ go from 0.5 to about
0.75 at the same force error, and the node count visited scales
roughly with 1/θ³. That is 2–3× fewer visits for one extra pass in the
build (the moments accumulate bottom-up like the mass and centre of
mass already do). `__bhCompare()` is the gate: keep `rmsRel < 1 %` and
`p99 < 5 %`. Expected 1.5–2×. Effort 3–4 days.

### 4. One walk when K is neutral

The tree is segmented by kind so the K-matrix can weight each pair of
kinds. Most scenes run the neutral preset, where every segment is
walked with the same coefficient — up to eight walks where one would
do. Detect a uniform K row and walk the whole tree once; scenes with a
real K keep the per-segment walks. Worth measuring first with the
`force=` overlay on quiet-drift versus collision. Expected up to 2× on
neutral scenes. Effort 1–2 days.

### 5. Half-precision nodes (**new** — `shader-f16`)

Node centres of mass and bounding boxes in f16 (positions relative to
the parent cell stay well inside f16 precision) halve the bytes per
visit. The walk is bandwidth-bound once items 1–2 land, so this is a
1.2–1.4× on top. `adapter.features.has("shader-f16")`. Effort 2 days.

## Tier 2 — do fewer force evaluations (2–4× on galaxy scenes)

### 6. Block time-steps

Real N-body codes never step every body at the smallest dt. Give each
body a power-of-two time step from its acceleration (η √(ε / |a|)),
keep bodies binned by step, and only evaluate forces on the bins that
are due. In a merger the cores need the short step; the 80 % of bodies
in the outskirts and tails can take 4–8× longer steps. The tree still
has to be built (or refit) every smallest step, but the walk — the
expensive part — runs on a fraction of the bodies. Expected 2–4× fewer
body-evaluations per second of simulation on our scenes. Effort ~1.5
weeks; it touches the integrator (KDK leapfrog per bin), the tree
build (walkers vs sources) and the trail/render sampling.

### 7. Tree refit instead of rebuild

Between substeps of one frame the topology barely changes: keep the
tree, recompute the moments bottom-up (one pass), rebuild only every
k-th substep or when a body leaves its cell's bounds. Build is already
cheap (0.4–1.8 ms), so this is a 5–10 % item — worth it only once
substeps > 1 is the norm.

### 8. Symplectic KDK with a larger dt

We have a symplectic Euler path; a kick-drift-kick leapfrog holds
energy at 1.5–2× the dt for the same visual fidelity, which is simply
fewer substeps per second. Free once the integrator is touched for
item 6.

## Tier 3 — rendering a million bodies (needed above 518k)

### 9. Splat accumulation instead of quads

At 1M+ the raster cost of one quad (or point sprite) per body returns
as the limit even on the WebGPU path. The alternative is a compute
splat: each body atomically adds its weighted colour into a half- or
full-resolution `r32uint`/float screen buffer (one `atomicAdd` per
covered texel for the 2×2–3×3 footprint of small sprites), and a single
full-screen pass tone-maps it. No vertex work, no overdraw, and the
big sprites (cores, followed star) still go through the quad path.
Expected: render cost flat to 2–4M bodies. Effort ~1 week.

### 10. Half-resolution accumulation + temporal upsample

Render the point pass at 0.5–0.7 scale and upsample with the previous
frame (the afterimage pass already keeps history). The lean chain does
the first half; adding motion-vector-free temporal blending is 2 days
and buys 2× fill rate for "free" at 4K, where devicePixelRatio 1.5–2
is otherwise multiplying pixels by 2.25–4×.

## Tier 4 — hide, overlap, adapt

### 11. Overlap compute with render

Today the render waits for the substep. Double-buffer the positions
and draw step N−1 while step N computes; the GPU overlaps the two when
there is no dependency. Hides up to a frame of compute at the tiers
where compute < 16 ms (99k–131k) and smooths pacing above. Effort 2–3
days (the M9 path already reads the storage buffers directly, which is
what makes this cheap now).

### 12. A fidelity governor

Rather than a fixed θ/dt/substeps per tier, hold a target frame time
and let a controller move θ (0.5 → 0.8), the substep count, the render
scale and, last, the body count. Smoothness is what the viewer notices;
a merger at 262k with θ = 0.7 and 45 fps reads better than 22 fps at
θ = 0.5. Effort 2 days; pairs with the token-mode watchdog on the launch
board.

### 13. TreePM for the far field (the 1M–4M road)

Split gravity: a 128³–256³ mesh solves the long-range part with an FFT
in compute (three 1-D passes each way, ~2–4 ms at 256³ on a 4090), and
the tree only handles pairs within a cutoff of a few cell widths. Force
cost becomes O(N) with a small constant; the tree walks get shallow.
This is what cosmological codes do above a million bodies. Effort 3–4
weeks; only worth it after items 1–3 if the goal is a million-body
tier, not a faster 518k.

## Housekeeping worth doing this week

- `navigator.gpu.requestAdapter()` now asks for
  `powerPreference: "high-performance"` (done alongside this document):
  on laptops and multi-GPU desktops the default could hand the
  simulation to the integrated GPU. Confirm the 4090 in `chrome://gpu`
  under "WebGPU adapter".
- At 4K, check `devicePixelRatio`: the renderer caps it at 2, which is
  4× the pixels of 1080p. Render scale 0.66 costs nothing visible on the
  point field and halves the fill work.
- Keep `?bh=1` θ at 0.5 only for correctness gates; `?theta=0.7` is
  already accepted and is a free 1.5× to try tonight.
- Run `__bhBench()` at 262k and 518k in a real window and record the
  numbers in BH_TESTING.md §3 so the tiers above stop mixing headless
  and windowed measurements.

## Suggested order

1 → 4 → 3 (three weeks, 262k at 60 fps and 518k at ~35 fps is the
realistic target), then 6 (block steps, another 2× on mergers), then 9
if a million-body tier is wanted. 2 and 5 are drop-ins once 1 exists.
