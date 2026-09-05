# Performance Audit & Optimization Plan

> **2026-09-05:** Part 2's suspect ranking is superseded by
> [OPTIMIZATION_PLAN.md](OPTIMIZATION_PLAN.md) (sync-readback stalls,
> integrator, fill rate, kernel, BH close-out), whose Phase 1–2 fixes
> have landed. Part 1's measurement recipe still applies — fill the
> appendix table below and the plan's §5 table.

Goal: find the single biggest frame-time eater empirically, fix it, repeat. No guessing.

---

## Part 1 — How to measure (do this first)

### Step 1: Baseline numbers from Chrome DevTools Performance

1. Open the page in Chrome, set density tier to your target (e.g. `veryLush` 99k or `epic` 262k).
2. DevTools → **Performance** → record ~5 s of steady-state.
3. Note the three numbers at the top of the flame chart:
   - **Frame time** (target 16.6 ms @ 60 fps, 8.3 ms @ 120 fps)
   - **Scripting** (JS/CPU)
   - **GPU** (compositor + WebGPU work via the GPU process row)
4. Zoom into one frame, expand `loop` ([index.html:16592](index.html#L16592)). Record ms for:
   - `wgpuFrameStep` ([index.html:3089](index.html#L3089))
   - `composer.render` ([index.html:16677](index.html#L16677))
   - `audioReact.tick` ([index.html:16654](index.html#L16654))
   - `directorTick` ([index.html:16670](index.html#L16670))

If `wgpuFrameStep` dominates, go to Step 2. If `composer.render` dominates, jump to suspect #4.

### Step 2: Add WebGPU timestamp queries (one-time, ~30 lines)

> **DONE (2026-07-01).** `timestamp-query` is requested at device
> creation, velStep/posStep are wrapped with timestampWrites, and the
> results land in `wgpuSim.timing` (velMs/posMs per substep, plus
> readMs for the readback wall time). The debug overlay shows them on
> a `wgpu` line. The snippet below is kept for reference.

Right now there is **zero GPU-side timing** in the codebase ([index.html:16588-16612](index.html#L16588-L16612) only has a CPU FPS counter). Without timestamps you cannot tell whether `velStep` or `posStep` is the slow shader, or whether the readback is stalling. Add this once:

```js
// after device creation
const tsQuerySet = device.createQuerySet({ type: "timestamp", count: 8 });
const tsResolve = device.createBuffer({
  size: 8 * 8,
  usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
});
const tsRead = device.createBuffer({
  size: 8 * 8,
  usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
});
```

In `wgpuStep` ([index.html:2684](index.html#L2684)) wrap each pass:

```js
const pass = enc.beginComputePass({
  timestampWrites: {
    querySet: tsQuerySet,
    beginningOfPassWriteIndex: 0,
    endOfPassWriteIndex: 1,
  },
});
```

Resolve & read once per second (not per frame — that defeats the purpose):

```js
enc.resolveQuerySet(tsQuerySet, 0, 8, tsResolve, 0);
enc.copyBufferToBuffer(tsResolve, 0, tsRead, 0, 64);
// later: await tsRead.mapAsync(...); read BigInt64Array; convert ns → ms
```

This gives ground-truth ms for each compute pass independent of CPU frame time.

### Step 3: Three diagnostic toggles to bisect the bottleneck

Add temporary keyboard shortcuts (F9/F10/F11) that mutate runtime state:

| Toggle                                                                                        | What it isolates                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Disable readback (`return` early at [index.html:3120](index.html#L3120))                      | If FPS jumps, readback is on the critical path. If unchanged, GPU is the bottleneck. |
| `substeps = 0` (skip `wgpuStep` at [index.html:3098](index.html#L3098))                       | Measures pure render+post-processing cost.                                           |
| `composer.render` → `renderer.render` (skip post FX at [index.html:16677](index.html#L16677)) | Measures post-processing cost.                                                       |

These three toggles + Step 2 timestamps fully localize the bottleneck in under 10 minutes.

### Step 4: Scaling test

Run the same profile across density tiers ([index.html:1454-1471](index.html#L1454-L1471)): `lush` (65k), `veryLush` (99k), `epic` (262k).

- Frame time scales **~N²** → gravity compute is bound (expected; tile-based all-pairs).
- Frame time scales **~N** → readback / texture upload is bound.
- Frame time **flat then cliffs** → hitting a fixed cost (post-processing or GPU memory bandwidth).

---

## Part 2 — Ranked suspects (where the power is going)

Based on code inspection. Numbers come after Part 1, but priors below:

### #1 — All-pairs gravity in `velStep` (highest prior)

**Location:** [index.html:1881-2012](index.html#L1881-L2012), dispatched at [index.html:2723](index.html#L2723).
**Why suspect:** O(N²) tile-based gravity with `@workgroup_size(256)`. At 99k bodies that's ~3.9 × 10⁹ pair evaluations per substep. The recent commit `Drop titanic tier from 130k → 99k bodies` strongly implies this shader is already at the GPU's limit.
**Fixes (in order of effort/payoff):**

1. **Barnes-Hut or grid approximation** for far-field gravity. Keep direct sum for near neighbors, octree-summed for far. ~10× speedup possible at 100k+, but big rewrite.
2. **Cutoff radius** with spatial hashing — drop pairs beyond a distance threshold. Trades physical accuracy for FPS; depending on the visual goal this may be invisible.
3. **Reduce substeps** ([index.html:3098](index.html#L3098)) — if currently >1, halve and check whether motion looks the same.
4. **Workgroup tuning** — try `TILE=128` and `TILE=512` ([index.html:1863](index.html#L1863)). The right size depends on GPU; 256 is a good default but not always optimal.
5. **Move flocking/radiation/spin/hand-brush into a separate dispatch** so gravity-only kernel keeps register pressure low and occupancy high.

### #2 — Per-frame GPU→CPU readback ([index.html:3089-3155](index.html#L3089-L3155))

**Why suspect:** This is brand-new code (commit `WebGPU phase-1 step 7c: sync readers consume CPU mirror`, today). Every frame: copy 99k×16 bytes (1.6 MB) of pos + 1.6 MB of vel → staging → mapAsync → memcpy into Three.js DataTextures ([index.html:3130-3137](index.html#L3130-L3137)). That's ~3.2 MB/frame round-trip.
**Fixes:**

1. **Don't read back at all if nobody needs it.** Only the CPU mirror consumers (audio reactive? barycenter? director?) need this — gate the readback on whether any consumer is active. Render reads from GPU buffers directly via the DataTexture path at [index.html:16640-16641](index.html#L16640-L16641); does it actually need the CPU copy?
2. **Read back at lower cadence** — every 2nd or 3rd frame is invisible to a 60-Hz human eye for camera/audio purposes.
3. **Read back fewer particles** — barycenter / center-of-mass needs only a small reduced buffer (1 vec4), not all N. Add a reduction compute pass.
4. **Triple-buffer staging** so the next frame's submit doesn't wait on this frame's mapAsync resolve. Already partially done via `readbackBusy` ([index.html:3100,3138](index.html#L3100)) but worth verifying no implicit stall.

### #3 — Post-processing chain ([index.html:16677](index.html#L16677))

**Why suspect:** `composer.render` runs every frame. Each pass = full-screen quad + texture sample. Vignette, grain, bloom, etc. each cost ~0.5–2 ms at 1440p.
**Fixes:**

1. **Audit pass list** — disable each pass one at a time and watch FPS. Drop any that don't visibly contribute.
2. **Half-resolution bloom** if bloom is present — render bloom buffer at ½ res, upsample. ~4× cheaper.
3. **Single-pass merge** — combine vignette + grain into one fragment shader; saves render-target switches.

### #4 — Audio FFT ([index.html:16654](index.html#L16654), [index.html:4312](index.html#L4312))

**Why suspect:** Low. 512-bin FFT every frame is ~50 µs. Listed for completeness.
**Fixes:** Drop to 256 bins if profile shows it >0.5 ms; otherwise leave alone.

### #5 — Three.js Points draw with WebGPU-sourced DataTextures ([index.html:16640-16641](index.html#L16640-L16641))

**Why suspect:** Medium. The current bridge uploads CPU-mirror DataTextures back to the GPU as Three.js textures every frame — that's a CPU→GPU upload of the same 3.2 MB the readback just brought down. **Round-tripping the same data through CPU.**
**Fix:** ~~Plumb the WebGPU buffer directly into Three.js as a vertex buffer or shared texture.~~ **Not implementable** — browsers expose no WebGPU↔WebGL interop; a WebGPU buffer cannot reach the WebGL renderer without the CPU round-trip. The real fixes are (a) shrink the traffic (pos/vel cadence split, shipped 2026-07-01) and (b) render points from the WebGPU side — see [BARNES_HUT_PLAN.md](BARNES_HUT_PLAN.md) §5/M9.

---

## Part 3 — Recommended order

1. Add timestamp queries (Part 1 Step 2) — **~30 min, unlocks all further measurement.**
2. Run Part 1 Steps 1, 3, 4 — **~1 hr, produces the actual ranking.**
3. Apply the cheapest fix for whichever suspect Part 1 names winner. Re-measure.
4. Repeat until frame time hits target.

Don't implement fixes for #1–#5 speculatively. Measure first; the priors above are educated guesses, not data.

---

## Appendix — Quick-look numbers to record

Fill these in after Part 1 so the next person reading this doc has a baseline:

| Metric                 | 99k (`veryLush`) | 262k (`epic`) |
| ---------------------- | ---------------- | ------------- |
| Frame time (ms)        |                  |               |
| `wgpuFrameStep` (ms)   |                  |               |
| `velStep` GPU (ms)     |                  |               |
| `posStep` GPU (ms)     |                  |               |
| Readback resolve (ms)  |                  |               |
| `composer.render` (ms) |                  |               |
| FPS                    |                  |               |
