# Hand-driven forces — failure audit

The hand-driven force terms (brush, fingertip gravity, COM pull) are
silently doing nothing. comPull at value 50+ should pulverize the
cluster onto the origin within a second, and we observe zero
detectable change. This doc walks the failure modes and proposes
surgical diagnostics, cheapest first.

---

## 1. What we know

### Confirmed working

- `?hands=1` URL gate parses → `handTracker.enabled = true`.
- Camera permission, video element, MediaPipe load, landmarker
  init — all work. Console shows `[hands] tracker ready`.
- Per-frame landmark detection works. Console shows ~30 hits/sec.
- Smoothed image-space coords flow into `handTracker.worldX/Y/pinch`.
- Fingertip dots and centroid cursor render correctly on screen and
  track the hand smoothly. Visible to the user.
- `updateHandWorld` projects centroid + tips to world space. Diagnostic
  shows world coords in plausible range (hundreds of units, sane signs).
- `handTracker.comPull` ramps to ~50 at hard pinch (post-fix). Visible
  in `[hands] ... comPull=` log line.

### Confirmed _not_ working

- COM pull at `comPull = 50` doesn't visibly contract the cluster.
- Per-fingertip gravity at `tipFinGain = 0.005` doesn't visibly
  gather particles.

### Unknown — never confirmed

- **Did the brush ever work?** User went from "cursor visible" straight
  to "let's add gather." We have _no observation_ that motion-driven
  push has ever moved a particle.
- **Did the original `handPull` (pinch → cursor attractor) ever work?**
  Same. Never confirmed visually.

This is the load-bearing realization: **we have no evidence that any
hand-driven force has ever reached the shader.** The cursor is purely
DOM. The diagnostic numbers are purely JS-side. Everything we've
observed could be explained by "the JS layer is fine, but the GPU
side never sees these uniforms."

---

## 2. The hypotheses, ranked

### H1 — WebGPU pipeline binding is wrong (most likely)

The WebGPU path was extended several times: handPos/handVel,
handStrength/handRadius, handPull, then 12 f32 for tips + comPull.
Each extension required:

- Updating the WGSL `SimParams` struct.
- Updating the `_wgpuParamsScratch` ArrayBuffer size.
- Updating `PARAMS_BYTES` (the GPU buffer allocation size).
- Updating `writeWgpuParams` to write at correct offsets.
- Updating the trailing `K` array's start offset.

If any one of those drifted, the kernel reads garbage at our hand
slots. Because the new fields are _additional_, the existing gravity
loop might still produce reasonable-looking output even if K is
shifted — the matrix interpretation just becomes lossy, particles
still feel mass-on-mass attraction.

A pipeline created from the _old_ WGSL (compiled before any hand
fields existed) would treat `K[0]` as starting at byte 64. Our
current `writeWgpuParams` writes `handPos.x` at byte 64. Result:
`K[0] = handPos.x`. The gravity loop sees a noisy K matrix that
roughly does what it always did, plus our hand uniforms write into
slots the old pipeline doesn't read at all.

**Test (cheapest):** force a hard reload (`Ctrl+Shift+R`) to ensure
the pipeline is recompiled from the new WGSL string. Then check
`window.__handTracker.comPullGain = 0` actually zeroes `comPull`
in the next diagnostic line. If the value sticks at the old gain,
the JS itself is stale; not the WGSL.

If JS is fresh but force still no-op, look at the _actual_ WGSL
compile path: search for `device.createShaderModule` and check
whether it's called once at WebGPU init or rebuilt anywhere. If
once, the WGSL string at the moment of init is what's running. The
project went through several phase-1 commits — likely the pipeline
is created exactly once in `wgpuInitPipelines`, which means the
_current_ WGSL string is what's compiled on each page load.

**Verdict ranking:** H1 is most likely if browser caching is
preventing a fresh JS load. Mostly likely _not_ the issue if we've
confirmed JS reloads cleanly.

---

### H2 — Three.js GLSL uniform plumbing silently dropping new uniforms

`installSimUniforms` (around [index.html:3970](index.html#L3970)) appends
new uniform objects to `velVar.material.uniforms`. If these are added
_after_ `gpu.init()` compiles the GLSL program, GLSL uniform locations
wouldn't be looked up for the new uniforms — they'd be Three.js
JS-side ghosts that update `value` but don't bind to GPU uniforms.

**Mitigating evidence:** `installSimUniforms` is called inside
`createGPGPU` _before_ `gpu.init()` per the scout. That should make
new uniforms present at compile time.

**But:** if there's a code path where the GPGPU is rebuilt (density
change, scene swap) and the `preserve` map doesn't carry the new
uniforms forward, the rebuilt material may default-init them but
not necessarily wire them into the live program correctly. We added
`uHandPos / uHandVel / uHandStrength / uHandRadius / uTipA / uTipB /
uTipC / uTipFinGain / uTipFinRadius / uComPull` — that's 10 new
uniforms not in the original `preserve` block at [index.html:9494](index.html#L9494).
On a density swap (or scene change?) the rebuild would lose any
in-flight values, but more importantly, may not register them in the
freshly-built shader.

**Test:** look at the GLSL path. Switch on with `?hands=1&nogpu=1` to
force WebGL2. If the cluster contracts on pinch under WebGL2, H2 is
falsified — at least the GLSL path works. If WebGL2 also no-ops,
this hypothesis lives, and the bug is on the Three.js side.

---

### H3 — `uCom` is `(0,0,0)` and the cluster is centered there

The COM pull is `acc += comPull * (uCom - particlePos) / (length + 50)`.
If `uCom = (0,0,0)` and a typical particle is at ~200 units from
origin, the force magnitude at `comPull=50` is `50*200/250 = 40`.
This _should_ be visible.

But: many scenes have particles spread _symmetrically_ around the
origin. The cluster as a whole might already be at COM, with
individual bodies orbiting symmetrically. Pulling everything toward
origin in such a scene shifts each body inward but the _visual
shape_ might not change much — the cluster looks the same, just
slightly tighter, and the inward radial velocity is masked by the
strong tangential orbital velocities.

In other words: at the camera's distance, a cluster going from
radius 200 to radius 180 could be visually subtle if there's no
reference object to compare. **The user might be looking at the
wrong indicator.**

**Test:** pick a scene where the cluster is clearly off-origin (e.g.,
a scene with a binary, or `pilgrim` mid-act). Pinch and watch. If
COM pull works there, H3 is confirmed and the fix is "use a more
visible test scene."

---

### H4 — `dt` or `sign` is being scaled to nothing

The integration step is `vel += acc * dt * sign`. If for some reason
`dt` is 0 or `sign` is 0, no force ever applies regardless of `acc`.

**Mitigating:** the existing scenes have visible motion (the user
said "the cursor tracks well" implying scenes look normal). So
gravity integration is happening, which means `dt * sign` is
non-zero.

**But:** what if there's a code path where the per-frame `dt` is
reset to 0 specifically when something in the hand-tracking init
runs? Unlikely but worth ruling out.

**Test:** add `console.log(velVar.material.uniforms.uDt.value)` once
per second and verify it's nonzero.

---

### H5 — All hand uniforms are being written but the kernel never

runs the hand-related code branch

WGSL has if-statement evaluation: `if (alive && p.comPull > 0.0)`.
If `alive` is somehow false or `p.comPull` reads 0 for some reason
(struct misalignment from H1, or uniform not bound from H2), the
branch never enters and `acc` doesn't gain the term.

This is a sub-case of H1/H2; the failure mode is the same — uniform
not reaching the shader.

**Test:** unconditional sledgehammer. In WGSL `velStep`, after the
spin block, add `acc.y = acc.y - 100.0;` _unconditionally_, no
flag. If the cluster still doesn't move down, the kernel itself is
broken (extreme — would mean physics doesn't run, contradicting
observed scene motion). If the cluster _does_ move down, the
kernel runs fine, and our hand-conditioned blocks are skipped.

---

### H6 — The pipeline is using a stale WGSL string captured at

module-load time

If `WGSL_VEL_SHADER` is captured by closure into a function that
created the pipeline once, and the closure reference is stale,
later JS edits to the _string variable_ don't affect the running
pipeline. (Not a hot-reload story — the user does full page
reloads.) On a full page reload, the entire JS module re-evaluates
fresh, so the WGSL string is the latest. So this should not bite
_unless the browser is caching the JS module_.

**Test:** look at the network tab on reload. Confirm `index.html`
fetches with status 200, not 304 (cached). Disable cache in
devtools.

---

### H7 — A buffer-size mismatch between scratch ArrayBuffer, WGSL

struct, and GPU buffer allocation

We have three sizes:

- `_wgpuParamsScratch = new ArrayBuffer(384)` ([index.html:2167](index.html#L2167)
  area)
- `PARAMS_BYTES = 384` (GPU buffer allocation)
- WGSL `SimParams` struct ≈ 340 bytes (computed: 24 header f32 +
  12 hand f32 + 49 K f32 = 85 f32 = 340 bytes)
- `device.queue.writeBuffer(buffer, 0, scratch, 0, 384)` (the copy)

If any of these drifted: the GPU buffer might be smaller than the
WGSL struct expects, or the copy might write more bytes than
allocated, or the kernel might read past valid data.

**Test:** grep for `PARAMS_BYTES`, `_wgpuParamsScratch`, and the
`writeBuffer` length argument. They should all be 384. If any is
still 320, that's the bug.

---

## 3. Diagnostic ladder — try in order

### Step 1 — Confirm the JS is fresh

```js
window.__handTracker.comPullGain = 0;
// wait one second, watch the diagnostic
```

The next `[hands]` log line should show `comPull=0.00`. If it shows
anything else, the JS in your tab is stale. Hard refresh.

**This is the cheapest, fastest, first test. Do this before anything
else.**

### Step 2 — Try the WebGL2 path

Open `index.html?hands=1&nogpu=1` and test pinch. If the cluster
contracts under WebGL2 but not WebGPU, the bug is **WebGPU-only**
(layout or pipeline). If neither works, the bug spans both paths
(uniforms not bound, or JS-side update never happens).

### Step 3 — Sledgehammer in WGSL

In `velStep` (search for `// Vorticity around the system barycenter`
in [index.html:1980-ish](index.html#L1980)), after the spin block
and _before_ `let newVel = ...`, add:

```wgsl
if (alive) {
  acc = acc - vec3<f32>(0.0, 50.0, 0.0);
}
```

That unconditionally pulls every body in -Y by 50/sec². No flag,
no uniform. Reload, look at the cluster. If it falls, the kernel
runs fine and our hand-conditioned blocks are simply not engaging.
If it doesn't fall, something fundamentally fails downstream of
`acc` (impossible given that gravity itself works, but worth
ruling out by direct test).

After the test, **delete the line.**

### Step 4 — Sledgehammer in JS

Bypass the entire pinch chain. In the `loop()` block where we push
uniforms, hardcode:

```js
u.uComPull.value = 200; // ignore handTracker entirely
```

If at `comPull=200` the cluster still doesn't move, the uniform is
not reaching the shader. (200 in this formula yields acc magnitudes
of ~160 at typical particle distances — utterly impossible to miss
visually.) That's our "uniform plumbing broken" smoking gun.

If the cluster _does_ react at hardcoded 200, then the issue is in
how we _compute_ `handTracker.comPull` from pinch — but the
diagnostic already shows that value reaching ~50, so this is
unlikely.

### Step 5 — Inspect the bound buffer in devtools

`window.__wgpuSim.buffers.params` exists per the scout. Read back
the buffer contents post-write:

```js
// In console after a frame:
const dev = __wgpuSim.device;
const stage = dev.createBuffer({
  size: 384,
  usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
});
const enc = dev.createCommandEncoder();
enc.copyBufferToBuffer(__wgpuSim.buffers.params, 0, stage, 0, 384);
dev.queue.submit([enc.finish()]);
await stage.mapAsync(GPUMapMode.READ);
const view = new Float32Array(stage.getMappedRange());
console.log("[35] (comPull):", view[35]);
console.log("[27] (tipFinGain):", view[27]);
console.log("[19] (handStrength):", view[19]);
```

If `view[35]` is what `__handTracker.comPull` computed, the GPU
buffer _has_ the right value. Then the issue is the kernel reading
the wrong slot — which is the layout-mismatch hypothesis (H1).

### Step 6 — Bisect by removing the centroid pull and other hand

terms one at a time

Comment out the brush and tip blocks in WGSL. Leave only comPull.
If comPull still doesn't engage, the issue isn't interaction
between hand terms. If it does engage with brush/tips removed,
something earlier in the kernel is consuming the `acc` budget.

---

## 4. The shape of a fix

If H1 wins (layout mismatch in WebGPU): the fix is mechanical — pin
down which offset is wrong and align the WGSL/JS sides. Worth
adding a one-time JS-side assertion: at boot, dispatch the kernel
with all hand uniforms set to known sentinel values, read back a
canary body's velocity, and verify it changed by the expected
amount. That kind of contract test would have caught the drift
during the multi-step extension.

If H2 wins (Three.js uniform binding): the fix is to ensure the
GLSL shader is rebuilt with all uniforms registered before any
material initialization. Possibly by collecting all uniforms in a
single pass at init rather than appending across calls.

If H3 wins (test scene problem): the fix isn't code — it's "test
on a scene where the effect is visible." But a working effect we
can't see is bad UX even if it's technically correct, so we'd want
visual reinforcement: make the COM render as a small marker, or
slightly modulate scene exposure when comPull is high so the user
_feels_ the gravitational tightening even when the visual
displacement is subtle.

---

## 5. What I'd do first

In order:

1. **Hard refresh** and verify `comPullGain = 0` actually zeroes
   the diagnostic. (60 seconds.)
2. **Try `?nogpu=1`** to bisect WebGPU vs WebGL2. (30 seconds.)
3. **If both still no-op,** drop in the WGSL sledgehammer (Step 3
   above) to confirm the kernel itself works. (2 minutes; remember
   to revert.)
4. **If sledgehammer falls but conditional doesn't,** read the
   buffer back from JS (Step 5). The slot containing `comPull`
   should match `__handTracker.comPull`.
5. **Then:** know exactly which layer is breaking, and write the
   targeted fix.

Total time to localize: under 10 minutes if approached this way.
The trap is the urge to "just try a different gain value" — the
diagnostics already show the JS side computes 50, the issue is
strictly downstream of that.
