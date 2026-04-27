# Pushing past 130k bodies — design exploration

Notes on why we're hitting a wall, three ways to push the ceiling, what
the code actually has to change, and where I'd start. The goal of this
doc is a shared plan, not a decided one — the tradeoffs across the
three paths are real and worth talking through.

## Why 130k is rough on a 4090

The gravity step lives in [index.html:1644](index.html#L1644) —
`buildVelocityShader`. Every body samples _every other body_ with a
nested `texture2D` call inside a double for-loop:

```glsl
for (int y = 0; y < ${texSize}; y++) {
  for (int x = 0; x < ${texSize}; x++) {
    vec2 uv2 = (vec2(float(x), float(y)) + 0.5) * ts;
    vec4 posB = texture2D(texturePosition, uv2);
    if (posB.w <= 0.0) continue;
    vec4 velB = texture2D(textureVelocity, uv2);
    // ...force accumulation...
  }
}
```

At `titanic` (TEX_SIZE=360) that's 129 600² = **16.8 billion** texture
samples per frame. Each sample is 16 bytes → **270 GB/frame**. At
60 fps that's **16 TB/s** of texture bandwidth. A 4090 has ~1 TB/s of
global memory bandwidth — we're asking for 16× what the card can move,
even before any ALU work.

The card has ~36 TFLOPS of fp32 compute, which is overkill for the
math itself; **we're bandwidth-bound, not compute-bound.** That's why
the 4090 sees 20 fps instead of the 200 fps a back-of-envelope
"flops/op" estimate would predict.

## The three plausible paths

### A — WebGPU compute + tiled shared memory (recommended start)

WebGL 2 fragment shaders have no shared memory. WebGPU compute shaders
do — `var<workgroup>` arrays let a workgroup of threads pool a chunk of
data so each global texture read serves the whole workgroup, not one
thread.

The classic algorithm (Nyland / GPU Gems 3 ch.31):

```
for each tile of P bodies:
  cooperatively load P bodies into shared memory   (one global read per thread)
  for each body in the tile:
    accumulate force from this body                (workgroup-shared read)
synchronize between tiles
```

If `P = 256` (a typical workgroup size), each global texture read is
amortized across 256 threads. The 16 TB/s bandwidth requirement drops
to ~64 GB/s — well under the 4090's 1 TB/s ceiling.

**Speedup estimate on a 4090:**

| Tier     | bodies | WebGL today | WebGPU + tiles |
| -------- | ------ | ----------- | -------------- |
| lush     | 65k    | 60 fps      | 60 fps         |
| titanic  | 130k   | 20 fps      | 60 fps         |
| colossal | 262k   | 5 fps       | 30–45 fps      |
| abyssal  | 518k   | 1–2 fps     | 12–20 fps      |

Pulling the abyssal 4090 number to "playable" (~30 fps) likely needs
either Barnes-Hut on top of this, or a slightly tighter algorithm
(e.g. P²M / cutoff hybrid).

**Implementation surface — the honest list:**

1. **WebGPU device + adapter init.** ~30 LoC. Browser support: Chrome /
   Edge / Safari fully; Firefox behind `dom.webgpu.enabled`. We need a
   feature-detect and a fallback path.

2. **Replacement for `GPUComputationRenderer`**. Three.js's helper that
   we use today is WebGL2-only. WebGPU compute is hand-rolled — buffers,
   bind groups, pipelines, dispatch. Probably 200–400 LoC of glue.

3. **The compute shader itself.** WGSL, not GLSL. The math from
   `buildVelocityShader` translates straight across; the loop is
   replaced with the tiled algorithm. ~150 LoC of WGSL.

4. **Renderer choice.** Currently Three.js's `WebGLRenderer`. Two ways
   to keep the rest of the app working:
   - (a) Use Three's experimental `WebGPURenderer` for everything. Risk:
     it's still in flux and a few of our shaders/passes may not port
     cleanly. Best for a fresh start.
   - (b) Keep `WebGLRenderer` for rendering; only run the compute step
     under raw WebGPU. We hand-copy the compute output back to a WebGL
     texture each frame. Works but the GPU↔GPU copy is wasted bandwidth.
     Probably fine — we're already bottlenecked elsewhere.

   I'd recommend (b) — it's the lower-risk path. (a) becomes attractive
   later if we want compute shaders for other things (e.g., Barnes-Hut
   tree build).

5. **Fallback path.** Anyone without WebGPU keeps the WebGL2 GPGPU code
   intact, capped at lush/titanic. The two paths coexist; tier selection
   gates on `navigator.gpu`.

6. **Density UI.** Tiers above `titanic` only show when WebGPU is
   active. Currently I'd suggest adding a banner: "WebGPU detected —
   experimental tiers are 4× faster" so people know.

Estimated effort: **2–3 days for a working WebGPU path that hits
the speedup numbers above.** Most of the time is the new compute glue

- debugging buffer layouts.

### B — Barnes-Hut on GPU (highest ceiling, biggest lift)

O(N log N) instead of O(N²). For 1M particles that's 1M·20 ≈ 20M force
calcs per frame instead of 1T. **Could push to 1M+ bodies on a 4090.**

The algorithm:

1. Build an octree of the particles (parallel, on GPU).
2. For each particle, walk the tree top-down. Approximate any node
   that's "far enough away" (the Barnes-Hut θ criterion) as a single
   centre-of-mass body.

The hard parts are all in step 1:

- **Parallel octree build** — needs atomic counters or sort-then-build.
  The Burtscher/Pingali 2011 paper is the canonical reference; its CUDA
  implementation is ~500 LoC of dense atomics. WebGPU has limited
  atomics (i32/u32 on `var<storage>` only, not on textures), so the
  algorithm has to be reworked around storage buffers.
- **Memory layout** — node array, body-to-node assignments, traversal
  stack. Order-of-magnitude more bookkeeping than brute-force.
- **Edge cases** — bodies on cell boundaries, empty subtrees, theta
  thresholds for distant clusters. Lots of small bugs.

**Visual quality:** with θ=0.5, Barnes-Hut force errors are <1% of
brute-force. Indistinguishable in this project.

**Effort: 1–2 weeks.** Well-trodden algorithm but the GPU
implementation has lots of small numerical details to get right.

Worth it if we want to credibly hit 1M+ bodies. Overkill for 256k–500k.

### C — Spatial hash + cutoff radius (cheapest, but compromises physics)

For each body, only compute forces from bodies within radius R. Bin
bodies into a uniform grid and only query the 27 neighbouring cells.
O(N · neighbours-per-cell), which scales linearly when bodies are
roughly uniformly distributed.

**The catch:** gravity is long-range. A galactic-cluster scene like
`virgo-m87` or `lattice` only looks right because every body's mass
contributes to every other body's force, slowly. Cutting that off at
some radius means:

- Galaxy clusters wouldn't bind together.
- The "filament" structure in the cosmic-web scene goes away — bodies
  no longer feel the long-range gravity that draws them onto sheets.
- Anything orbital with a wide enough orbit would be wrong.

So this path **breaks the physics that makes the project look like
itself**. The reason the existing brute-force approach is the right
shape is precisely because gravity is long-range.

A combination — local short-range with a Barnes-Hut long-range — would
work but at that point you're just doing Barnes-Hut.

**Verdict: skip.** Listing it for completeness; not the right tool here.

## Recommended plan

```
phase 1 — WebGPU compute + tiles + WebGLRenderer (option A.b)
            adds titanic at 60fps, colossal at 30–45fps, abyssal at 12–20fps
            ~2–3 days of work
            keeps WebGL fallback for users without WebGPU

phase 2 — gauge appetite for going further
            if 256k feels like enough: stop here
            if we want 1M+ on a 4090: start phase 3

phase 3 — Barnes-Hut on WebGPU
            ~1–2 weeks of work
            unlocks tiers up to 1M / 2M / 4M bodies if we want them
            adds more "experimental" sub-tiers behind even louder warnings
```

Phase 1 alone gets the user-visible win: the abyssal tier becomes the
"works on serious hardware" tier instead of the "slideshow" tier, and
titanic + colossal become daily-usable on a 4090.

## Open questions to discuss

1. **Renderer split (option A.a vs A.b)?** The lower-risk WebGLRenderer
   - raw WebGPU compute path is what I'd start with. Going all-in on
     `WebGPURenderer` is more elegant but risks chasing Three.js
     experimental-API issues.

2. **Fallback scope.** For users without WebGPU (Firefox stable today,
   anything older), do we cap at `lush`? Or also expose `titanic` knowing
   it'll be slow? I'd cap at lush — anything experimental should be
   gated on having the hardware to use it.

3. **Are we ok requiring a WebGPU-capable browser for experimental
   tiers?** That's most users on Chrome / Edge / Safari, but Firefox
   stable users (a real chunk on desktop) get nothing. Adding a
   "Firefox Nightly works" hint in the UI helps.

4. **Would phase 3 be worth it?** Brutally honest: 256k bodies is more
   than the simulation can usefully _show_ — most pixels already saturate
   at lush. Pushing past that is bragging-rights territory (and very
   cool in screenshots). Worth flagging that we may not need Barnes-Hut
   to ship a great experience.

5. **What about other passes that are also bandwidth-bound?** Trails
   (full-screen accumulation), bloom (downsample/upsample) can also
   strain bandwidth at high tier. The per-tier perf clamps already
   shipping in [DENSITY_TIERS.md](DENSITY_TIERS.md) handle this on the
   FX side. WebGPU compute frees up budget that the clamps can then
   choose to spend on better visuals — they're complementary.

## What I need from you

Pick a phase to commit to, or push back on the plan. My recommendation
is **phase 1 only, see how it feels at colossal/abyssal, then decide on
phase 3.** If that sounds right, I'll start sketching the WebGPU compute
glue and the WGSL port of the gravity shader.
