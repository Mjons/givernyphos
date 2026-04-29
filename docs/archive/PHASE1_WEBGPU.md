# Phase 1 — WebGPU compute + tiled shared memory

A focused, audited implementation plan for replacing the WebGL 2
all-pairs gravity step with a WebGPU compute shader using workgroup
shared memory. Goal: push the playable ceiling on a 4090 from ~130k
bodies (today) to ~256k at 60 fps and ~500k at 30 fps without changing
visuals or physics.

This doc is the source of truth for phase 1. Phase 2 (Barnes-Hut) is
deliberately out of scope here.

---

## 1. Audit of what exists today

### 1.1 The work we're replacing

The full simulation step lives in two GLSL fragment shaders compiled
through `GPUComputationRenderer` (Three.js add-on, WebGL 2):

- **`buildVelocityShader(texSize)`** — [index.html:1644-1748](index.html#L1644-L1748).
  All-pairs gravity loop, plus a separate stochastic neighbourhood
  pass for flocking + radiation pressure.
- **`positionShader`** — [index.html:1750-1760](index.html#L1750-L1760).
  Trivial Euler integrator: `pos += vel * dt * sign`.

Both are wrapped as `gpu.addVariable(...)` and ping-ponged via
`gpu.compute()` (called per substep at [index.html:3285](index.html#L3285)).

### 1.2 Inputs / uniforms

The velocity shader currently consumes (from [index.html:1645-1653](index.html#L1645-L1653)

- [index.html:1773-1789](index.html#L1773-L1789)):

| Uniform           | Type      | Purpose                                              |
| ----------------- | --------- | ---------------------------------------------------- |
| `texturePosition` | sampler2D | RGBA32F, .xyz = position, .w = mass (>0 alive)       |
| `textureVelocity` | sampler2D | RGBA32F, .xyz = velocity, .w = `kindFloat + ageNorm` |
| `uDt`             | float     | Physics timestep                                     |
| `uG`              | float     | Gravitational constant (mood/accent modulated)       |
| `uEps2`           | float     | Plummer softening squared                            |
| `uSign`           | float     | +1 forward, -1 reverse — for time-reverse            |
| `uFrame`          | float     | RNG seed for the stochastic pass                     |
| `uK[NUM_KINDS²]`  | float[49] | 7×7 kind-interaction matrix                          |
| `uFlock`          | float     | Flocking strength                                    |
| `uRadiation`      | float     | Radiation-pressure strength                          |
| `uMaxAge`         | float     | Age normalization denominator                        |

`NUM_KINDS = 7` ([index.html:1366](index.html#L1366)). `uK` is laid out
row-major and indexed `kindA*7 + kindB`.

### 1.3 What writes the inputs

Initial body state is built CPU-side in
[index.html:2765-2766](index.html#L2765-L2766) — two `Float32Array` of
length `MAX_BODIES * 4`. Scene factories call `setBody(i, ...)` to
populate these. `uploadStateToGPU()` ([index.html:4988](index.html#L4988))
creates a `THREE.DataTexture` from each typed array and renders it
into the current GPGPU render target.

### 1.4 What reads the outputs

- **The point cloud renderer** ([index.html:14633-14636](index.html#L14633-L14636))
  reads `pointMat.uniforms.uPos.value` and `uVel.value` each frame:
  ```js
  pointMat.uniforms.uPos.value = gpu.getCurrentRenderTarget(posVar).texture;
  pointMat.uniforms.uVel.value = gpu.getCurrentRenderTarget(velVar).texture;
  ```
  The vertex shader reads via `texture2D(uPos, aRef)` where `aRef` is
  per-vertex UV in the GPGPU texture.
- **Stats / pick / follow-cam** all use `renderer.readRenderTargetPixels(rt, ...)`
  on the GPGPU texture — see [index.html:7929](index.html#L7929) (pick),
  [index.html:7993-7994](index.html#L7993-L7994) (follow-cam),
  [index.html:8121](index.html#L8121) (stats), [index.html:14179-14180](index.html#L14179-L14180).

### 1.5 What rebuilds when density changes

`rebuildPipeline(newTexSize)` ([index.html:7482](index.html#L7482))
preserves the current scene's uniform values, tears down the
`GPUComputationRenderer`, rebuilds it at the new size, re-uploads the
current scene's bodies, and rebuilds the per-vertex `aRef` attribute
on the point cloud. This contract has to be preserved by the WebGPU
path.

### 1.6 The bandwidth math (calibrated)

Each velocity-shader fragment does `O(texSize²)` texture samples on
both `texturePosition` and `textureVelocity`. Per frame at
`titanic` (texSize 360, MAX_BODIES = 129 600):

```
samples per fragment   = 2 × 129 600   = 259 200
fragments per frame    = 129 600
total samples / frame  = 16.8 × 10⁹
bytes per sample       = 16 (RGBA32F)
bytes / frame          = 269 GB
target bandwidth @60fps = 16 TB/s
4090 global memory BW   = ~1 TB/s
```

The card is asked for ~16× more bandwidth than it has. Texture cache
helps but only locally — there's no shared memory in WebGL 2 to
amortize across threads, so each fragment does its own redundant reads.

This is _the_ reason 4090 sees 20 fps at 130k. Compute is plenty.

### 1.7 The compute math (calibrated)

Tiling solves the bandwidth problem (§2.1). Once we're past that, the
new ceiling is FLOPs. Counting the inner loop in
[index.html:1610-1622](index.html#L1610-L1622):

| Op                           | FLOPs   |
| ---------------------------- | ------- |
| `kindB` extract + clamp      | ~3      |
| `d = posB.xyz - pA`          | 3       |
| `dot(d, d) + eps2`           | 6       |
| `r2 * r2 * r2`               | 2       |
| `inverseSqrt`                | ~5      |
| `G * posB.w * K`             | 2       |
| `d * invR3 * (G·m·K)` (vec3) | 6       |
| `acc += ...`                 | 3       |
| **Total per interaction**    | **~30** |

(`K` matrix lookup is a workgroup-shared read, not counted as FLOPs;
`posB.w <= 0` cull is a branch, not counted.)

Per-frame compute at N bodies: `N² × 30 FLOPs`. The 4090 peak FP32 is
**82.6 TFLOPS** boost, but tiled N-body kernels on Ada extract roughly
70% of peak — Nyland's reference hits 85% on H100; we have more
branches and a per-interaction matrix lookup, so derate to ~70% →
**sustained ~60 TFLOPS = 6 × 10¹³ FLOPs/s**.

```
N²_max(fps) = 6e13 / (30 × fps) = 2e12 / fps  interactions/frame
```

| Target fps | Max N (= √interactions) |
| ---------- | ----------------------- |
| 60         | ~183k                   |
| 30         | ~258k                   |
| 15         | ~365k                   |
| 12         | ~408k                   |
| 6          | ~577k                   |

**This is what gates each tier post-WebGPU**, not bandwidth. The §2.1
speedup table is an estimate — the abyssal row in particular is
optimistic; actual landing point is closer to 7-8 fps at 518k, right
on the compute boundary. We test on real hardware before deciding
whether to soften (§7).

---

## 2. Target architecture

### 2.1 The tile algorithm (Nyland, GPU Gems 3 ch.31, slightly adapted)

```
workgroup size: P = 256 threads  (one workgroup per body chunk)
shared memory:  P × vec4 (positions) + P × vec4 (velocities + kind)
                = 8 KB per workgroup, fits in any modern GPU's shared mem

per body i:
  acc = 0
  for tile k in [0, ceil(N / P)):
    cooperatively load P bodies from global memory into shared
    workgroupBarrier()                       ← wait for all loads
    for j in [0, P):
      if shared[j].mass > 0:
        accumulate force on i from shared[j]
    workgroupBarrier()                       ← wait before next tile load
  vel[i] += acc * dt * sign
```

Key property: each global memory read is shared across **P=256
threads**. The 16 TB/s bandwidth requirement drops by a factor of ~256
to **~64 GB/s**, well under the 4090's 1 TB/s. Compute throughput
becomes the new ceiling, and the 4090 has 36 TFLOPS to spend.

This is brute-force `O(N²)` in compute _— same physics —_ but with
optimal bandwidth. No accuracy tradeoff vs today.

### 2.2 Buffer layout

WebGPU compute uses storage buffers, not textures. Two options:

**Option A — flat storage buffers** (recommended):

```
positions:  array<vec4<f32>>   length = N
velocities: array<vec4<f32>>   length = N
output_velocities: array<vec4<f32>>   length = N
output_positions:  array<vec4<f32>>   length = N
```

Ping-pong between two pairs. Simple linear indexing
`bodies[global_invocation_id.x]`.

**Option B — keep texture layout** (compatible with WebGL renderer):
WebGPU supports storage textures (`texture_storage_2d<rgba32float, read_write>`)
but they're a less natural fit for shared-memory tiling and have stricter
format constraints. Skip.

Going with option A.

### 2.3 Bind group layout

```
@group(0) @binding(0) var<storage, read>       positions:        array<vec4<f32>>
@group(0) @binding(1) var<storage, read>       velocities:       array<vec4<f32>>
@group(0) @binding(2) var<storage, read_write> output_velocities: array<vec4<f32>>
@group(0) @binding(3) var<uniform>             params:           SimParams
```

`SimParams` packs all uniforms into a single struct (stride-aligned to
16 bytes per WebGPU rules):

```wgsl
struct SimParams {
  dt:         f32,
  G:          f32,
  eps2:       f32,
  sign:       f32,
  frame:      f32,
  flock:      f32,
  radiation:  f32,
  maxAge:     f32,
  N:          u32,
  numKinds:   u32,
  _pad0:      u32,
  _pad1:      u32,
  K:          array<f32, 49>,  // NUM_KINDS²
};
```

A second pipeline writes positions:

```
@group(0) @binding(0) var<storage, read>       positions
@group(0) @binding(1) var<storage, read>       velocities  (just-updated)
@group(0) @binding(2) var<storage, read_write> output_positions
@group(0) @binding(3) var<uniform>             params
```

Two pipelines per substep: velocity update, then position update.

### 2.4 Coexistence with the WebGL renderer (option A.b from the parent doc)

We keep `THREE.WebGLRenderer` for everything visual. The compute step
runs under raw WebGPU. Once per substep we copy the compute output
back into the WebGL2 textures the rest of the app already reads from.

```
WebGPU compute step → updates output_positions / output_velocities
                    ↓
mapAsync()  →  CPU staging buffer
                    ↓
THREE.DataTexture.needsUpdate = true
                    ↓
WebGL renderer + point cloud + post-FX (unchanged)
```

The CPU round-trip is the cost of keeping two graphics APIs alive in
the same page. At 256k bodies × 32 bytes × 60 fps that's 480 MB/s of
PCIe traffic in each direction — well within budget on any system that
can run this thing at all.

A future cleanup is possible (use `WebGPURenderer` for everything,
share GPU memory) but it's a much bigger surgery and is explicitly out
of phase 1.

### 2.5 Browser support (audited Apr 2026)

| Browser         | WebGPU | Default-on                |
| --------------- | ------ | ------------------------- |
| Chrome 113+     | ✅     | yes                       |
| Edge 113+       | ✅     | yes                       |
| Safari 17+      | ✅     | yes (macOS 14+, iOS 17+)  |
| Firefox stable  | ⚠️     | flag `dom.webgpu.enabled` |
| Firefox Nightly | ✅     | yes                       |

For users without WebGPU (~Firefox stable, plus old browsers):
fall back to existing WebGL2 GPGPU. They keep `lite / standard / dense
/ lush`. Experimental tiers are hidden.

Detection: `if (!('gpu' in navigator)) → fallback`. One check at boot.

---

## 3. The WGSL shader (concrete port)

This is a complete-enough port of `buildVelocityShader` that it should
compile and produce visually identical output. Comments map back to the
GLSL line they replace.

```wgsl
const NUM_KINDS: u32 = 7u;
const TILE: u32     = 256u;

@group(0) @binding(0) var<storage, read>       positions:  array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outVel:     array<vec4<f32>>;
@group(0) @binding(3) var<uniform>             p:          SimParams;

var<workgroup> tilePos: array<vec4<f32>, TILE>;
var<workgroup> tileVel: array<vec4<f32>, TILE>;

@compute @workgroup_size(TILE)
fn velStep(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id)  lid: vec3<u32>,
) {
  let i = gid.x;
  let alive = i < p.N && positions[i].w > 0.0;

  // Snapshot self even if dead; we still write a valid output below.
  let posA = positions[i];
  let velA = velocities[i];
  let pA   = posA.xyz;
  let mA   = posA.w;

  let kindFloat = floor(velA.w + 0.001);
  let ageNorm   = velA.w - kindFloat;
  var kindA     = i32(kindFloat);
  if (kindA > i32(NUM_KINDS) - 1) { kindA = i32(NUM_KINDS) - 1; }
  if (kindA < 0)                  { kindA = 0; }

  var acc = vec3<f32>(0.0);

  // ── all-pairs gravity, tiled ────────────────────────────────────
  let numTiles = (p.N + TILE - 1u) / TILE;
  for (var t: u32 = 0u; t < numTiles; t = t + 1u) {
    let srcIdx = t * TILE + lid.x;
    if (srcIdx < p.N) {
      tilePos[lid.x] = positions[srcIdx];
      tileVel[lid.x] = velocities[srcIdx];
    } else {
      // Pad inactive slots with mass=0 so the alive-check culls them.
      tilePos[lid.x] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
      tileVel[lid.x] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    workgroupBarrier();

    if (alive) {
      for (var j: u32 = 0u; j < TILE; j = j + 1u) {
        let posB = tilePos[j];
        if (posB.w <= 0.0) { continue; }
        let velB = tileVel[j];
        var kindB = i32(floor(velB.w + 0.001));
        if (kindB > i32(NUM_KINDS) - 1) { kindB = i32(NUM_KINDS) - 1; }
        if (kindB < 0)                  { kindB = 0; }
        let K     = p.K[u32(kindA) * NUM_KINDS + u32(kindB)];
        let d     = posB.xyz - pA;
        let r2    = dot(d, d) + p.eps2;
        let invR3 = inverseSqrt(r2 * r2 * r2);
        acc = acc + p.G * posB.w * K * d * invR3;
      }
    }

    workgroupBarrier();
  }

  // ── stochastic neighbourhood (flock + radiation) ────────────────
  // Identical math to GLSL lines 1700-1738; reads are direct from
  // the global storage buffer with hash22-derived indices, NOT
  // tiled — the 8 random reads aren't the bandwidth bottleneck.
  // (Implementation omitted for brevity; straight port.)

  // ── integrate ───────────────────────────────────────────────────
  let newVel = velA.xyz + acc * p.dt * p.sign;
  let dAge   = p.dt * abs(p.sign) / p.maxAge;
  let newAge = clamp(ageNorm + dAge, 0.0, 0.9999);
  outVel[i]  = vec4<f32>(newVel, kindFloat + newAge);
}
```

Position-update WGSL is ~10 lines, mirror of `positionShader`.

---

## 4. JS-side glue

### 4.1 Module shape

A new `wgpuSim.js`-equivalent block in `index.html` (or extracted to a
script) exporting:

```js
const wgpuSim = {
  available: false,         // navigator.gpu detected
  device:    null,
  queue:     null,
  init:      async (texSize, initialPos, initialVel) => { ... },
  rebuild:   async (texSize, initialPos, initialVel) => { ... },
  step:      (uniforms) => { ... },                // one substep
  readbackPos: async () => { ... },                // for stats / pick / follow
  readbackVel: async () => { ... },
  // CPU-side typed-array views of the latest output for the renderer.
  positionsBuf: null,
  velocitiesBuf: null,
};
```

### 4.2 Init sequence

```js
async function initWebGPU() {
  if (!navigator.gpu) return false;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return false;
  const device = await adapter.requestDevice();
  // Build pipelines, allocate ping-pong storage buffers, write
  // initial body data via device.queue.writeBuffer.
  // ...
  return true;
}
```

Called from `createGPGPU` ([index.html:1791](index.html#L1791)).
If it returns `true`, install the WebGPU step and skip the WebGL2 path.
If it returns `false`, current code runs unchanged.

### 4.3 Per-frame step

Replaces `gpu.compute()` in [index.html:3285](index.html#L3285):

```js
function simStep() {
  if (wgpuSim.available) {
    wgpuSim.step(currentUniforms);
    // Async readback; only stall if a stats / pick request is pending.
  } else {
    gpu.compute(); // legacy path
  }
}
```

### 4.4 Renderer hand-off

The point shader reads `pointMat.uniforms.uPos.value` as a `THREE.Texture`.
On the WebGPU path, after each compute step, copy the storage-buffer
output into a `THREE.DataTexture`:

```js
// After wgpuSim.step():
device.queue.copyBufferToBuffer(outVelBuf, 0, stagingBuf, 0, byteLength);
await stagingBuf.mapAsync(GPUMapMode.READ);
const data = new Float32Array(stagingBuf.getMappedRange()).slice();
stagingBuf.unmap();
// Update the existing DataTexture so pointMat / followCam / stats
// keep working unchanged.
posDataTexture.image.data = data;
posDataTexture.needsUpdate = true;
```

The `await` is the price of two-API coexistence. Async readback can be
double-buffered so it doesn't stall the next frame's submit.

### 4.5 Tie-in to existing density-tier code

In `setDensity` ([index.html:7811](index.html#L7811), today):

```js
// New: experimental tiers require WebGPU.
if (lvl.experimental && !wgpuSim.available) {
  showToast("Density", "experimental tiers need WebGPU");
  return;
}
```

In the density panel ([index.html:6845](index.html#L6845), today):
hide the experimental sub-section entirely if `!wgpuSim.available`.
The existing `MAX_TEXTURE_SIZE` filter stays — WebGPU has its own
`maxStorageBufferBindingSize` limit (typically 128 MB → ~8M bodies,
non-issue for our range).

---

## 5. Implementation phases (concrete order)

Each step is small enough to verify on its own.

### Step 1 — WebGPU device + capability check (~30 LoC)

- Add `initWebGPU()` async helper.
- On boot, set `wgpuSim.available`.
- In density panel, gate experimental tiers on this flag.
- Show a banner: "WebGPU detected — experimental tiers active" (or "WebGPU not detected — using WebGL fallback").
- **Verify:** open in Chrome, see "detected"; open in Firefox stable, see "not detected".

### Step 2 — buffer + pipeline scaffolding (~150 LoC)

- Allocate ping-pong storage buffers sized for the _current_ density tier.
- Compile the velocity-update WGSL (gravity + flock).
- Compile the position-update WGSL.
- Build bind group layouts + pipelines.
- **Verify:** logs show no errors. Pipelines compile.

### Step 3 — initial state upload + readback round trip (~80 LoC)

- After scene load, `device.queue.writeBuffer` the current `state.positions`
  and `state.velocities` into the WebGPU buffers.
- Without running any compute, do the readback round-trip and verify
  the data comes back unchanged.
- **Verify:** `Math.abs(roundTrip[i] - state.positions[i]) < 1e-6`.

### Step 4 — single velocity step (no flocking) (~60 LoC)

- Stub out the flocking branch; just gravity.
- Run one dispatch. Read back. Verify the velocity delta matches what
  the GLSL path produces for the same inputs (run both for one frame
  side-by-side, compare).
- **Verify:** `‖velDeltaWGPU - velDeltaWGL‖ / ‖velDeltaWGL‖ < 1e-3`
  (small float error tolerance from different math paths is expected).

### Step 5 — flocking + radiation (~80 LoC)

- Port the stochastic-neighbourhood block. Same `hash22` routine but
  WGSL-flavoured.
- Compare to WGL path. Visual diff should be undetectable.

### Step 6 — position step + ping-pong (~50 LoC)

- Add the position-update pipeline.
- Wire ping-pong between the two pairs of buffers.
- **Verify:** running for 60 frames with director paused gives the
  same body positions as the WGL path within numerical tolerance.

### Step 7 — renderer hand-off (~80 LoC)

- After each compute step, async copy outVel/outPos to the `THREE.DataTexture`
  bound to `pointMat.uniforms.uPos`/`uVel`.
- Double-buffer the readback so the GPU isn't stalled waiting for CPU.
- **Verify:** point cloud renders with the WebGPU path active. Visually
  identical to WGL at lush.

### Step 8 — rebuild on density change (~40 LoC)

- Tear down + recreate buffers when `setDensity` fires.
- Re-upload bodies.
- **Verify:** can switch lush ↔ titanic ↔ colossal ↔ abyssal smoothly.

### Step 9 — wire experimental tiers, watchdog already in place (~10 LoC)

- Density panel UI now exposes titanic / colossal / abyssal when
  `wgpuSim.available` is true.
- The existing perf watchdog from `DENSITY_TIERS.md` keeps working.

### Step 10 — integration testing (1-2 hours)

- Each of the 16 scenes at each new tier.
- Each cinematic flavour at each new tier.
- All three films at colossal+.
- Reverse time at colossal.
- Density-tier hot-swap during a film.

**Total: ~580 LoC of new code, ~3 days of focused work** including
debugging WebGPU pipeline mismatches (which always take longer than
you think).

---

## 6. Risks & known unknowns

### 6.1 The CPU-readback price

We're round-tripping through CPU memory each frame to feed the WebGL
renderer. Estimated cost at colossal (262k bodies × 32 B × 60 fps) is
~500 MB/s in each direction over PCIe. PCIe Gen 4 ×16 has 32 GB/s of
bandwidth so we're at <2% utilization — fine in practice. But:

- If the readback **stalls** the GPU (synchronous map without
  double-buffering), the gain disappears. Mitigation: keep two staging
  buffers and only `mapAsync` one frame behind. Frame N's compute
  reads frame N-1's data — one frame of latency, invisible at 60 fps.
- On systems where the iGPU and dGPU disagree (laptops with hybrid
  GPUs), the WebGL+WebGPU split could land on different devices.
  Mitigation: query both adapters and prefer the high-power one.

### 6.2 Float precision drift

WebGPU and WebGL2 may use slightly different reduction orders for the
gravity sum. Over thousands of frames the trajectories will diverge from
their WebGL counterparts even though each step is numerically equivalent
to <1e-3. This is **not a bug** — it's chaos, and the user can't tell.
But if anyone diff-tests the two paths assuming they should produce
identical state forever, they'll see drift. Document this.

### 6.3 The flocking branch's stochastic reads

The flock pass does 8 random texture reads via `hash22`. Those bypass the
tile and hit global memory directly. At titanic that's another 1M reads
per frame, ~16 MB of bandwidth — trivial. Not a perf concern but worth
naming so we don't get distracted optimizing it.

### 6.4 WebGPU adapter requirements

A few features we want require asking for them at adapter creation:

- `f32` storage buffer reads — universal, no flag.
- We do NOT need `shader-f16`, `bgra8unorm-storage`, or `timestamp-query`.
  Standard adapter is fine.
  But: if `adapter.limits.maxStorageBufferBindingSize` is below ~8 MB
  (unlikely on desktop, possible on phones), we have to cap. Check at boot.

### 6.5 The "first run is slow" effect

WebGPU pipeline compilation can take 100-500 ms on first use. Mitigation:
compile during scene load, before the user can pick an experimental
tier. If they pick before compile is done, show a brief spinner.

---

## 7. Success criteria

We call phase 1 done when **all** of these are true:

1. On a 4090 (the user's machine):
   - `titanic` (130k) sustains ≥ 55 fps.
   - `colossal` (262k) sustains ≥ 28 fps.
   - `abyssal` (518k) sustains ≥ 12 fps. **Compute-boundary tier**
     per §1.7 — math says we land closer to 7-8 fps. If real
     hardware confirms, the right call is either to drop this
     criterion to ≥ 6 fps or accept abyssal as "marginal, not
     promised." **Don't soften pre-emptively** — test then decide.
2. On a Firefox stable user (no WebGPU): the app still runs, capped
   at lush, no broken UI.
3. Switching density during a running cinematic does not drop frames.
4. The director's quiesce / framing-check / etc. all keep working at
   high tiers (proves the renderer hand-off is sound).
5. No visual regressions at lush vs. today (the GLSL path is unchanged
   for non-experimental tiers).
6. Density-tier hot-swap does not leak GPU memory across 50 swaps.

---

## 8. Decisions (locked in)

1. **WGSL location:** inline as template literals in index.html, same
   as the existing GLSL shaders. Keeps the single-file artifact intact.
2. **Staging buffers:** double-buffered. Two staging buffers (~8 MB
   each at colossal) so the readback never stalls the next frame's
   submit; one frame of latency for the renderer to read frame N-1's
   data, invisible at 60 fps.
3. **WebGPU path scope:** experimental tiers only (`titanic`,
   `colossal`, `abyssal`). Lush and below stay on the WebGL2 GPGPU
   path so any phase-1 regression can't damage the common case.
   Revisit consolidation in a future phase.
4. **Debug flag:** `?nogpu` URL parameter forces the WebGL2 path even
   when WebGPU is available. Cheap to add, useful for diffing the two
   paths and for incident response.
5. **Deal-breaker criterion:** deferred. We'll find out as we
   integrate; the staged plan in §5 means each step is independently
   reversible, so we can decide to abort cleanly at any point.

---

## 9. What I need from you

- Sign-off on the plan, or pushback on any of §6 risks or §8 questions.
- Commit to a target machine for benchmarking — your 4090 is the
  benchmark for "does this actually unlock new tiers". Let's land on
  that and treat the rest as fallback.
- Permission to start step 1 (~30 LoC, fully reversible).

If those land, I'll start sketching `initWebGPU()` and the bind-group
layouts in a feature branch.
