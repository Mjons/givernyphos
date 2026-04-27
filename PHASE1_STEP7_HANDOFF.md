# Phase 1 — Step 7 Renderer Hand-off

The renderer hand-off is the moment WebGPU compute output starts driving
what's on screen instead of WebGL2 GPGPU output. It's also the most
fragile step in phase 1 because every existing reader of the GPGPU
textures must keep working — the cinematic director's framing check,
follow-cam, click-to-follow, stats HUD, movie mode's chase-cam — all
of them assume `gpu.getCurrentRenderTarget(...)` is the live source of
truth.

This doc breaks step 7 into three phased commits, each independently
reversible, with concrete success criteria so we know each landed
clean before moving on.

---

## 1. Audit — what reads the GPGPU output today

Two distinct reader patterns:

### 1.1 Vertex-shader sampling (per-frame, inside render)

Once per frame in the main loop ([index.html:15396-15399](index.html#L15396-L15399)):

```js
pointMat.uniforms.uPos.value = gpu.getCurrentRenderTarget(posVar).texture;
pointMat.uniforms.uVel.value = gpu.getCurrentRenderTarget(velVar).texture;
```

The point-cloud vertex shader then samples them:

```glsl
attribute vec2 aRef;
uniform sampler2D uPos;
uniform sampler2D uVel;
// ...
vec4 pos = texture2D(uPos, aRef);
vec4 vel = texture2D(uVel, aRef);
```

**This is the hot path.** It's a GPU-side texture read, no CPU traffic.
Every body's vertex reads `uPos[aRef]` once per frame.

### 1.2 Synchronous CPU readbacks (sporadic, by feature)

`renderer.readRenderTargetPixels` calls scattered across:

| Location (line)                                                      | Caller                    | Reads                     | Cadence                     |
| -------------------------------------------------------------------- | ------------------------- | ------------------------- | --------------------------- |
| `pickBodyAtNDC` ([index.html:9183](index.html#L9183))                | click-to-follow           | full pos texture          | one click                   |
| `followCamReadBody` ([index.html:9248-9256](index.html#L9248-L9256)) | follow-cam tracking       | 1 pos pixel + 1 vel pixel | every frame while following |
| `followCamAttachByIndex` ([index.html:9375](index.html#L9375))       | director-follow           | 1 pos pixel               | one attach                  |
| `findSubject` ([index.html:6279](index.html#L6279))                  | movie mode subject finder | full pos + full vel       | once per shot               |
| `readBodyState` ([index.html ~13417](index.html#L13417))             | movie chase-cam           | 1 pos + 1 vel pixel       | every frame while filming   |
| `computeStats` ([index.html ~14179](index.html#L14179))              | HUD stats                 | full pos + full vel       | once per second             |

These are **synchronous** — they block until the GPU finishes reading
the requested pixels into a CPU array. WebGPU has no equivalent
synchronous primitive: `mapAsync` is the only way to read a storage
buffer from CPU, and it's async by design.

### 1.3 What survives unchanged

- The vertex-shader `texture2D` reads keep using `THREE.Texture`. We just
  point them at a different texture — a `THREE.DataTexture` we update
  ourselves each frame instead of a render-target texture.
- The aRef vertex attributes (one per body texel) are unchanged.
- All post-FX (bloom, CA, trails, etc.) read the rendered scene, not
  the GPGPU textures — fully unaffected.

---

## 2. Target architecture

### 2.1 Data flow

```
                                       ┌─────────────────────────┐
   WebGPU storage buffers              │  THREE.DataTexture(pos) │  ←── pointMat.uniforms.uPos
   (posA / posB / velA / velB)         │  THREE.DataTexture(vel) │  ←── pointMat.uniforms.uVel
              │                        └─────────────────────────┘
              │  copyBufferToBuffer            ▲
              ▼                                │
       staging[0] / staging[1]   ──── mapAsync ┘
       (alternating per frame)        + slice into image.data
```

Per-frame, after `wgpuStep`:

1. Copy current pos+vel buffers → next-free staging buffers.
2. Submit. Don't await yet.
3. mapAsync the staging from **two frames ago** (it's now done).
4. Copy mapped data into the DataTexture's `image.data`, set `needsUpdate=true`.
5. Unmap, mark this staging as in-flight.

This is double-buffered: at any instant one staging pair is being
filled by GPU, the other is mapped on CPU. The renderer reads from the
DataTexture (CPU-side image data), so it's always one frame behind the
WebGPU compute. **One frame of latency, invisible at 60 fps.**

### 2.2 Synchronous readers — CPU mirrors

Since WebGPU has no synchronous readback, the CPU-side `image.data`
buffer of each DataTexture **is** our CPU mirror. After the mapAsync
completes and we copy data in, those Float32Arrays hold the latest
ready-to-read state.

The synchronous readers all want a Float32Array view of the same data
they used to get from `readRenderTargetPixels`. Replace the read call
with a slice of `wgpuPosTex.image.data` (or velTex). They get the same
shape, same RGBA32F layout, same row-major indexing.

Latency: synchronous readers see one-frame-old state. Same as the
renderer. Click-to-follow picks the body that was at that pixel one
frame ago. Stats lag by one frame. None of this is user-visible.

### 2.3 Toggle / activation

Two modes:

```
mode 'wgl' (default):
  pointMat.uniforms.uPos = gpu.getCurrentRenderTarget(posVar).texture
  every frame: gpu.compute() × params.substeps
  sync readers: renderer.readRenderTargetPixels(rt, ...)

mode 'wgpu':
  pointMat.uniforms.uPos = wgpuPosTex   (DataTexture)
  pointMat.uniforms.uVel = wgpuVelTex
  every frame: wgpuStep × params.substeps + queue async readback
  sync readers: read from wgpuPosTex.image.data / wgpuVelTex.image.data
```

Activation captures live WebGL state, uploads it into WebGPU, swaps
the uniform pointers, sets `wgpuActive = true`.
Deactivation captures live WebGPU state, blits it back into the WebGL
render targets, swaps uniforms back, sets `wgpuActive = false`.

---

## 3. Phase breakdown

### 3.1 Phase 7a — DataTextures + manual readback

**Scope:** Allocate the persistent DataTextures and the staging buffers.
Add a devtools-only function that copies the current WebGPU buffer
contents into the DataTextures, on demand. No render-loop changes. No
visual change.

**Adds:**

- `wgpuSim.posTex`, `wgpuSim.velTex` — `THREE.DataTexture`s sized to
  `TEX_SIZE × TEX_SIZE`, format `RGBAFormat`, type `FloatType`.
- `wgpuSim.cpuStaging` — `[Float32Array, Float32Array]` for pos+vel
  CPU mirrors. Initially zero-filled.
- `__wgpuPushToRender()` — async helper that does one round-trip:
  copy buffers → staging → mapAsync → copy into DataTextures.
  Returns when DataTextures are updated.

**Verify:**

1. Reload — bodies still render normally (no regression).
2. From devtools:
   ```js
   await __wgpuPushToRender();
   ```
   should log `[wgpu] pushToRender OK: pos[0]=... vel[0]=...` and
   return `{ N, posMaxAbs, velMaxAbs }`.
3. Inspect: `wgpuSim.posTex.image.data` should match the last
   readback (within float tolerance).

**~70 LoC.** All devtools-isolated, no render-loop code touched.

### 3.2 Phase 7b — Live activation + per-frame readback

**Scope:** Make the WebGPU path actually drive the visible simulation
behind a toggle. Render loop branches on `wgpuActive`; when set, it
calls `wgpuTickFrame(substeps)` instead of `gpu.compute()` calls.

**Adds:**

- `wgpuSim.active: false` flag.
- `wgpuActivate()` — synchronously snapshots WebGL state, uploads to
  WebGPU buffers, points `pointMat.uniforms.uPos/uVel` at the
  DataTextures, sets `active = true`. After this, all simulation
  runs on WebGPU.
- `wgpuDeactivate()` — reverses the above. Snapshots WebGPU state,
  blits to WebGL render targets, points uniforms back at the GPGPU
  texture, sets `active = false`.
- Render-loop branch: if `wgpuSim.active`, run `wgpuStep × substeps`
  and queue an async readback. Use double-buffered staging so the
  `mapAsync` from frame N-1 can resolve while frame N's submit is
  in flight.
- `__wgpuActivate()` / `__wgpuDeactivate()` devtools entry points.

**Verify:**

1. Reload, run `await __wgpuActivate()`. Bodies should render
   identically to before. Watch FPS — should be at least as good as
   WebGL2 path on lush.
2. Switch scenes (number keys). New scene loads correctly.
3. Cinematic mode (C key) keeps director moves working — that proves
   the sync readers (framing check, follow-cam attach) still get
   sensible data.
4. Try movie mode (M key, pick a film). Track-streamer needs
   `findSubject` and `readBodyState` to work — if those fail, the
   chase-cam will hold pose.
5. Run `await __wgpuDeactivate()`. Bodies continue without a jump,
   sim resumes on WebGL2.

**~80 LoC.** This is the high-risk one — visual artifacts, FPS regression,
broken sync readers all show up here.

### 3.3 Phase 7c — Sync readers consume CPU mirror

**Scope:** Update the synchronous readers (pick / follow / stats /
movie subject finder + chase-cam) to read from `wgpuPosTex.image.data`
and `wgpuVelTex.image.data` when `wgpuSim.active` is true. Without
this, those features get stale or missing data in WebGPU mode.

**Adds:**

- Helper `wgpuReadPosCPU()` returning `wgpuSim.posTex.image.data` or
  the WebGL2 readback as appropriate.
- Update each of the six sync-reader sites to use the helper.

**Verify:**

1. In WebGPU mode, click-to-follow on a visible body — should attach.
2. Follow-cam tracks the body (no held pose).
3. HUD stats `ke / temp / rms` numbers update once per second.
4. Cinematic director's framing check rejects bad poses (visible via
   `Shift+D` debug overlay, `rejected` counter goes up occasionally).
5. Pick a film, verify track-streamer chase-cam follows the locked
   subject.

**~30-50 LoC.** Mostly trivial substitutions, but each must be tested.
Lower risk than 7b because the visual sim is already known good by
that point.

---

## 4. Double-buffering — concrete spec

We have two staging buffers per resource (`staging[0]`, `staging[1]`).
Two resources (pos, vel). Total 4 staging buffers — already allocated
in step 2 ([index.html:1737-1746](index.html#L1737-L1746)).

Per-frame state machine:

```
slot = frameCounter & 1   // 0 or 1, alternates per frame

ON FRAME N:
  copy posBuf → staging.pos[slot]
  copy velBuf → staging.vel[slot]
  submit
  // Don't await this frame's readback — let GPU work on next frame.

  // Map the previous frame's staging (already finished GPU-side):
  if (frame N >= 1):
    await mapAsync staging.pos[other_slot]    // already done, immediate
    await mapAsync staging.vel[other_slot]
    Float32Array view → posTex.image.data, posTex.needsUpdate = true
    Float32Array view → velTex.image.data, velTex.needsUpdate = true
    unmap both
```

Mapping a staging buffer that the GPU has finished writing is fast —
the await resolves immediately. Mapping one still in-flight blocks.
Double-buffering ensures we always map the "older" one.

**Edge case: very first frame.** No previous frame to map. Solution:
on the first frame after activation, also do a synchronous (`await`-ed)
readback before showing anything, so the DataTextures are populated at
t=0. After that, double-buffered.

---

## 5. Risks & mitigations

### 5.1 Visual mismatch on activation

**Risk:** Snapshot timing causes a 1-2 frame visual stutter when
toggling on/off.
**Mitigation:** Activation runs at frame boundary (top of render loop).
Snapshot is a single read, upload is single writeBuffer call — both
sub-millisecond.

### 5.2 mapAsync stall under load

**Risk:** If the mapAsync from frame N-1 hasn't finished by the time
frame N's render loop wants to update DataTextures, await blocks.
Whole frame stutters.
**Mitigation:** GPU usually finishes copyBufferToBuffer in < 1 ms.
With a 16 ms frame budget at 60 fps and 1 frame of latency, plenty of
slack. If it stalls anyway, we can extend to triple buffering.

### 5.3 DataTexture upload bandwidth

**Risk:** `posTex.needsUpdate = true` triggers a full GPU upload of the
DataTexture every frame — at lush that's 4 MB every 16 ms = 250 MB/s.
At abyssal, ~32 MB every 16 ms = 2 GB/s.
**Mitigation:** PCIe Gen4 ×16 has 32 GB/s, plenty of headroom. But on
laptops with shared memory, this could be a real cost. Worth measuring.

### 5.4 Float precision drift

**Risk:** The sync readers got bit-exact data from WebGL render
targets. Now they get data that's been WGSL-computed (which differs
from GLSL by tiny amounts, within float-summation-order tolerance).
The framing check / follow-cam / etc. would see ~1e-4 relative
differences in body positions.
**Mitigation:** None needed — those features all do approximate work
already (framing project + threshold, chase-cam smoothing, etc.).
Float drift below 1e-3 is invisible at the feature level.

### 5.5 Activation ↔ density tier collisions

**Risk:** User changes density tier while WebGPU is active.
`rebuildPipeline` re-allocates WebGL buffers, but our DataTextures
need to be re-allocated too (different TEX_SIZE).
**Mitigation:** In the rebuild path, also re-allocate
`wgpuSim.posTex/velTex` and re-upload state. Will be addressed in
phase 1's step 8 (rebuild on density change), which depends on 7b.

---

## 6. Out of scope here

- **Step 8** (rebuild pipeline on density change). Done after 7c.
- **Step 9** (wire experimental tiers to use WebGPU automatically).
  Currently the user toggles via devtools; step 9 makes the
  experimental tier selection imply `wgpuActivate()`.
- **Step 10** (integration testing across all scenes / films / density
  tiers). The test matrix.
- Any sub-frame profiling. The 80 LoC budget for 7b doesn't include
  perf instrumentation. We'll know FPS empirically; deeper profiling
  if a real issue surfaces.

---

## 7. Open questions

1. **Triple-buffering vs double?** Triple is one more staging buffer
   (~8 MB at colossal) and removes the last possible mapAsync stall
   when GPU is busy. Default to double; bump to triple if step 7b
   shows any per-frame jank.
2. **Should `wgpuActivate` block on the first round-trip readback** so
   the first rendered frame is correct? Slight initial latency, but
   means no flash of stale data. I'd say yes, default to blocking.
3. **What does deactivate do with state that's diverged?** WebGPU
   state and WebGL state diverge over time (chaos). On deactivate we
   blit WebGPU state back to WebGL — the live sim continues from
   wherever WebGPU was. Acceptable; the deactivation isn't a "rewind."
4. **Failure path:** if `wgpuStep` ever throws or hangs, we want to
   gracefully fall back to WebGL2 mid-frame. Watchdog?
5. **Should we expose a UI toggle, or keep it devtools-only?** I'd
   keep devtools for 7b and add UI in step 9 alongside experimental
   tiers, so 7b stays minimal.

---

## 8. Success criteria for step 7 overall

We call step 7 done when **all** of these are true:

1. `await __wgpuActivate()` then visual scene playback is
   indistinguishable from WebGL2 at lush. No flicker, no stutter,
   bodies in same positions ± float drift.
2. FPS at lush is at least 90% of WebGL2 baseline (the readback +
   DataTexture upload overhead is small).
3. Cinematic mode keeps working — director moves, mood/accent
   pulses, framing-check rejections happen normally.
4. Movie mode keeps working — film playback, track-streamer
   subject lock, scene transitions.
5. Click-to-follow works in WebGPU mode.
6. Density tier hot-swap during WebGPU mode does not crash. (May
   look glitchy until step 8; that's fine.)
7. `await __wgpuDeactivate()` returns the sim cleanly to WebGL2 with
   no visible jump.

If 1-3 fail, we revert just 7b. If 4-7 fail but 1-3 hold, those are
phase 7c work and 7b can ship.

---

## What I need from you

Sign-off on this plan, or pushback on any of §5 risks or §7 open
questions. If those land, I start phase 7a immediately —
non-destructive, devtools-only, ~70 LoC.
