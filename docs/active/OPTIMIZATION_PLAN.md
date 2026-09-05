---
status: plan
last-updated: 2026-09-05
supersedes-parts-of: PERFORMANCE_AUDIT.md (Part 2 suspect list)
---

# Simulation audit & optimization plan — 2026-09-05

A code-inspection audit of the whole frame path (compute → bridge →
render → post → CPU consumers), ranked by expected frame-time impact
and confidence, followed by a phased plan with verify gates. No new
measurements were taken for this audit — the GPU timestamp
instrumentation from 2026-07-01 exists but the PERFORMANCE_AUDIT.md
appendix table is still empty. §5 says exactly what to run to turn
these priors into numbers.

The audit covers both **optimize** (frame time, stalls, fill rate)
and **improve** (correctness of the physics, backend parity, things
that make the picture better at the same cost). The Petrova Line
scene upgrade is scoped separately in §7 and is being built by a
parallel agent.

Line numbers are from the working tree on 2026-09-05 (with the
uncommitted Barnes-Hut drop applied). They will drift; the function
names won't.

---

## 0. Status

**2026-09-05, same day:** Phase 1 (Tier 1) + F10 + F14 landed in the
working tree, uncommitted and **unmeasured** — the build session had no
browser. Run §5 before committing. Console hooks added:
`__setIntegrator("symplectic"|"euler")`, `__setPointMax(px, bhPx)`.

| item                                        | state                                             | check                                                              |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| §3 async texel reader (`TexelReader`)       | done                                              | DevTools: no `readPixels` block under `loop` with follow-cam on    |
| F1 follow-cam per-frame reads               | done                                              | follow a body at lush on `?nogpu`; fps vs before                   |
| F2 barycenter readback (spin scenes)        | done                                              | frame-time histogram on a spin scene: no 12-frame spike            |
| F3 HUD stats alloc + readback               | done                                              | heap graph flat; stats still update ~1 Hz                          |
| F4 kickstart amortized, runs on WebGPU      | done                                              | `?scene=whirlpool` on WebGPU shows arms at t≈0; no freeze at lush  |
| F5 symplectic integrator                    | done, opt-in `?integrator=symplectic`             | `stats.ke` over 10 min on orrery: flat vs rising                   |
| F6 point-size clamp                         | done (256 / 1024 px × DPR)                        | pushin into event-horizon: GPU row; BH glow unchanged              |
| F10 GLSL kernel K-row hoist                 | done                                              | `?nogpu` fps at lush                                               |
| F14 `nul` files + `.gitignore`              | done                                              | —                                                                  |
| F7 render scale                             | `?scale=` / `__setRenderScale(s)`; watchdog lever; Lens slider | `?scale=1` on a DPR-2 display                          |
| F8 `preserveDrawingBuffer`                  | done (off)                                        | `e` export, thumbnail capture, recording still work                |
| F9 merged tail pass + half-res bloom        | done, opt-in `?post=lean` / `__setPostMode`       | A/B `?post=lean` vs default on 3 scenes; screenshots should match   |
| F12 bind-group cache                        | done                                              | WebGPU scenes unchanged; `wgpu` overlay line                       |
| F11 BH gates · F13 vendor                   | not started                                       | F11 needs your GPU; F13 needs a deploy-workflow decision           |

## 1. Snapshot — where the engine is

- One 788 KB `index.html`, 21.3k lines, Three.js r160 from unpkg.
- Two compute backends: WebGL2 GPGPU (`GPUComputationRenderer`,
  O(N²) fragment loop) and WebGPU (WGSL tile kernel, plus the new
  LBVH Barnes-Hut path behind `?bh=1`). Render is always WebGL2;
  WebGPU results bounce through the CPU (`wgpuFrameStep` → mapAsync →
  `DataTexture` re-upload).
- 7 density tiers, 4k → 518k bodies. `standard` (16k) is the default;
  `lush` (65k) is the sweet spot; titanic/colossal/abyssal are
  experimental with per-tier FX caps and readback striding.
- Post chain per frame: RenderPass → (lens) → UnrealBloom (5 mips ×
  2 blur dirs + composite) → Afterimage (when trail > 0) → CA →
  vignette+grain → OutputPass. At `min(devicePixelRatio, 2)`.
- In flight, uncommitted: BH M1–M6 + build-overhead cuts, timestamp
  queries, Cartwheel + Whirlpool scenes. Gates run only at 65k.
  Petrova Line is WebGL-only (WGSL kind-7 branch missing in both
  kernels).

---

## 2. Findings, ranked

Confidence: **H** = mechanism is unambiguous from the code; **M** =
likely, needs one measurement to confirm; **L** = plausible.

### Tier 1 — sync stalls and correctness bugs (fix first; zero visual risk)

**F1 · Follow-cam does two synchronous GPU reads every frame (WebGL path). H**
`followCamReadBody` (index.html:14242) calls `readPosTexels` +
`readVelTexels` for a 1×1 texel each frame. On the WebGL path both go
through `renderer.readRenderTargetPixels` → `gl.readPixels`, which
drains the entire GPU queue (the just-issued O(N²) compute pass
included) before returning. Effect: while follow-cam is active — the
user clicked a body, _or_ the director picked its `follow` move — CPU
and GPU stop overlapping and frame time ≈ CPU + full GPU instead of
max(CPU, GPU). Movie mode's `readBodyState` (index.html:18571) has the
same shape. The WebGPU path is unaffected (reads the CPU mirror).
_Fix:_ one async-readback helper (§3) used by all texel readers; the
follow-cam consumes a one-frame-old sample, which it already
low-passes anyway. _Effort:_ ~80 LoC. _Verify:_ DevTools Performance
with follow-cam on, before/after — the `readPixels` block under
`loop` disappears and GPU/CPU rows overlap again.

**F2 · Barycenter does a full-texture sync readback every 12 frames on spin scenes (WebGL). H**
`maybeUpdateBarycenter` (index.html:11094): when `params.spin ≠ 0`,
every 12th frame reads the entire position texture (4 MB at lush,
33 MB at abyssal) synchronously, then sums N bodies in JS. That is a
5 Hz hitch generator on every scene with spin. _Fix:_ same async
helper as F1, or better, a GPU reduction: draw N points additively
into a 1×1 float RT writing `(m·x, m·y, m·z, m)`, then async-read one
pixel. _Effort:_ ~60 LoC for the reduction. _Verify:_ frame-time
histogram on a spin scene — the 12-frame periodic spike vanishes.

**F3 · `computeStats` allocates two full-size buffers and sync-reads both textures every second. H**
index.html:20664 — `new Float32Array(TEX_SIZE²·4)` twice per call
(16 MB/s of garbage at abyssal) plus two full `readPixels` drains on
WebGL. The numbers only feed the HUD. _Fix:_ reuse module-level
buffers; on WebGL sample a 64×64 texel sub-rectangle (4k bodies is
plenty for KE / temperature / clumpiness estimates); route through
the async helper. _Effort:_ 20 LoC.

**F4 · Scene kickstart is lost on the WebGPU backend, and stalls scene entry on WebGL. H**
`uploadStateToGPU` (index.html:10966) mirrors the fresh state into
WebGPU buffers _first_, then runs `kickstartSim` on the WebGL GPGPU
only (index.html:11004). With WebGPU live, the 320 pre-roll frames
that Whirlpool / Milky-Way rely on (index.html:9859, 10036) never
reach the WebGPU buffers — the scene starts cold. On WebGL, 320
substeps of O(N²) are queued in one frame: ~2 s frozen at lush, tens
of seconds at colossal. _Fix:_ (a) when `wgpuSim.active`, run the
pre-roll as `wgpuStep()` calls instead; (b) amortize — spend the
kickstart budget across the transition's own frames (the flash and
the 3.2 s dissolve already cover it), e.g. 8 substeps/frame for 40
frames. _Effort:_ ~50 LoC. _Verify:_ Whirlpool on WebGPU shows arms
at t=0 like it does on WebGL; no multi-second freeze at lush.

**F5 · The integrator is forward Euler, not symplectic Euler. H**
README promises "Symplectic Euler — preserves phase-space volume".
`GPUComputationRenderer.compute()` renders every variable from the
_previous_ frame's textures, so `x' = x + v·dt` uses the _old_ v.
The WGSL path deliberately mirrors this ("position integrates against
the OLD velocity", index.html:4356). That is explicit Euler: energy
drifts upward and bound orbits slowly spiral out over a long dwell.
Symplectic Euler is `x' = x + v'·dt` with the _new_ velocity — same
cost, bounded energy error. _Fix:_ WebGL — add `velVar` before
`posVar`, drop `velVar` from `posVar`'s dependencies, and set
`posVar.material.uniforms.textureVelocity.value =
gpu.getAlternateRenderTarget(velVar).texture` before each
`gpu.compute()`. WebGPU — bind `velOut` instead of `velIn` in the
position pass. Put it behind `?integrator=euler|symplectic` for an A/B
week, then flip the default. Scenes were tuned against forward Euler,
so watch the tuned ones (orrery, event-horizon, petrova-line arrival
timing). _Effort:_ ~30 LoC + A/B. _Verify:_ `stats.ke` over a 10-min
dwell on `orrery`: flat-ish instead of monotonically rising.

**F6 · `gl_PointSize` is uncapped → overdraw spikes and cross-GPU inconsistency. H**
index.html:7156 — `sz * (320 / -mv.z)` with no clamp. A star of mass
2000 five units from the camera asks for a ~3000 px sprite; the
driver silently clamps at its `ALIASED_POINT_SIZE_RANGE` max (64 on
some Metal/Intel stacks, 1024 on D3D11/NVIDIA), so (a) pushin
transitions, follow-cam and fly-throughs cause huge additive-blend
overdraw on GPUs with a big max, and (b) the same scene looks
different across machines. _Fix:_ clamp to ~96 px and compensate
brightness by the clamped/unclamped area ratio (capped) so big bodies
still read bright. _Effort:_ 10 LoC of GLSL. _Verify:_ DevTools GPU
row during a `pushin` into event-horizon.

### Tier 2 — fill rate and post (the cost that scales with monitor, not N)

**F7 · Rendering at `min(devicePixelRatio, 2)` with a full-res post chain. H (impact M)**
index.html:5239. On a Retina Mac or a 4K/150% Windows display every
full-screen pass and every additive sprite pays 2.25–4× the
fragments, and bloom's mip chain starts at half of _that_. The FPS
watchdog can't help; it only lowers N. _Fix:_ a render-scale setting
(0.5–2.0, default `min(dpr, 1.5)`, `?scale=` override) applied via
`renderer.setPixelRatio` + `composer.setPixelRatio`; make it the
watchdog's _first_ lever before dropping a density tier. _Effort:_ 40
LoC + one UI row. _Verify:_ fps on a DPR-2 display at lush.

**F8 · `preserveDrawingBuffer: true` for the whole session. M**
index.html:5237. Forces the browser to keep the backbuffer readable
across frames, which disables the compositor's swap optimizations;
cost is highest on integrated/mobile GPUs. It exists for
`toDataURL` exports (index.html:19340, 19354) and `captureStream`.
_Fix:_ drop the flag; export by re-rendering into the capture path's
own render target (which `setCaptureSize` + `composer.render` already
does at 19352) and reading that, or call `toDataURL` synchronously
right after `composer.render()` inside the same RAF tick.
`captureStream` works without the flag. _Effort:_ 30 LoC. _Verify:_
Chrome `about:gpu` + fps on an iGPU laptop.

**F9 · Three separate full-screen passes at the tail (CA, vignette+grain, OutputPass), and full-res bloom input. M**
index.html:7955–7991. Each ShaderPass is a full-res RT write + read.
CA + vignette + grain + tone-map + sRGB can be one fragment shader
(`#include <tonemapping_fragment>` / `<colorspace_fragment>` give the
OutputPass behaviour). Bloom: `UnrealBloomPass` halves the resolution
you pass it; passing `innerWidth/2 × innerHeight/2` quarters the blur
cost with no visible change on a glow this soft — but
`composer.setSize` resets it, so re-apply after every setSize. _Fix:_
merged tail pass (−2 RT round trips), half-res bloom. _Effort:_ ~120
LoC. _Verify:_ Part 1 Step 3 toggle (`composer.render` →
`renderer.render`) gives the ceiling; expect to claw back ~30–40% of
the post cost.

### Tier 3 — compute

**F10 · The WebGL gravity kernel hasn't had the WGSL slimming. H (impact M)**
`buildVelocityShader` (index.html:6809–6825): per pair it does two
RGBA32F fetches (pos _and_ vel, the latter only for kind), a dynamic
`uK[kindA*8+kindB]` uniform-array index, and a `continue` on dead
bodies. The WGSL kernel already hoists the K row, uses branchless
`max(mass, 0)`, and reads `clamp()`ed kinds. _Fix:_ mirror those
three changes in GLSL (hoist `kRow[8]` before the loop; `max(posB.w,
0.0)`; drop the branch). Optional: a static R8 "kind" texture written
at upload so the inner loop fetches 16 B + 1 B instead of 32 B per
pair. _Effort:_ 30 LoC (+60 for the kind texture). _Verify:_ fps at
lush on `?nogpu`, before/after.

**F11 · Barnes-Hut: gates owed above 65k; astrophage parity (M7) missing in both WGSL kernels. H**
BH_TESTING.md has the recipes; only `lush` has been run. At 65k BH is
0.59× brute (expected); the crossover is predicted between 99k and
262k and has not been measured since the dispatch cuts. Meanwhile
every WebGPU tier silently runs petrova-line without thrust (index.html:2054,
2805). _Plan:_ run `__bhTree` / `__bhCompare` / `__bhBench` at
titanic → abyssal on collision, cartwheel, petrova-line,
event-horizon; fill the BH_TESTING table; then M7 (the astrophage
branch is part of the Petrova agent's brief, §7) and M8. _Effort:_
half a day of gates; M7 ~150 LoC.

**F12 · Bind groups rebuilt every substep; `createBindGroup` ×2 per `wgpuStep`. L**
index.html:4381–4405. Cheap on desktop, but trivially cacheable per
`which` side and per `wgpuSim.epoch`. Do it when touching that code
for F4/F5.

### Tier 4 — load, robustness, hygiene

**F13 · Three.js comes from unpkg at runtime. M (availability, not fps)**
index.html:1480. The 24/7 Twitch stream and the Vercel page both die
if unpkg hiccups. Vendoring `three.module.js` + the six addons next to
`index.html` keeps "no build step" while removing the third-party
runtime dependency; the importmap just points at `./vendor/`. Also
lets the page work offline. _Effort:_ 15 min.

**F14 · Repo hygiene.** Two stray `nul` files (Windows `> nul`
redirect artefacts, root + `scene_cards/`) are untracked and should be
deleted and gitignored. `screenshots/` is 98 MB and `ssi_tracks/` is
129 MB inside the code repo — fine for now, but clone time is the cost.

**F15 · `ship-test` scene is not registered.** `sceneShipTest`
(index.html:9396) exists and its comment says `?scene=ship-test`, but
there is no `SCENES["ship-test"]` entry, so the URL falls through to
quiet-drift. Folded into the Petrova agent's brief.

---

## 3. The one tool that unlocks Tier 1: async texel readback (WebGL)

F1, F2, F3 and the movie reader all stall for the same reason —
`gl.readPixels` into client memory. WebGL2 supports non-blocking
readback: read into a `PIXEL_PACK_BUFFER`, insert a `fenceSync`, and
poll `clientWaitSync(…, 0)` on later frames before `getBufferSubData`.
Three.js r160 doesn't wrap this, but the raw context is available via
`renderer.getContext()` and the render target's framebuffer via
`renderer.properties.get(rt).__webglFramebuffer`.

Shape of the helper (~80 LoC):

```js
// asyncReadTexels(rt, x, y, w, h) → Promise<Float32Array>
//   frame N:   bindFramebuffer(rt); bindBuffer(PIXEL_PACK_BUFFER, pbo);
//              readPixels(x, y, w, h, RGBA, FLOAT, 0); sync = fenceSync()
//   frame N+k: if clientWaitSync(sync, 0, 0) !== TIMEOUT_EXPIRED:
//              getBufferSubData(PIXEL_PACK_BUFFER, 0, out); resolve(out)
```

Consumers switch from "read now" to "use the latest resolved sample
and kick the next read". A one-frame-old follow target, barycenter or
stat is indistinguishable on screen. Keep the sync `readPosTexels`
for one-shot picks (click-to-follow, `followCamStep`) where a stall
is acceptable. On the WebGPU path the helper simply resolves from the
CPU mirror, so callers don't branch.

---

## 4. Phased plan

Each phase ends with a measurement, not a feeling. Numbers go in the
§5 table and in PERFORMANCE_AUDIT.md's appendix.

**Phase 0 — baseline (1 hour, before touching anything).**
Run §5 on the current tree at `lush` and `colossal`, WebGL and WebGPU,
with follow-cam off and on. This is the "before" column for
everything below.

**Phase 1 — stalls & bugs (Tier 1; ~1 day).**
Order: §3 helper → F1 → F2 → F3 → F6 (point-size clamp) → F4
(kickstart on WebGPU + amortize) → F5 (symplectic behind a flag).
_Gate:_ no `readPixels` in the per-frame flame chart during
follow-cam; Whirlpool pre-formed on WebGPU; no visible change at rest
except F6's near-camera bodies.

**Phase 2 — fill rate (Tier 2; ~1 day).**
F7 render-scale setting (and make it the watchdog's first lever) →
F8 drop `preserveDrawingBuffer` → F9 merged tail pass + half-res
bloom. _Gate:_ screenshot diff of three scenes at 1440p before/after
F9 (should be visually identical); fps on a DPR-2 display.

**Phase 3 — WebGL kernel (F10; half a day).**
Hoist K row, branchless dead bodies, optional kind texture. _Gate:_
`?nogpu` fps at lush; `__wgpuCompare`-style numeric parity is
unaffected since the math is identical.

**Phase 4 — Barnes-Hut close-out (F11, F12; 1–2 days).**
Gates at 99k / 262k / 518k on the five scenes; find the crossover;
M7 astrophage parity (Petrova agent); then decide M8 (leviathan tier)
vs. M9 (WebGPU point rendering) per BARNES_HUT_PLAN.md §10.
_Gate:_ BH_TESTING.md table filled; `rmsRel < 1%` on collision at
262k.

**Phase 5 — robustness (F13, F14; 1 hour).**
Vendor three.js, delete `nul`s, extend `.gitignore`.

Flip F5 to default only after Phase 1's A/B week on the tuned scenes.

---

## 5. Measurement recipe (fill this in)

PERFORMANCE_AUDIT.md Part 1 still applies; the additions since then
are the `Shift+D` overlay's `wgpu` and `bh` lines and the
`__bhBench()` console gate. Per configuration, record:

| config                            | frame ms | scripting ms | GPU ms | readPixels calls/frame | notes      |
| --------------------------------- | -------- | ------------ | ------ | ---------------------- | ---------- |
| lush · WebGL · idle               |          |              |        |                        |            |
| lush · WebGL · follow-cam         |          |              |        |                        | F1         |
| lush · WebGL · spin scene         |          |              |        |                        | F2         |
| lush · WebGPU · idle              |          |              |        |                        |            |
| lush · post off (renderer.render) |          |              |        |                        | F9 ceiling |
| lush · DPR 1 vs DPR 2             |          |              |        |                        | F7         |
| colossal · WebGPU · brute vs bh   |          |              |        |                        | F11        |

How: DevTools → Performance → 5 s steady state → expand `loop`;
`readPixels` shows up as its own block. For GPU ms use the overlay's
`vel/pos/read` on WebGPU, and the GPU process row on WebGL.

---

## 6. Improvements beyond frame time

- **Symplectic integrator (F5)** is the biggest physics-quality win
  available for zero cost. A KDK leapfrog (second order) is the next
  step if long dwells still drift; it needs one extra half-kick pass.
- **Point-size clamp (F6)** doubles as a cross-platform look fix.
- **Kickstart on WebGPU (F4)** restores Whirlpool/Milky-Way's
  pre-formed structure on the faster backend.
- **Astrophage parity (M7)** makes Petrova Line work at colossal /
  abyssal, where the beam finally has enough bodies to read solid.
- **Render-scale setting (F7)** is also the right knob for the Twitch
  encoder box: render at 1.0 and let OBS scale.

## 7. Petrova Line v2 — handed to a parallel agent

Scoped from PETROVA_LINE.md / PASSING_SHIPS.md; the agent's brief
lives in the session, the result lands in `scenePetrovaLine` and its
shader branches. Priority order it was given:

1. Respawn without popping: reset age on respawn, ramp brightness in
   over the first second of life and out over the last stretch before
   arrival (age is already carried in `vel.w`; the point shader gets a
   kind-7 ramp).
2. Beam with body: limb/polar-cap spawn with slight velocity jitter
   and a scene-driven spawn disc (the position shader currently
   hard-codes `(4, r=2)`), so the line has inner structure instead of
   a uniform ribbon; optional faint return stream (planet → star)
   tagged by mass so no new kind is needed.
3. Star and planet that read as bodies: scene-scoped sprites in the
   photon-ring style (`setPhotonRing` pattern) — a warm star disc with
   limb glow, a small planet disc whose arrival-side glow pulses with
   arrival rate.
4. Depth: a sparse dust/star neighbourhood (kind 3, near-zero mass)
   and a camera that shows the curve; SHOT_GRAMMAR entries for
   `event-horizon→petrova-line` (pushin) and `petrova-line→…`
   (pullback); short dwell hint.
5. Three seeded variants (Sol→Venus, Tau Ceti→Adrian, 40 Eridani→Erid)
   picked at scene init, with palette/tint/mass/thrust per variant.
6. WebGPU parity (M7): astrophage forces + respawn in
   `WGSL_VEL_SHADER`, `BH_WGSL_FORCE`, `WGSL_POS_SHADER`, with the
   `SimParams` growth done per the CHANGELOG ledger rule.
7. Ship sightings (Phase B): Hail Mary constellation as a _separate_
   18-vertex `THREE.Points` rendered before the Afterimage pass (no
   new kind, no texture writes), scene-local scheduler, rotating
   centrifuge, director soft-block during a cruise. Register
   `ship-test`.

Acceptance: beam visibly curves and never pops at either end; scene
holds up for 3+ minutes of dwell; identical behaviour on `?nogpu` and
WebGPU; no change to any other scene.
