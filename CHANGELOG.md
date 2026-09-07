# Changelog

Notable changes and — at the top — a **bug ledger** of regressions
that bit us once and shouldn't bite us again.

---

## Bug ledger — don't redo

Each entry: the bug, the failure mode, the fix, and the rule. Read
this before touching the relevant area.

### A file:// iframe needs `allow="fullscreen *"`, not `allow="fullscreen"`

**Bug:** In the collection viewer's live drawer the piece's own ⛶
button did nothing, while the viewer's own ⛶ worked.

**Failure mode:** The frame carried `allow="fullscreen"` plus the legacy
`allowfullscreen` attribute. A file:// document has an opaque origin,
which never matches the permission policy's implicit `'src'` allowlist,
so inside the frame `document.fullscreenEnabled` was **false** — and
the legacy attribute does not rescue it once `allow` names the feature.
Measured on Chrome 152 with six frames: no attribute → true; `allow=
"fullscreen"` → false; `"fullscreen *"` → true; `allowfullscreen` alone
→ true; both plain → false; `"fullscreen *"` + legacy → true.

**Fix:** `fr.allow = "fullscreen *"` (keep `allowfullscreen` for other
engines) in `tools/collection-template.html`.

**Rule:** For frames that may be file:// or otherwise opaque-origin,
grant delegated features with an explicit `*`, never the bare feature
name. The rule holds for the future site's token page too if it ever
frames the piece from a different origin.

### Bloom turns an unbounded HDR source into a hard-edged box

**Bug:** Every strong-source scene (Event Horizon, dense merger cores)
rendered a bright rectangle around the source — visible in the token
gate sheet as a box around token #40 and square "cores" in #31, and
accepted there because nothing measured it.

**Failure mode:** Additive point sprites stack without limit, so a
disc of thousands of overlapping bodies reaches HDR values in the
hundreds. `UnrealBloomPass` blurs with separable, finite kernels over
five mips; a source that bright saturates the kernel's whole footprint
at every mip, and the sum comes out of tone mapping as a plateau with
straight, slightly rounded edges. Disabling bloom removed it; the lens
pass, the ring quad, the starfield and the CA fallback were all
suspected first and are innocent.

**Fix:** `preBloomClampPass` (`min(rgb, uCap)`, cap 2.0) between the
lens pass and the bloom. Anything above the cap is already white after
tone mapping, so nothing but the box changes. Compared at 6 / 2 / 1.2.

**Rule:** Bloom input must be bounded. If a new pass or a new sprite
path feeds the composer before the bloom, keep it behind the clamp —
and when a still shows a rectangle, check the bloom before the shaders.

### A perfect lattice is force-balanced and never collapses

**Bug:** Four of the eight Lattice tokens (#30 #52 #78 #88) were
near-black frames; the 960×600 gate passed them because their mean
luminance (0.034) sat above the black threshold (0.03) on film grain.

**Failure mode:** `sceneLattice` built a fixed 14³ cube at every tier
(2744 bodies at lush — a few dim points 750 units away). Worse, a cube
of equal masses on a regular grid has zero net force on every body:
the only thing that ever started the "Order collapsing" show was the
recipe's vorticity term, so tokens whose spin trait rolled "none" sat
motionless through the whole pre-roll while the speed channel painted
them black. Raising the jitter alone (3.75 % → 8 %) did not start it
within 900 steps.

**Fix:** The crystal scales with the tier (side = cbrt(0.85 N), same
520-unit extent, same total mass), gets 8 % jitter, a thermal kick of
0.5 and a radial infall v = −0.02 r; token camera at 1.25×.

**Rule:** A family's opening must not depend on a rolled trait. When a
scene's motion comes from a symmetry break, put the break in the
generator. And gate stills against a threshold above the grain floor
(0.02 at 1600×900): the metadata tool flags below 0.015 and prints
per-id luminance so a dark family stands out by number.

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

### Follow-cam solar systems threw on lava / ice / ocean planets

**Bug:** `generateSolarSystem` declared `colorA` with `const` and then
reassigned it for the ICE and OCEAN planet types (`colorB` was already
`let`). Any follow that rolled one of those types threw
`Assignment to constant variable`, left a half-built system in
`solarSys`, and from then on `updateSolarSystem` threw every frame —
the canvas froze while the HUD kept updating. Found by the _Rewind_
film's follow shot (2026-09-06).

**Fix:** `let colorA`.

**Rule:**

> **A per-frame function that touches partially-initialised state must
> not be reachable after a failed builder.** Builders that populate
> shared state (`solarSys`, trails, decorations) should either build
> into a local and commit at the end, or set their state to NONE in a
> `catch`.

### WebGPU quad sprites must emulate GL's point-size clamp

**Bug:** The M9 WebGPU point path (one instanced quad per body,
WGSL mirroring `pointVert` term for term) matched the WebGL points
pixel-for-pixel in quiet-drift and event-horizon but rendered the
collision scene's galaxy cores at half the brightness (harness look
gate: mean |diff| 22/255, gate is 2).

**Failure mode:** At the collision camera distance most bodies ask
for a ~0.6 px sprite. GL clamps `gl_PointSize` to
`ALIASED_POINT_SIZE_RANGE` (min 1 px on every driver) _after_ the
vertex shader, so every WebGL body still lights exactly one fragment
at full alpha. A 0.6 px quad covers a pixel centre only ~⅓ of the
time, so thousands of core bodies silently vanished. Per-sprite math
was identical; the difference only showed where sprites are
sub-pixel, which is why two of three gate scenes passed.

**Fix:** `capSz = clamp(capSz, u.s4.z, u.s4.w)` at the end of the
WGSL vertex stage, fed from the WebGL context's actual
`gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)` (`wgpuRender.glPointRange`)
so both paths clamp identically on the same machine.

**Rule:**

> **Anything that replaces `gl_PointSize` with geometry must apply the
> driver's point-size clamp itself.** Mirror the shader math _and_ the
> fixed-function stage after it. And a look gate needs a scene where
> sprites are sub-pixel (far camera, dense cores) — close-camera scenes
> will not catch this.

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

- **Phones: the piece starts where the watchdog used to end up, and the
  site gets out of its way.** A phone (mobile UA, or coarse pointer with
  touch) now opens the piece at render scale 1× and the lean post chain
  from the first frame (`isMobileDevice()` in `initialRenderScale` and
  the post-mode hook; `?scale=` / `?post=full` still override) — the
  renderer is fill-bound there, and a 2.6× Pixel was pushing 7× the
  pixels through bloom for the 8–13 s the device watchdog needs to pull
  its first two levers. The bar's Bodies toggle switches between the
  device's own pair (`tokenBodiesPair()`: lite 4k / standard 16k on a
  phone, dense 33k / lush 65k on a desktop) instead of jumping any
  device to lush; `tokenDeviceTier` ignores a stored tier above standard
  on a phone, which is what that jump had left behind. The site's frames
  (content.js) start at `objects=standard&scale=1` with `tokenwd=on`, a
  new flag that keeps the token watchdog running under a pinned tier;
  `?objects=` alone still disarms it for the harness. Site, poster mode:
  the "Open live" row moves into the text column as a 46 px call to
  action (`.scene-data.in-flow`), the film chapter's link is the plain
  film page (`index.html?film=rewind` — the embed's `&objects=dense` was
  coming along, and a pinned tier also switched the watchdog off), the
  Next cue stacks above the soundtrack pill on phones (they overlapped at
  412 px) with a non-wrapping label, and both fixed pills drop
  `backdrop-filter` under `(hover: none)`. `tools/m9-cdp.mjs --mobile`
  emulates the Pixel (UA, touch, 2.625×, `hover: none` / `pointer:
  coarse`); verified headless: poster mode, both links, 4k → 16k toggle,
  and the hero frame at 16k / 1× with the watchdog on. `.prettierignore`
  (`*`): a `prettier --write` over the repo had turned into a
  28,850-line diff of vendored three.js twice in one day.

- **M9: WebGPU point rendering + WebGL composite** (BARNES_HUT_PLAN.md
  §7b, work item B; section "6b. WEBGPU RENDER PATH" in index.html).
  With the WebGPU compute backend live, `?render=wgpu` /
  `__setRenderPath("wgpu")` draws the bodies on the WebGPU side straight
  from the ping-pong storage buffers — one instanced quad per body,
  WGSL that mirrors `pointVert` / `pointFrag` term for term
  (`WGSL_RENDER_SHADER`) — into an offscreen `rgba16float` canvas that
  WebGL imports with `texSubImage2D(RGBA16F, HALF_FLOAT)` and adds to
  the scene as a screen-space quad while the `bodies` Points mesh is
  hidden. Post chain, capture, thumbnails and recording are untouched.
  Encoding is pluggable behind `WGPU_RENDER_ENCODING`
  (`"float"` default per the seam experiment, `tools/seam-test.html`;
  `"pack2"` lossless 8-bit fallback, `"rgbm"` last resort). On this
  path the per-frame readback drops to every `wgpuRender.mirrorEvery`
  (30) frames (`wgpuFrameStep` → `wgpuIssueMirror`); `wgpuForceMirror()`
  refreshes it before click-to-follow / F picks; follow-cam and movie
  track shots sample one body per frame via `WgpuBodyReader` (32-byte
  staging + mapAsync). Any failure sets `wgpuRender.failed`, logs
  `[render] …` and falls back to the WebGL points. Default stays
  `webgl`; `?render=wgpu` implies the WebGPU backend; token previews
  stay on WebGL. Also: `?compute=webgpu|webgl` (unsaved), a `?freeze=N`
  harness flag (director/drift off, N synchronous substeps once the
  backend settled, grain pinned, no toasts, paused; `done` waits for the
  mirror), a hidden `<pre id="perf-json">` with `__perfSnapshot()` (now
  with `renderPath`, `encoding`, `importMs`, `submitMs`, `composeMs`,
  `loopFrames`, `simTime`), and a `render` line in the debug overlay.
  Look gate (same page, same frozen state, both paths): collision 0.001,
  event-horizon 0.017, quiet-drift 0.006 /255 mean |diff| — after the
  point-size-clamp fix in the ledger above. Import costs 0.2–0.5 ms per
  frame; at 262k/518k the frame is now compute-bound (velMs 44/77 ms
  per substep on the 4090), so the render path alone does not move fps
  there — the mirror bounce is off the frame (readMs 1481→271 ms,
  2661→474 ms).

- **Movie engine: time and physics beats** (for the new film _Rewind_,
  docs/active/MOVIE_REWIND.md): `time` event (signed physics speed with
  a ramp — negative runs the sim backwards; crossing zero flips
  `params.reverse`), `ramp` event (exposure / bloom / grain / vignette /
  trail / fov), `prewarm` event (pre-roll through the amortized
  kickstart — `boost` steps per frame, `wait: true` holds the film
  clock and later same-timestamp events until it lands; never a
  synchronous burst, which froze the loop for seconds and jumped the
  film clock to its end card), `fade-in` travel, shot flags `freeze`
  (bullet time), `roll` (degrees,
  via `camera.up` so OrbitControls' re-aim keeps it), `lensFollow`
  (lens centre tracks a body), new `follow` shot program (the real
  follow-cam with trail and solar system, ticked from the movie loop),
  `camera.radius` on orbit/vertigo shots, `camera.tgt` on any shot
  ([x, y, z] or a finder name such as `"heaviest"` — re-centres the
  pivot, since a follow or track shot leaves it on its star),
  `subject: "bound"` finder (a disc star at `ring` distance from the
  heaviest body; `"fastest"` picks an escapee — the first cut rode a
  star 2500 units out into black), `look.grain/vignette/bloom/
exposure`, seeded `scene` events (`seed`, `scenario`, `collision`
  overrides such as `initialSep`, opening `camera`), title
  `style: "lower"`, `?film=<key>`. Track shots now move
  `controls.target` with the subject (OrbitControls' per-frame re-aim
  used to undo their lookAt). The film clock advances at most 0.25 s
  per frame (a tab switch or GPU stall no longer skips to the end
  card). A film's follow shot is silent (no toast, no lock chime).
  `stopMovie` restores reverse/paused/grain/vignette and releases any
  shot side effects. `__perfSnapshot().film` exposes the film clock;
  `tools/film-strip.mjs` screenshots a real-time headless run at chosen
  film timestamps — Chrome's virtual time never advanced the physics,
  so the earlier virtual-time strips only ever showed a few steps of
  evolution.
- **New film: Rewind** (4:22, _The Pair_) — one head-on merger
  witnessed, frozen and circled with a roll at closest approach, rewound
  in mono until the discs part, replayed from inside on the follow-cam,
  then a jump to the remnant in 6× time-lapse. `?film=rewind`.
- **Token-mode device watchdog** (launch board p2-watchdog;
  `tokenWatchdog` in §13c). Token mode ships at the tier
  `tokenDeviceTier()` guesses; the density watchdog only guarded the
  experimental tiers. The new one samples a rolling 5 s window after a
  3 s warm-up (not while hidden, mid-transition, rebuilding or
  pre-rolling) and, under 30 fps, pulls levers in order of visual cost,
  re-measuring after each: render scale to 1×, the lean post chain,
  render scale 0.75×, then one tier down (lush → dense → standard →
  lite — the tour is cut, the universe regrown from the same seed, the
  director takes over; the hint line says "lighter for this device").
  The verdict is stored per device (`phos.token.perf`: tier, scale,
  lean) and applied on the next open; `?objects=` disables it,
  `?tokenwd=test` forces one step, `?tokenwd=testall` the whole ladder,
  `__tokenPerf()` reports. `setDensity(key, { quiet: true })` skips the
  toasts. Verified headless: the forced ladder runs lean → 0.75× → dense
  → standard → lite → floor with no errors, a second open on the same
  profile boots at the stored verdict, and one step followed by 50 s of
  the director frames the token normally. `tools/film-strip.mjs --hold`
  keeps a run alive after the film ends and writes an end frame.
- **The collection site** (`site/`, docs/active/SITE_PLAN.md; three
  agents in parallel — shell, audio, content — then integration). A
  cinematic scroll-driven page next to the app: an Enter gate ("with
  sound" / "silent") that dissolves onto the live simulation (token #63
  in gallery mode) under the masthead; seven chapters — the piece (the
  Rewind film running live), seventeen families as a filmstrip of
  heroes, the hundred as a contact sheet linking into the viewer, the
  question, the soundtrack (46 tracks, per-track play), a colophon — a
  chapter rail, one live frame at a time (unmounted off-screen, posters
  on touch and reduced-motion), and `PhosAudio`: two `<audio>` elements
  crossfading 2.5 s on chapter changes with a mapping drawn from the
  films (The Pair → Slow Weather → Long Shadow … → The Edge of Day),
  ducking when a frame goes fullscreen, the ledger's error rules, a
  small player pill. Assets built by `tools/build-site-assets.py` from
  the previews (6.5 MB). Verified headless at 1600×900 and 390×844:
  every chapter, the frame handoff, the track handoffs, zero console
  errors. Open `site/index.html` from the app folder or the site.
- **Bodies, the holder's call** (token bar "65k" / "33k"): toggles
  between the two tiers that read as the same piece — lush 65k and
  dense 33k — regrowing the universe from its seed (the hint says so).
  The pick is stored per device (`phos.token.perf.manual`) and the
  watchdog stops stepping the tier afterwards; its render-scale and
  lean levers still apply. Verified headless: 65k → 33k → 65k in under
  five seconds, no errors. The site's two live frames now run at 33k
  (`objects=dense`), the homepage default.
- **Phones: bodies cycle 1k → 2k → 4k.** Two new tiers below lite —
  micro (32², 1k) and mini (45², 2k) — and on a phone the bodies button
  cycles 4k → 1k → 2k → 4k instead of toggling into 16k, which a phone
  cannot run. Desktops keep 33k ↔ 65k. The watchdog's floor on a phone
  is now 1k. Verified with an iPhone user agent: labels 4k, 1k, 2k, 4k
  and the HUD's 4.1k, 1.0k, 2.0k, 4.1k bodies, no errors.
- **Site: a "Next" cue.** The chapter rail on the right is easy to
  miss, so a pill sits at the bottom centre once you have entered —
  "Next · Not a rendering" with a bobbing chevron — naming the chapter
  that follows and scrolling to it; on the last chapter it reads "Back
  to the top". The hero's split-zone labels moved to the quarter points
  to keep the centre clear. Verified: visible after Enter, one click
  advances the current chapter, no errors.
- **Site: scroll above the fold.** The live frame swallowed every wheel
  event over the hero, so the page could not be scrolled from the top.
  The sky is now split: the left half belongs to the page (wheel and
  touch scroll), the right half to the piece (drag to orbit, wheel to
  zoom); on hover a hairline marks the split with "scroll" and "drag to
  orbit · wheel to zoom" labels. Verified: `elementFromPoint` on the
  left half is the scroll zone, on the right half the live frame. Touch
  devices have posters, so the whole width scrolls there.
- **`?bare=1`** — the piece with none of its chrome and none of its own
  music (HUD, rail, toasts, film and tour title cards, token bar and
  hint hidden; film music events ignored) for the site's live frames.
  The viewer also accepts `#family=<scene>` to open filtered.
- **Time, in the holder's hands** (token bar "Time"): ½× · 1× · 2× · 3×
  forward or rewind at 1×, cycled by the button, stepped with `[` `]`,
  flipped with `\` (or `t`); the hint line names the state ("time ×2",
  "rewinding · it never quite comes back"). Capped at 3× because speed
  is a timestep multiplier and the Rewind film's 6× ejected a merger's
  nuclei; reversal runs at 1× only because it drifts faster the faster
  it runs. The tour keeps its own tempo (the movie restores its baseline
  and the handover re-applies the holder's choice), a tier step-down
  re-applies it, Return resets it. `?time=3` / `?time=-1` for links and
  the harness. The token-mode keys are captured before the main
  handler's uncapped speed and reverse toggles.
- **Keep the system in frame** (`tokenFrameTick`): galaxies drift — a
  whirlpool's companion carries momentum, a remnant wanders — and the
  director orbited a fixed pivot, so after about a minute at 1× (sooner
  at 3×) token #63 was staring at empty sky. The barycentre is now
  sampled on the spin term's cadence in token mode (`maybeUpdateBarycenter(
force)`); while the director or an idle holder owns the camera the
  whole rig translates with it, and the post-tour settle aims at the
  system's displaced home. Verified on #63 for 110 s at 1× and 3×: the
  disc stays framed.
- **Collection viewer** — `collection.html`, one self-contained page
  (3.4 MB, JPEG thumbnails inlined) built by `tools/build-collection.py`
  from the identity table, the generated metadata and the previews:
  family list with counts and bars, palette / temperament / signature /
  spin / doppler / exposure chips with live counts, search by id, family
  or seed, sort by id, family, brightness or palette, and a drawer per
  token with the preview, description, every trait, the seed, "Open
  live", "Gallery mode", "Copy link", prev / next (arrow keys) and a
  "live" toggle that runs the piece in the frame. Live links are
  `./index.html?id=N` next to the app (folder, gateway or the site);
  `--live-base` points them elsewhere and `--artifact` writes the
  body-only copy claude.ai hosts. Opens with `#id=N` to land on a token.
- **Token mode on phones, and a gallery mode** (launch board p1-mobile,
  p1-gallery). Under `(max-width: 640px)` or a coarse pointer the token
  bar spans the bottom and wraps into touch-sized rows (min 40 px), the
  hint sits above it and wraps, the title card wraps at 22 px in
  portrait, the HUD shrinks; the hint copy says pinch / tap on touch
  devices. Pinch and one-finger orbit are OrbitControls' own touch
  handling (unchanged). `?gallery=1` hides the bar, HUD, hint and
  toasts and replays the tour every 4 minutes once the piece has been
  left alone for 30 s (a wall or a TV). Verified headless at 390×844:
  bar 86 px in two rows after the tour, title wrapped, no errors;
  gallery at 1600×900 with nothing but the piece. Real iOS Safari and
  Android Chrome remain the board's device pass.
- **Look fixes from the 1600×900 preview pass** (the 100 previews at
  full size showed what the 960×600 gate sheet hid):
  - _Bloom box._ Every strong-source scene (Event Horizon tokens, the
    cores in Collision · Polar) carried a hard-edged bright rectangle:
    additive sprites stack to HDR values in the hundreds and the bloom's
    mip chain then saturates its whole kernel footprint. New
    `preBloomClampPass` (`min(rgb, uCap)`, cap 2.0, `__setBloomCap`,
    `?bloomcap=` for the harness) sits between the lens and the bloom.
    Compared at 6 / 2 / 1.2 on tokens 40, 13, 31: 6 still boxed, 2 keeps
    the clusters intact and removes the box.
  - _Lens interior._ Inside the Einstein radius the lens equation maps
    the source off the frame; the clamped edge texels used to smear
    into the ring's interior. Off-frame samples now fade to black, and
    the magnification cap drops 5.5 → 3 (a dense disc white-outs at 5.5).
  - _Lattice family._ Half of the eight lattice tokens (#30 #52 #78 #88,
    the ones whose spin trait is "none") were near-black frames: the
    crystal was a fixed 14³ = 2744 bodies at every tier, and a perfect
    cube is force-balanced, so without the vorticity term it sat still
    through the whole pre-roll with the speed channel painting it black.
    `sceneLattice` now scales with the tier (~38³ at lush; same extent,
    same total mass), has 8 % jitter and a gentle radial infall
    (v = −0.02 r) so the collapse is under way from the first frame for
    every seed; the token camera sits at 1.25× (`TOKEN_CAM_DIST`) so no
    seed's pose lands inside the cloud. All eight verified at 1600×900.
  - The official previews render at `lush` (`--tier lush`): the tier a
    desktop viewer sees and the tier the gate ran at; standard vs lush
    differ only in field density thanks to the tier gain.
- **Metadata generator + bundle manifest** (launch board p6-meta,
  p5-hash). `tools/build-metadata.py` renders every id's preview from
  the built bundle (`dist/token/index.html?id=N&preview=1`, the same
  deterministic still the 100-token gate measured, 1600×900), reads
  the traits / seed / hash from the page's `[token]` console line (now
  logged with `seed <hex8> hash <hash>`), and writes one ERC-721 JSON
  per token (name `Giverny Phos #N — Family`, the TOKEN_COPY.md
  description with the family sentence, temperament, signature and
  seed; `image`, `animation_url`, attributes Family / Temperament /
  Signature / Variant / Palette / Channel / Exposure / Spin / Doppler
  plus a Number display trait), the previews, a summary CSV with the
  gate's black/blown flags, and — with `--archive` — the identity table
  `docs/active/token-metadata-v1.json`. `--base` / `--images` re-write
  the URLs after pinning without re-rendering (`--no-render`).
  `tools/build-token.mjs` now writes `dist/token.manifest.json` (SHA-256
  per file, one bundle hash over the sorted list, git commit, build
  time) and prints the bundle hash — the record to keep beside whatever
  gets minted. Note for the bundle: Chrome blocks ES-module imports
  from `file://`, so the folder build opens locally only with
  `--allow-file-access-from-files` (the generator passes it); a gateway
  serves it fine. A single-file build that inlines three.js would
  remove the caveat (board p5-local).
- **Determinism audit** (INTERACTIVE_NFT.md §5.6): two renders of the
  same token preview are bit-identical; no unseeded random draws on
  the scene-build path in token mode. `vendor/three/LICENSE` added.
- **Defaults from the 4090 measurements** (BH_TESTING.md §3, 2026-09-06:
  tree ≈ brute at 99k, ~3× at 262k, ~10× at 518k): with no stored
  choice, discrete GPUs (`sniffDiscreteGpu`) default to the WebGPU
  compute backend, and Barnes-Hut switches itself on at ≥200k bodies
  (`bhSim.auto`, `bhAutoApply` on activation and tier change). An
  explicit `?bh=` flag or settings pick still wins. Above 262k the
  CPU bridge and fill rate now set the ceiling (M9).
- **100-token gate, first pass** (`render-plan.py`: every planned id
  rendered on the GPU, stills measured, sheet + CSV): no blown frames;
  Orrery tokens were a lone dot (authored pose far out) → token camera
  moves in to 0.5× (`TOKEN_CAM_DIST`); Lattice / Coma / Orrery get an
  exposure lift (`TOKEN_EXPOSURE_MUL`) and Lattice a 900-step pre-roll.
- **Token identity: id-derived recipes + planned distribution +
  identity layer.** `?id=N` (1..`TOKEN_EDITION`=100) derives from
  `TOKEN_ID_SALT:id`; `TOKEN_PLAN` fixes exact family counts
  (`__tokenPlan()`, `TOKEN_PLAN_OVERRIDES`). Recipe gains Temperament
  (director flavour, rotation off) and Signature; Moments scheduler
  (long exposure / lens on the heaviest body / spin, seeded cadence,
  recipe restored after); the tour's tracked body becomes the token's
  star for Follow and Traits.
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
