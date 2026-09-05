# Changelog

Notable changes and — at the top — a **bug ledger** of regressions
that bit us once and shouldn't bite us again.

---

## Bug ledger — don't redo

Each entry: the bug, the failure mode, the fix, and the rule. Read
this before touching the relevant area.

### Audio `abort` event listeners cascade

**Bug:** A music-playlist "loop guarantee" added a listener for the
HTMLMediaElement `abort` event that called `next()` to skip broken
tracks. Pressing play caused the playlist to whip through every
track at ~250ms each, never actually playing audio.

**Failure mode:** The `abort` event fires every time `audio.src` is
replaced — that includes our own `load(idx)` calls, which set the
src on every track change. So:

1. `load(track A)` sets `audio.src = "A.mp3"`. Plays.
2. Track ends → `next()` → `load(B)` sets `audio.src = "B.mp3"`.
3. Browser fires `abort` for the now-cancelled "A.mp3" load.
4. Our handler treats the abort as a broken track → `next()` again.
5. `load(C)` aborts "B" → handler skips to D → loops forever.

`error` events can also fire alongside `abort` with `code === 1`
(`MEDIA_ERR_ABORTED`) during normal src changes, so naive `error`
handlers also cascade.

**Fix:** [ee6ac0e](https://github.com/Mjons/givernyphos/commit/ee6ac0e)

- Don't listen to `abort`.
- On `error`, ignore `audio.error.code === 1`. Only act on
  real failures (`MEDIA_ERR_NETWORK`=2, `MEDIA_ERR_DECODE`=3,
  `MEDIA_ERR_SRC_NOT_SUPPORTED`=4).

**Rule:**

> **Never bind `abort` on an HTMLMediaElement.** It is a normal
> lifecycle event for src changes, not a failure signal.
> When binding `error`, always check `audio.error.code` and skip
> code 1 (`MEDIA_ERR_ABORTED`).

### Adding a new `KIND_*` requires updating WGSL + WebGPU buffer sizes

**Bug:** Bumping `NUM_KINDS` from 7 → 8 (to add `KIND_ASTROPHAGE`)
worked on the WebGL path, but on WebGPU the `K[8*8]=64` matrix
silently truncated to 49 entries because the WGSL struct hardcoded
`K: array<f32, 49>` and the params buffer was sized at 320 bytes
(only enough for `K[49]`). Typed array writes past the end of an
`ArrayBuffer` are silent no-ops in JS, so the truncation was
invisible until astrophage fell outside the kept K-matrix region.

**Fix:** [96fbb0c](https://github.com/Mjons/givernyphos/commit/96fbb0c)

- WGSL struct `K: array<f32, NUM_KINDS²>` (currently 64).
- `PARAMS_BYTES` = 28 fixed floats × 4 + `NUM_KINDS²` × 4 + 16 headroom.
- `_wgpuParamsScratch = new ArrayBuffer(PARAMS_BYTES)`.
- `writeBuffer` size argument matches.

**Rule:**

> **Bumping `NUM_KINDS` requires four edits, not one.** The JS
> constant ([index.html:1563](index.html#L1563)), the WGSL constant
> in `WGSL_VEL_SHADER` (line ~1996), the WGSL struct's K array
> length, and `PARAMS_BYTES` + scratch buffer + writeBuffer size all
> live in different places and all silently mis-match if you change
> only one. Grep for `NUM_KINDS` and audit every hit.

---

## Unreleased

_(things in flight; not yet shipped)_

- **Token recipe tuning from the first contact sheet** (10 hashes ×
  lush/standard, `screenshots/token-sheet-2026-09-05.png`): channel
  stays authored (a drawn channel painted diffuse families black);
  palette pool excludes mono/bone; camera nudge is conservative (never
  closer than authored, gravity-well scenes yaw ±10° only); per-family
  pre-roll (`TOKEN_PREROLL`) so rings/tails/arms exist in the still;
  token-mode tier gain `uTierGain = √(65536/N)` so standard/lite match
  the lush brightness; discrete desktop GPUs get lush; Birth removed
  from the pool. Headless GPU render harness lives in the session
  scratchpad (`render-sheet.py`); WSL note in memory.
- **Sprite size now scales with viewport height** (`uViewScale` =
  drawing-buffer height / 1440, `syncPointViewScale`, `__setPointRef`).
  Sizes were absolute device pixels, so a 1200×750 canvas rendered every
  BH scene as one white glow (the token contact sheet caught it) and a
  2× screenshot shrank sprites by half. Unchanged on a 1440 px-tall
  window; 1080p windows get 0.75× sprites, 4K gets 1.5×. The F6
  brightness payback for capped sprites was removed the same day: it
  doubled the black-hole glow.
- **Token experience, slice 1** (TOKEN_EXPERIENCE.md): every token opens
  with a generated film played by the movie system — title card
  (family · palette · channel · #hash), slow-reveal from the core to
  the authored pose, seeded helical orbit, then a family signature
  shot (track the fastest body / vertigo dolly-zoom + pull-back / wide
  drift), then a 4.5 s settle back to the home pose and handover to
  the director. Any click, key or wheel skips. New bar: Tour ·
  Cinematic (state-lit) · Follow/Release · Lens · Moment · Return |
  Traits · Capture · ⛶, a state-aware hint line, bar + HUD fade after
  5 s idle. `movie.onEnd` hook added to `stopMovie`; `startMovie`'s
  toast is quiet in token mode.
- **Token mode, Phase A** (INTERACTIVE_NFT.md; decisions: Ethereum,
  100 tokens, no Petrova, no music, density = device concern):
  `vendor/three/` pinned r160 + addons; `tools/build-token.mjs` →
  `dist/token/` + `dist/token.zip` with no external requests;
  `index.html` §13c — `?token=<hash>` / `$fx` / `hl` parse,
  `deriveTokenRecipe` (versioned draw order: family, seed, scenario,
  palette, channel, post nudges, long exposure, doppler, spin, camera
  nudge), seeded starfield, scene lock, hotkey gate, token bar,
  `preview=1` deterministic still + ready signal, traits export.
  Verified in node: 20k recipes match the weight table, same hash →
  identical recipe. Not yet opened in a browser.
- **Docs: interactive NFT exploration** —
  [INTERACTIVE_NFT.md](docs/active/INTERACTIVE_NFT.md): one living scene
  per token; hash → recipe reusing share-state + seeded factories;
  token build (vendored three, no network), preview capture, holder
  interaction as ephemeral lens, platform fit, IP caveat on Petrova.
- **Docs: simulation audit + optimization plan** —
  [OPTIMIZATION_PLAN.md](docs/active/OPTIMIZATION_PLAN.md): ranked
  findings (per-frame sync `readPixels` in follow-cam/barycenter/stats,
  forward-Euler-not-symplectic integrator, uncapped point size,
  kickstart lost on WebGPU, DPR/post fill cost) + phased plan with
  gates. Petrova Line v2 scoped in its §7.
- **OPTIMIZATION_PLAN.md Phase 1 landed** (built without a browser —
  run the plan's §5 recipe before committing):
  - `TexelReader` — fenced PIXEL_PACK_BUFFER async readback on WebGL2
    (plan §3); resolves from the CPU mirror on WebGPU; latches onto the
    blocking read if a driver refuses PBOs.
  - Follow-cam, barycenter and HUD stats consume one-frame-old samples
    instead of draining the GPU queue (F1–F3). `computeStats` reuses
    its buffers and strides above 64k bodies.
  - Scene kickstart is amortized over frames (`kickstartTick`, budget
    ≈6e5 body-substeps/frame, pre-roll scaled down above 65k) and runs
    on the WebGPU backend too — it used to run only on the WebGL
    textures, so Whirlpool / Milky Way started cold on WebGPU (F4).
    Density watchdog ignores the burst.
  - `?integrator=symplectic` / `__setIntegrator("symplectic")` —
    velocity pass first, position from the NEW velocity, on both
    backends (F5). Default stays `euler` (today's forward Euler) until
    the tuned scenes are A/B'd; then flip `params.integrator`.
  - Sprite size caps: `uPointMax` 256 px, `uPointMaxBH` 1024 px, ×
    pixel ratio, with up to 2× brightness payback; `__setPointMax(px,
bhPx)` (F6).
  - GLSL gravity loop hoists kindA's K row and `uG`/`uEps2` out of the
    O(N) loop, `clamp()`ed kinds, like the WGSL kernel (F10).
  - Stray `nul` files removed; `.gitignore` covers them (F14).
  - `preserveDrawingBuffer` off — every canvas reader already renders
    synchronously before reading (F8). Render-scale knob: `?scale=`
    (0.5–2) / `__setRenderScale(s)`; default unchanged (F7, knob only —
    the watchdog lever and a settings row are still to do).
  - Lean post chain, opt-in `?post=lean` / `__setPostMode("lean")`:
    one merged CA + vignette + grain + ACES + sRGB pass replaces three
    full-res passes, and the bloom mip chain runs at half its base
    resolution (F9). Default stays "full" until eyeballed.
  - WebGPU bind groups cached per ping-pong side, rebuilt on buffer
    epoch / integrator change (F12).
  - Density watchdog's first lever is now render scale → 1× when the
    page runs above 1 device px per CSS px; the tier step-down only
    follows if fps is still low (F7).
  - `Shift+D` overlay gains `engine` (integrator, render scale, post
    mode, pre-roll left) and `readback` (pbo / mirror / fallback, fps)
    lines for the §5 measurement recipe.
- **Smooth wheel zoom** — OrbitControls applied each wheel event as an
  instant 0.95^(Δ/100) dolly (a notch = a 5% jump, a flick = a burst
  of them). Wheel input now accumulates into a log-distance target and
  the camera eases toward it (τ ≈ 140 ms), ±3 notches max per event,
  min/max distance respected. Works during follow-cam by scaling the
  chase-rig distance with the same easing. Touch pinch is unchanged.
  Listener lives on `document` in the capture phase so OrbitControls'
  handler never fires for the canvas.
- **Movie track shots read the subject asynchronously** — `readBodyState`
  now uses `TexelReader` like follow-cam (first call for a new subject is
  synchronous so the shot starts on the body). Last per-frame
  `readPixels` drain on the WebGL path.
- **Density change keeps the scene seed** — `rebuildPipeline` re-applies
  the scene with `currentSeed()`, so the layout (and petrova-line's
  variant) survives a tier change instead of re-rolling.
- **`?rehearse=ships` no longer enables the director's 10× rehearsal** —
  it is the Petrova ship-sighting rehearsal only.
- **Settings → Lens → "Render scale" slider** (0.5–2×, 0.25 steps)
  wired to `setRenderScale`; reflects the watchdog's lever.
- **Petrova Line v2** (OPTIMIZATION_PLAN.md §7; built without a
  browser — run the test URLs in the session report before committing):
  - **No popping.** Arrival resets age to 0 (velocity shaders write
    `kind + 0.0`); `pointVert` ramps kind-7 brightness over the first
    sim-second of life and dims to 0.2 between 2.5× and 1× the arrival
    radius (`uPlanetPos` / `uPlanetRadius` on `pointMat`, set by the new
    `applyAstroUniforms`, which also runs at the transition body swap
    so a swapped-in beam moves immediately).
  - **Scene-driven launch cap.** `uSpawnOffset` / `uSpawnRadius`
    (GLSL vel + pos shaders via the shared `ASTRO_SPAWN_GLSL`,
    `installSimUniforms`, `applyAstroUniforms`, `rebuildPipeline`
    preserve). Bodies leave a polar cap with a launch velocity
    (`ASTRO_LAUNCH` = 1.6× circular, ±25 %, cone jitter) and the thrust
    now damps lateral velocity (`ASTRO_STEER` = 0.5/s): pure central
    thrust conserves angular momentum about the planet, so any lateral
    launch missed the arrival radius forever (offline sweep). Tuned
    per variant: transit 4.5–5.7 sim-s, arc sag 13–18 % of the chord,
    100 % arrivals.
  - **Bodies that read as bodies.** Star + planet billboard glow discs
    (`makeGlowDisc`, `setPetrovaDeco`, `petrovaDecoLevel`), faded like
    the photon ring in `applyScene`, `doSceneSwap`; the planet's
    arrival-side lobe pulses from the scene tick. `SCENES[key].tick`
    hook added to `loop()` after `updateSolarSystem`.
  - **Depth + director.** ~400 kind-3 dust on slow orbits (new
    `K_PRESETS.petrova`: star/planet rows zeroed so the anchors stay
    put), 3/4 camera, `SHOT_GRAMMAR` for event-horizon ↔ petrova-line
    and petrova-line → stephans-quintet, `cinematic: { allowMoods:
false, minInterestVar: 0 }` (a channel mood to mass/age blacks out
    the beam; the KE gate would cut a steady-state scene).
  - **Three seeded variants** (`PETROVA_VARIANTS`, weights .3/.5/.2,
    `?petrova=sol|tau-ceti|eridani`): palette, kind-7 tint
    (`makePetrovaTint`), masses, thrust, planet distance, sprite
    colours, caption — written onto the SCENES entry by `make()` before
    applyScene reads it (HUD caption follows).
  - **WebGPU parity (BH plan M7).** `SimParams` grows by 14 f32 after
    `K` (slots 92..105); `WGPU_PARAMS_BYTES` = 432 feeds the GPUBuffer,
    `_wgpuParamsScratch` and `writeBuffer`; `writeWgpuParams` fills the
    slots. Shared `WGSL_HASH22` + `WGSL_ASTRO_FNS`; kind-7 branch in
    `WGSL_VEL_SHADER` (written at the end — the tile loop's barriers
    need uniform control flow), respawn in `WGSL_POS_SHADER`, early
    return in `BH_WGSL_FORCE` (its TODO; plus one `${WGSL_ASTRO_FNS}`
    splice after its hash22).
  - **Ships, Phase B.** Hail Mary as a separate 18-vertex
    `THREE.Points` (`shipPoints`, own material, `pointFrag` look),
    Bézier cruise with arc-length LUT, 1 rev / 4 s centrifuge,
    scene-local scheduler (4 min floor + exp mean 10 min of
    time-in-scene), `?ship=hail-mary`, `?rehearse=ships` (8 s),
    director soft-block via `SCENES[key].holdTransition` →
    `sceneHoldsTransition()` at both DWELL exits. `ship-test`
    registered in SCENES (not SCENE_ORDER). Blip-A / Beetles / banking
    not built.

---

## 2026-07-01 (second drop)

- **Barnes-Hut LBVH gravity, M1–M6 code drop** — O(N log N) tree
  gravity behind `?bh=1` / `__bhToggle(true)`: AABB reduce → Morton
  keys ([kind:3|morton:27]) → stable LSD radix sort → Karras LBVH per
  kind segment → wavefront aggregate + ropes → stackless θ-MAC force
  walk with exact per-kind K rows. Falls back to the brute kernel
  until ready; brute path untouched and remains the oracle. Console
  gates: `__bhTree()`, `__bhCompare()`, `__bhBench()`, `__bhStatus()`.
  **Browser gates not yet run** — recipes in
  [BH_TESTING.md](docs/active/BH_TESTING.md).
- **SimParams.\_pad2 → theta2** — BH opening angle² rides a former pad
  slot (float 25); no buffer layout change, brute kernels ignore it.
  `?theta=0.7` overrides (0.1–2.0).
- **Timestamp slots 4/5 = BH build phase** — query set grown 4 → 8;
  debug overlay `bh` line shows build/force ms when live.
- **New scene: Cartwheel** (`?scene=cartwheel`, scene browser after
  Dust Storm) — compact intruder punches vertically through a cold
  rotating disc; expanding ring + spokes emerge from the radial
  crossing, ~15–20 s in. Fills the density tier; analytic
  enclosed-mass circular velocities (no O(N²) JS force-sum — too slow
  at 65k+). Works on both backends; hotkeys 1–8 unchanged.
- **BH gates passed at 65k** — `__bhTree` clean, `__bhCompare`
  rmsRel 0.38% / p99 1.07% (θ=0.5). Bench: brute 5.98 ms vs BH
  10.07 ms per substep — BH slower at 65k (dispatch overhead), as
  BARNES_HUT_PLAN.md §4 predicted; crossover expected ≥262k.
- **New scene: Whirlpool** (`?scene=whirlpool`, browser after
  Cartwheel) — M51-class grand-design spiral grown live: a cold
  featureless disc + a companion on a prograde parabolic pass;
  two tidal arms, bridge, and counter-tail emerge (pericenter
  ≈ 18 s, arms wind 30–70 s). No authored arms, unlike milky-way.
  Density channel + aurora palette so the palette traces the arm
  crests; doppler 0.25 makes the rotation read. Hotkeys unchanged.
- **BH build-overhead cuts** (same day, after the 65k bench):
  radix-scan stages fused 3→1 dispatch per pass (−16/substep, spans
  buffer deleted); aggregate wavefronts run over internal nodes only
  (leaves pre-marked done in both flag arrays by bhLeafInit — half
  the threads); `bhSim.aggIters` runtime-tunable and `__bhTree()`
  reports the measured tree `maxDepth` to guide it. Re-run all three
  gates after pulling these.

## 2026-07-01

- **WebGPU: GPU timestamp queries** — `timestamp-query` feature
  requested when the adapter has it; velStep/posStep wrapped with
  timestampWrites, resolved ~every 30th substep into
  `wgpuSim.timing`. Debug overlay gains a `wgpu` line
  (vel/pos/read ms, N, substeps, stride). Ground truth for
  PERFORMANCE_AUDIT.md Part 1 Step 2.
- **WebGPU: pos/vel readback split** — velocities now ride every
  `velStrideMul`-th readback (default 2) instead of every one; pos
  keeps full cadence since it carries the motion. Vel only feeds
  slow inputs (kind/age/doppler/speed-channel), so this cuts bridge
  traffic ~25% with no visible lag. `wgpuUploadState` sets
  `forceVelRead` so scene rewrites recolor immediately.
- **WGSL: gravity inner loop slimmed** — kindA's K-matrix row hoisted
  out of the O(N) pair loop into a function-scope array (was an
  indexed storage read per pair); dead-body `continue` replaced with
  branchless `max(mass, 0)`; kind clamps via `clamp()`.
- **Barycenter walks the CPU mirror in place** — on the WebGPU path
  `maybeUpdateBarycenter` no longer memcpys the full position mirror
  (8 MB at abyssal) into a scratch buffer before summing.
- **Docs: Barnes-Hut deep plan** —
  [BARNES_HUT_PLAN.md](docs/active/BARNES_HUT_PLAN.md): LBVH
  (Morton + radix sort + Karras) on WebGPU, per-kind segmented trees
  to keep the K interaction matrix exact, stackless rope traversal,
  memory/limit budgets, M0–M9 milestones to 1M–4M bodies. Notes that
  WebGPU↔WebGL buffer interop does not exist, superseding
  PERFORMANCE_AUDIT.md suspect #5's "plumb the buffer directly" idea.

## 2026-04-29

- **Music: fix runaway skip cascade** — see bug ledger entry above.
  ([ee6ac0e](https://github.com/Mjons/givernyphos/commit/ee6ac0e))
- **Music: loop guarantee** — `error` handler skips broken tracks,
  7-second watchdog resumes playback if paused without user intent,
  `state.userPaused` distinguishes user-pause from system-pause.
  ([916d55f](https://github.com/Mjons/givernyphos/commit/916d55f))
- **Petrova scene: browser entry + cover thumbnail** — `petrova-line`
  added to `SCENE_ORDER`, custom `scene_cards/petrova-line.webp`
  (1024×378, 16 KB) wired to `SCENE_COVERS`.
  ([98de70f](https://github.com/Mjons/givernyphos/commit/98de70f))

## 2026-04-28

- **Petrova steps 2-3: scenePetrovaLine + respawn lifecycle** —
  star + planet + N astrophage in a launch disc near the star;
  position-shader respawn snaps arrived bodies back to the disc;
  velocity-shader matches with arrival-zeroes-velocity. TINT_PETROVA
  for red shades. Scene scales to fill the active density tier.
  ([2f693f2](https://github.com/Mjons/givernyphos/commit/2f693f2))
- **Petrova step 1: `KIND_ASTROPHAGE` primitive plumbing** —
  velocity-shader kind-7 early-return branch with three-body forces
  (gravity to star + gravity to planet + thrust toward planet).
  `NUM_KINDS` 7→8, K matrix 49→64 entries, WGSL struct + PARAMS_BYTES
  bumped to match. WebGPU astrophage branch deferred.
  ([96fbb0c](https://github.com/Mjons/givernyphos/commit/96fbb0c))
- **Docs reorg + new design docs** — moved into
  `docs/{active,reference,archive}/`. New active docs: PETROVA_LINE,
  PASSING_SHIPS, EVENT_SCENES, ANDROMEDA_MERGER, ORACLE_AND_FLAVOURS,
  EVENT_HORIZON_TRANSIT(\_PLAN), PIXEL_THOUGHTS, USER_MOVIES_PLAN,
  CAPTURE_WYSIWYG_PLAN, PERFORMANCE_AUDIT, SHOW_DARK_MATTER_AUDIT.
  ([501aa56](https://github.com/Mjons/givernyphos/commit/501aa56))

---

## How to use this file

When you fix a bug that came from a non-obvious gotcha — especially
one that took >30 minutes to diagnose, or that hit a user — add a
**Bug ledger** entry at the top of this file before committing the
fix. Future-you will thank present-you.

Format:

- **Title:** the rule, in active voice. ("Don't bind `abort` on
  audio elements.")
- **Bug:** what happened, in plain language.
- **Failure mode:** the mechanism, in enough detail that someone
  who didn't see the bug can reason about it.
- **Fix:** link to the commit.
- **Rule:** the durable takeaway, blockquoted, that someone editing
  the affected code should read.

Routine feature work and tuning iterations belong in the
chronological section below the ledger, not in the ledger itself.
The ledger is for traps.
