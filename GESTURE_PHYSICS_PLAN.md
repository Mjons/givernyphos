# Gesture physics — design exploration

The current hand-tracking mechanics are:

- **Brush** — Gaussian-weighted push along cursor motion. Always-on
  while a hand is present. Wired in WGSL + GLSL ([HAND_TRACKING_PLAN.md](HAND_TRACKING_PLAN.md)).
- **Pull** — Gaussian-weighted spring toward the centroid, gated on
  pinch (fingertip spread → centroid).
- **Visual** — three fingertip dots (thumb 4, index 8, middle 12) plus
  a softer centroid glow. The dots converge as fingers close.

The pull-on-pinch metaphor doesn't read at the gesture level. With one
centroid the user can't _see_ a gather — they can only feel one. The
fingertip dots already suggest the right shape: three points of
influence. So: give the fingertips **their own gravity** instead of
collapsing them into a single centroid spring.

This doc covers the new mechanic, the math, and a small "Gestures"
settings panel to dial it in live.

---

## 1. What "their own gravity" means

Three honest interpretations, ordered by ambition:

### A. Three Gaussian-spring attractors (recommended, cheapest)

Each fingertip gets its own small Gaussian spring center. The shader
runs three Gaussian evaluations per particle and sums them. Math is
literally the existing `pull` term replicated three times with three
different `handPos` values and a smaller per-finger radius.

```
acc += Σ_i  G_i · w_i · (tip_i - particlePos)
```

Where `w_i = exp(-|tip_i - p|² / σ_i²)`. Always-on, presence-gated,
zero pinch dependence. The gather _gesture_ (fingers closing) becomes
emergent: as the three tip positions converge in world space, their
Gaussian envelopes overlap and the particles between them feel triple
pull → they pile up at the convergence point.

Cost: 3 vec3 subtracts, 3 dot products, 3 exps per particle per
frame. Negligible vs. the all-pairs gravity loop.

### B. Three Newtonian attractors (more dramatic)

Same structure, but `1/r²` falloff instead of Gaussian:

```
acc += Σ_i  G_i · (tip_i - p) / (|tip_i - p|² + ε)^(3/2)
```

Particles get sucked in much harder near the tips. Closes the
"stars to fingertip" gap quickly, can sling-shot anything not already
captured. Risk: scenes with fast-moving particles get yanked into
fingertip orbits hard enough to look broken. Newtonian is what gravity
_does_, and it does it forever — energy injection is unbounded.

Mitigation: add a soft cap (`min(force, F_max)`) and a cutoff radius
beyond which the term is zero. But at that point you're approximating
the Gaussian-spring anyway, just messier.

### C. Fingertips as actual GPGPU bodies (maximalist)

Reserve three slots in the position/velocity textures for fingertip
"masses." Each frame, write the fingertip world positions into those
slots with a fixed large mass; their velocity stays zero. The existing
all-pairs gravity loop then naturally pulls every other body toward
them.

Pro: no new shader code, fully consistent with the rest of the sim.
Con: requires the fingertip bodies to be _excluded_ from the velocity
update (else they'd fly off), and from the renderer's body-count
stats, follow-cam, click-to-follow, click-pickers, COM calculation,
and movie-mode subject finder. The phase-1 WebGPU work spent a lot of
care making those readers consistent ([PHASE1_STEP7_HANDOFF.md](PHASE1_STEP7_HANDOFF.md));
adding "ghost bodies" forces another pass over all of them.

Out of scope. **Recommended path is A.**

---

## 2. The math, concretely

Three identical terms, summed:

```
for i in {thumb, index, middle}:
  d_i = tip_i - p
  r2  = dot(d_i, d_i)
  w_i = exp(-r2 / σ²)
  acc += G_finger · w_i · d_i
```

Notes:

- **Per-finger radius `σ`** is _smaller_ than the current unified
  centroid radius (currently 150). Probably ~50–80 world units. The
  three small envelopes cover the centroid envelope when fingers are
  open, but get individually localized when fingers spread.
- **Per-finger gain `G_finger`** is _smaller_ than the current pull
  gain. Three additive contributions sum, so each one contributes ⅓
  to ½ of what the unified pull did at full pinch. Start at
  `G_finger = 0.0015`.
- **Always-on**: presence-gated only. No pinch threshold needed —
  geometry does the work. Remove `HAND_PULL_THRESHOLD` and the
  pinch-driven activation logic.
- **Spring shape (not Newtonian)**: `acc += w · d`, not `acc += w · d / r`.
  At the tip itself, `d → 0` so force → 0 — particles relax onto the
  tip rather than overshoot. (Newtonian would oscillate.)

The brush term stays unchanged. It's orthogonal: motion-driven push
in the direction of cursor velocity, applied at the centroid. Brush
covers "wave through," fingertip gravity covers "presence."

---

## 3. Replacing the existing `handPull` term

The current `handPull` uniform is one scalar. Per-fingertip gravity
needs three positions and one (shared) gain + radius. Cheapest layout
change to the SimParams struct:

```wgsl
// Replace handPull (1 f32) with:
tipAx: f32, tipAy: f32, tipAz: f32, tipFinGain: f32,
tipBx: f32, tipBy: f32, tipBz: f32, tipFinRadius: f32,
tipCx: f32, tipCy: f32, tipCz: f32, _padFin: f32,
```

That's 12 f32 (48 bytes) replacing the 4 currently allocated for
`handPull + 3 pads`. SimParams struct grows by 32 bytes (308 → 340).
**`PARAMS_BYTES` must be raised** from 320 to 384 to fit. Do this
together with the WGSL struct edit so they match.

The GLSL path adds three `vec3` uniforms and one shared `float` gain

- `float` radius. No buffer concerns — Three.js handles uniform
  allocation per material.

The shader term (WGSL):

```wgsl
if (alive && p.tipFinGain > 0.0) {
  let tA = vec3<f32>(p.tipAx, p.tipAy, p.tipAz);
  let tB = vec3<f32>(p.tipBx, p.tipBy, p.tipBz);
  let tC = vec3<f32>(p.tipCx, p.tipCy, p.tipCz);
  let s2 = max(p.tipFinRadius * p.tipFinRadius, 1e-3);
  let dA = tA - pA; let wA = exp(-dot(dA,dA) / s2);
  let dB = tB - pA; let wB = exp(-dot(dB,dB) / s2);
  let dC = tC - pA; let wC = exp(-dot(dC,dC) / s2);
  acc = acc + p.tipFinGain * (wA * dA + wB * dB + wC * dC);
}
```

JS-side `updateHandWorld` projects each of the three tips through the
same camera ray-to-plane logic already in use for the centroid:

```js
projectTip(camera, tipImageX, tipImageY) → THREE.Vector3
```

Three calls per frame. Trivial.

---

## 4. Settings — the "Gestures" panel

The hand mechanics today have several magic constants buried in code:

| Constant               | File:line                                 | Default     |
| ---------------------- | ----------------------------------------- | ----------- |
| `HAND_GAIN` (brush)    | [index.html:1776](index.html#L1776)       | 0.02        |
| `HAND_PULL_GAIN`       | [index.html:1778](index.html#L1778)       | 0.003       |
| `HAND_PULL_THRESHOLD`  | [index.html:1779](index.html#L1779)       | 0.3         |
| `handTracker.radius`   | [index.html:1585](index.html#L1585)       | 150         |
| `presence` rise / fall | [index.html:1751, 1778](index.html#L1751) | 0.04 / 0.06 |

These need a UI to tune live. The new panel will also expose the new
fingertip-gravity knobs.

### 4.1 Where it lives

The project's UI is rail-based, not tabbed: `RAIL_SECTIONS` at
[index.html:7754](index.html#L7754) declares each panel, and
`buildPanel(id)` rebuilds `#panel` content on switch. Adding a new
section is one entry in the array plus one builder function.

```js
{ id: "gestures", key: "G", label: "Gestures", icon: ICONS.gestures }
```

(Pick a Lucide-shaped icon — a small hand. Or reuse `ICONS.camera`
for now; design pass later.)

The rail entry should only appear when `handTracker.enabled` —
otherwise it confuses viewers without `?hands=1`. Filter
`RAIL_SECTIONS` based on the gate.

### 4.2 What knobs

Use the existing `Slider({...})` factory at [index.html:7621](index.html#L7621)
— same shape as the exposure slider example.

| Group         | Slider          | Range       | Default | Notes                |
| ------------- | --------------- | ----------- | ------- | -------------------- |
| **Presence**  | Rise rate       | 0.01 – 0.20 | 0.06    | Per-frame increment  |
|               | Fall rate       | 0.01 – 0.20 | 0.04    | Per-frame decrement  |
| **Brush**     | Gain            | 0 – 0.05    | 0.02    | `HAND_GAIN`          |
|               | Radius          | 30 – 400    | 150     | World units          |
| **Fingertip** | Gain            | 0 – 0.005   | 0.0015  | `G_finger`           |
| gravity       | Radius          | 20 – 200    | 60      | Per-tip σ            |
|               | (toggle) Active | on/off      | on      | Master enable        |
| **Smoothing** | Velocity lerp α | 0 – 1       | 0.5     | `worldVel.lerp(...)` |
|               | One-euro β      | 0 – 0.05    | 0.01    | Per-axis position    |

A "Reset to defaults" button at the bottom. Eight sliders + one toggle

- one button — fits in a single panel without scrolling.

### 4.3 Persistence

Hand-tracking is opt-in via `?hands=1`. A user who's actively dialing
gesture knobs should not lose them on refresh. Persist under one
localStorage key:

```
universeSim.gestures = {
  brushGain, brushRadius,
  tipGain, tipRadius, tipsActive,
  presenceRise, presenceFall,
  velLerp, oneEuroBeta,
}
```

Loaded once at boot, after `handTracker.enabled` flips on, _before_
`initHandTracker()` runs (so initial values are applied immediately).
Saved on every slider change (debounced 200ms — same pattern as the
music volume slider does already).

This is the _one_ hand-tracking thing that should persist. The opt-in
flag stays per-URL — we don't want to silently auto-enable the camera
based on a returning visitor.

### 4.4 Visual feedback in the panel

Each fingertip-gravity knob change should be felt immediately. The
sliders' `set()` callback writes to a single `gestureSettings` object;
each frame, `updateHandWorld` reads from it. No pipeline flushes
required — just JS-side reads of plain numbers.

A small "presence" bar at the top of the panel (just a `<div>` with
width = `presence * 100%`) visualizes whether tracking is engaged.
Helps users diagnose lighting issues without opening devtools.

---

## 5. Phased commits

Each phase ends in a working state. Reverting any one leaves the
project working.

### Phase 1 — Per-fingertip gravity, hardcoded constants

- Project all three tips to world space (extend `updateHandWorld`).
- Replace `handPull` uniform with three tip vec3s + shared gain +
  radius.
- Replace shader `handPull` term with three Gaussian-spring sum.
- Hardcoded defaults from §4.2; no UI yet.
- **Success:** with hand open and still, particles drift toward
  fingertips and form three soft halos. With fingers closed, the
  halos overlap and gather into one mound. With hand sweeping, brush
  pushes perpendicular to motion as before.

### Phase 2 — Add Gestures rail entry with sliders

- Extract magic constants into a `gestureSettings` plain object.
- Add `buildGesturesPanel()` mirroring `buildSettingsPanel()`'s style.
- Wire each slider via the existing `Slider({...})` factory.
- Add `RAIL_SECTIONS` entry, gated on `handTracker.enabled`.
- No persistence yet; reload still resets.
- **Success:** open the panel, drag sliders, immediately see/feel
  the effect. Reset button restores defaults.

### Phase 3 — Persistence

- Add load/save against `universeSim.gestures` localStorage key.
- Debounce save 200ms.
- **Success:** dial in a feel, reload the page, knobs come back.

### Phase 4 — Polish (optional)

- Presence indicator bar in the panel.
- Better icon for the rail.
- "Calibrate" button: shows a 3-second overlay of your raw hand
  landmarks so you can verify tracking is working before adjusting.

---

## 6. Open questions

- **Should the brush also be presence-gated by tip visibility?**
  Currently `presence` rises whenever _any_ hand is detected. With
  fingertip gravity, occasional missing-tip frames could cause a tip
  position to snap. A safer signal: gate `tipFinGain` on whether all
  three target landmarks have confidence above some threshold. But
  MediaPipe's output doesn't expose per-landmark confidence directly —
  worth a lookup before designing around it.

- **Per-finger asymmetry?** Thumb, index, middle could have
  different gains — index slightly stronger to feel like the
  "primary." Probably overkill for v1; equal weights are clean.

- **How does this interact with `pilgrim` / scenes with intentional
  motion?** A scene that's mid-act with strong narrative trajectories
  might not want any external pull. A per-scene `acceptsHandInput`
  flag (mentioned in the original [HAND_TRACKING_PLAN.md §7](HAND_TRACKING_PLAN.md))
  could degrade fingertip gain to 0 for those scenes. Defer until
  phase 1 reveals which scenes feel wrong.

- **Two hands?** The current code caps at `numHands: 1`. Two hands
  → six tips → much richer gather/spread. Doubles shader cost (still
  trivial). Probably the next obvious step after this.

- **Recording state for movies / shares?** If a movie is recorded
  while hand input is active, the share-link replay can't reproduce
  the gestures. Either: (a) hand input is disabled during movie
  capture, (b) gestures are recorded as a track and replayed.
  Defer — most users will record without hand input anyway.

---

## 7. What this is _not_

- Not a star-merger feature. "Pinching brings stars together to form
  a bigger star" is a separate mechanic — that's collision + mass
  accretion, not just gravity. It needs its own design doc and is
  best built on top of fingertip gravity once we can confirm the
  gather feels right.
- Not a global physics replacement. The all-pairs gravity loop, spin,
  flocking, radiation pressure all stay. Fingertip gravity is one
  more additive term, like spin.
- Not a control scheme. The "Gestures" panel doesn't add gesture →
  action mappings (no fist-to-pause, no swipe-to-next-scene). Those
  are the gesture-vocabulary feature deferred from
  [HAND_TRACKING_PLAN.md §1C](HAND_TRACKING_PLAN.md).

---

## 8. Recommendation

Phase 1 is a small, contained shader edit (~30 lines WGSL + ~15
GLSL + ~25 JS) that replaces an existing term. Land it as one commit,
play with the hardcoded constants for a session, _then_ design the
panel — phase 2 should be informed by which knobs you actually find
yourself wanting to tune. Don't build sliders for parameters you
end up never touching.

The smallest interesting version: **three tips, equal Gaussian
springs, presence-gated, no pinch logic, no UI yet.** That's probably
enough to feel whether this design holds water before investing in
the panel.
