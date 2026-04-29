# Event Horizon Transit — design exploration

A scratchpad for an idea: make the `event-horizon` scene something you
can _go through_, not just look at. Plunge across the horizon, fall
through the throat, emerge from a white hole on the other side.

This doc is exploratory. Three plausible interpretations, what each
costs, and where I'd start. Not decided.

---

## 1. What we have today

The pieces are already on the floor — the transit is mostly assembly.

- **`sceneEventHorizon`** at [index.html:4079](index.html#L4079) — a
  140k-mass BH with a thin Keplerian disk, bipolar jets, and a
  screen-space gravitational lens (Einstein + shadow radii) that paints
  the photon ring straight from the lens equation
  ([index.html:5202](index.html#L5202)).
- **A real lens shader** — already drives the look in
  [index.html:2627](index.html#L2627) onward. `lens.strength`,
  `lens.einstein`, `lens.shadow` are all uniforms we can animate.
- **Time-reverse** — `uSign = ±1` already plumbed through the gravity
  shader ([PHASE1_WEBGPU.md §1.2](PHASE1_WEBGPU.md)). The "white hole"
  side gets time-reversal for free.
- **Director with shot grammar** — `SHOT_GRAMMAR` already has a
  `collision→event-horizon` (pushin) and `event-horizon→stephans-quintet`
  (pushin) entry at [index.html:9803](index.html#L9803). A new
  `horizon-transit` flavour drops in next to `dissolve / pullback /
pushin / flare`.
- **Follow-cam** — engine supports orbiting a single body
  ([CINEMATIC_MODES.md §8](CINEMATIC_MODES.md)). The "thing we follow
  into the BH" is a body we already have.

So the transit is not new physics — it's a director-orchestrated
sequence over already-existing knobs.

---

## 2. Three interpretations (pick one — they are not the same idea)

### A. Camera-only transit (fakery, all visual)

The camera dives toward the BH. The lens warps. At the moment the
camera reaches the shadow radius, we hard-cut through one frame of
solid color (the singularity), and emerge inside a different scene with
a "blooming outward" composition. Nothing in the simulation actually
changes — it's a stylized cinematic edit dressed up as a wormhole.

**Pros:** ~150 LoC. Zero risk to the sim. Works at any density tier.
**Cons:** the bodies on the disk don't participate. The viewer can tell.

### B. Bodies fall in, bodies come out (a real-feeling transit)

Bodies that cross r < r_shadow are removed from the active set, queued
into a "throat buffer." On the white-hole side, the same buffer drains
out — bodies are re-emitted at r_shadow with outward radial velocities,
preserving total mass and angular momentum (with an inversion).

The simulation now has _continuity through the throat_ — a body you
were following before crossing is the body you follow after, just
with reversed parity. Conservation gives the eye something to track.

**Pros:** the transit is real, not just visual. Bodies _are_ the same
bodies. Maps onto the existing kinds (kind 0 disk → kind 0 fountain).
**Cons:** ~600 LoC. Needs a dedicated "white-hole" scene (companion
to `sceneEventHorizon`). Mass conservation across an async transition
is fiddly.

### C. The universe inverts (one scene, time flips, palette inverts)

There is no "other side." The same scene runs, but at the moment of
horizon crossing, `uSign` flips to -1, the palette inverts, and the
disk runs backward — matter spiraling _outward_ instead of inward,
jets becoming infall funnels. We're inside the same black hole but
with the arrow of time reversed. After ~30 seconds the universe
"settles" into the matching white-hole scene.

**Pros:** philosophically correct (a Schwarzschild white hole _is_ a
time-reversed BH). Cheapest — `uSign = -1` is one line. The scene
already supports time-reverse without breaking.
**Cons:** weird to describe to a viewer. Hard to keep feeling
intentional rather than glitchy.

My instinct is **A** for v1 (cheap, ships) with the door open to **B**
(if anyone falls in love with v1 and wants more). **C** is a beautiful
idea but it's a different art piece.

---

## 3. The composite sequence (interpretation A, fully specified)

Roughly 18 seconds, broken into five beats. Each beat is a director
state, drives a small set of uniforms, hands off to the next.

```
APPROACH (5s)   →  PLUNGE (4s)  →  THROAT (1.5s)  →  EMERGENCE (3.5s)  →  SETTLE (4s)
```

### 3.1 APPROACH

Camera does a slow pushin from `sceneEventHorizon`'s default pose
toward the BH at `(0, 0, 0)`. FOV crashes from 34 → 18 over 5s
(reverse-zoom feel). Bloom and CA hold steady. The disk is hero — the
viewer is being _drawn in_, not pushed.

Drives:

- `camera.fov`: `lerp(34, 18, t)`
- `camera.position`: `lerp(start, near-shadow, easeInQuad(t))`
- `lens.strength`: `1.0 → 1.4`

### 3.2 PLUNGE

Camera crosses r = 3 × r*shadow. FOV drops to 8°. The lens explodes:
`lens.strength` goes from 1.4 → 8.0 with `lens.einstein` doubling.
Light from behind the BH wraps around to the front (the photon-ring
expands until it fills the frame). CA spikes to 0.85. Trail freezes
to 0.985 — the disk paints comet-like radial streaks. \_Music DSP
note: low-pass cutoff ramps from 22kHz → 800Hz, like falling into
water.*

Drives:

- `lens.strength`: `1.4 → 8.0` (cubic in)
- `lens.einstein`: `0.085 → 0.17`
- `post.ca`: `0.32 → 0.85`
- `camera.fov`: `18 → 8`
- `audio.lpf`: `22000 → 800`

### 3.3 THROAT

The hardest beat to get right. For ~1.5s the screen is dominated by
the BH shadow. Three options:

1. **Pure black flicker** — fade to black, hold, fade up. Boring but
   honest. The audience accepts a beat of dark.
2. **Singularity render** — the screen is filled with one fragmented
   pattern (think of the Mandelbrot edge or interference pattern at
   infinite frequency). Doesn't "show" the inside, but suggests
   it's incomprehensible.
3. **Negative space** — invert the framebuffer for one beat. White
   background, black stars, palette flipped. Lasts a single frame and
   the audience reads it as "we crossed."

I'd ship #3 first. It's the cheapest "you crossed something" cue.

### 3.4 EMERGENCE

We're now in a destination scene (`stephans-quintet`, `birth`,
`coma`, etc.) but the director picks the _initial framing_: camera is
at the centre, FOV is still 8°, lens is still inverted (`einstein` is
negative — repulsive lens). Bodies appear to fountain outward from
where the camera is sitting. Over 3.5s:

- `lens.strength` collapses from 8.0 → 0.0
- `lens.einstein` ramps from `-0.17 → 0`
- FOV blooms from 8° → destination's natural FOV
- Trail relaxes from 0.985 → destination's natural trail
- Audio LPF reopens 800Hz → 22kHz

The "fountaining outward" is achieved by picking destination scenes
whose composition radiates from the centre — `birth`, `stephans-quintet`,
`bullet-cluster` all qualify.

### 3.5 SETTLE

Standard director DWELL on the destination. The transit is over; the
director resumes its normal life. Crucially: the `event-horizon →
horizon-transit → X` triple is recorded in `recentScenes` so the next
pick is constrained correctly.

---

## 4. Where this lives in the director (interpretation A)

### 4.1 New transition flavour

In `pickTransitionFlavour` ([index.html:9817](index.html#L9817)) we
add a fifth flavour: `horizon-transit`. It's not weighted in any
flavour's `transitionBias` — it's selected only by `SHOT_GRAMMAR` for
specific from→to pairs.

### 4.2 New `SHOT_GRAMMAR` entries

```js
const SHOT_GRAMMAR = {
  // existing entries...
  "event-horizon→stephans-quintet": {
    flavour: "horizon-transit",
    durationMul: 1.8,
  },
  "event-horizon→birth": { flavour: "horizon-transit", durationMul: 1.6 },
  "event-horizon→bullet-cluster": {
    flavour: "horizon-transit",
    durationMul: 1.7,
  },
};
```

Three entries is enough — the director picks the destination scene
already, and any of those three is a believable "white side."

### 4.3 The transition itself

A new `cineRunHorizonTransit(from, to, opts)` function alongside the
existing `cineRunDissolve / cineRunPullback / cineRunPushin /
cineRunFlare`. It's longer than the others (~120 LoC vs ~30) because
it's a five-beat scripted sequence with its own RAF loop, but it
plugs into the same `transitionRaf` slot the others use.

The transition watchdog ([CINEMATIC_MODES.md §2](CINEMATIC_MODES.md))
applies — if `cineRunHorizonTransit` ever silently dies, the watchdog
forces a `restoreBaseline` and returns to the source scene.

### 4.4 Anti-repeat

Add `event-horizon` to a new `recentTransitionEvents` rolling window
(depth 4). The transit is high-impact — seeing it twice in 30 minutes
cheapens it. Also: do not pick the transit if the user has been idle
for less than 90s (let them watch something normal first).

---

## 5. The "real white hole" scene (interpretation B's prerequisite)

If we ever go past interpretation A, we need a companion scene. Sketch:

`sceneWhiteHole()` — same body count as `sceneEventHorizon`, same
disk geometry, but:

- **Singularity body** has _negative_ effective mass for the radiation
  pressure term but _positive_ for gravity. Net effect: it pulls
  weakly, but the radiation channel sprays bodies outward.
- **Disk velocities** are reversed-Keplerian — bodies start with
  outward radial component scaled to escape velocity at their radius.
- **Jets** are inverted: bodies start at the cone tip with velocity
  pointing _toward_ the centre (an infalling beam).
- **Palette** is `bone` inverted — black background flips to a
  near-white background with dark stars.

Visually: same composition, opposite flow. Recognisably the "negative"
of `event-horizon`.

The throat-buffer would then teleport bodies between the two scenes
during the THROAT beat. That's the part that's a real engineering
project, not a weekend.

---

## 6. Audio

Whichever interpretation we pick, the music has to participate or the
transit reads as a glitch. The cheap version uses `BiquadFilterNode`
on the existing `<audio>` element:

```js
// In APPROACH: filter is fully open.
// In PLUNGE: lpf cutoff ramps 22000 → 800 over 4s, exponential.
// In THROAT: hold at 800, optional one-frame reverse buffer flip.
// In EMERGENCE: ramp back to 22000 over 3.5s.
```

Plus a single short "tunnel" reverb impulse on the THROAT beat —
~600ms wet tail, decays into EMERGENCE. We do not need to time this
to a downbeat for v1, but [§7 of CINEMATIC_MODES.md](CINEMATIC_MODES.md)
describes the metadata system that would let us land THROAT on a
musical sectional boundary, which would be _the_ moment.

---

## 7. Risks

### 7.1 The transit is so visually loud it overshadows everything else

If we ship and the audience sees this once and then waits 25 minutes
to see it again, the rest of the stream feels flat. Mitigation: gate
hard. `recentTransitionEvents` depth 4, plus a per-flavour rate cap
(max one transit per 45 minutes). The transit should be a _rare_ shot,
like a music drop.

### 7.2 The lens shader at strength=8 will light up the whole screen

`lens.strength` was tuned for sub-2.0 values. Pushing to 8 may produce
banding, NaN cascades on the CA channel, or just look like a blur
filter. Need to actually test in the shader before committing to the
sequence's amplitude curve. **Cheap experiment first**: open the live
build, force `lens.strength = 8` in the console, see if it looks
gravitational or like a Photoshop filter. If the latter, the lens
shader needs an exponent extension (~30 LoC to the GLSL).

### 7.3 Sudden FOV crashes nauseate viewers

Going 34° → 8° in 9 seconds is aggressive. Some viewers will feel it
in their stomach. Mitigation: ease it (`easeInOutCubic` rather than
linear), and document that "Event Horizon Transit" can be disabled
by a URL param `?notransit` for users who get motion-sick. (Director
falls back to `pushin` for those `event-horizon → X` pairs.)

### 7.4 The CPU-readback cost during PLUNGE

If we're on the WebGPU path ([PHASE1_WEBGPU.md](PHASE1_WEBGPU.md))
during the transit, the per-frame readback cost (~480 MB/s) is
unchanged. Fine. _But_ if the transit triggers a density-tier change
(e.g. force lush during the visually-heavy beats so post-FX has
headroom), the rebuild could collide with the transit's RAF. Mitigate:
forbid density changes while `state === "TRANSITION"` and
`transitionFlavour === "horizon-transit"`. The director already
queues density changes — extending this is one line.

### 7.5 The white-hole scene (interpretation B) might violate

mass conservation across the throat

If bodies fall in faster than they emerge, mass piles up; the inverse
empties the destination. The throat buffer needs a credit-debit
discipline. Easy to get this wrong. For interpretation A this is a
non-issue.

---

## 8. Open questions

- **One-way or round-trip?** Does the transit ever go _back_? My
  instinct: no. White-hole-to-black-hole is a different conceptual
  arc and would need its own grammar.
- **User-triggerable?** Should there be a hotkey (`h`?) that forces
  the transit if the current scene is `event-horizon`? Or is this
  strictly a director-only event?
- **Does the camera follow a body through?** Interpretation B opens
  this — the bright disk body the follow-cam was tracking _is the
  same body_ on the other side, with parity flipped. That's the
  emotional payoff of B over A.
- **Is the destination scene fixed or random?** SHOT_GRAMMAR
  currently lists three (`stephans-quintet`, `birth`,
  `bullet-cluster`). Random among the three? Or do we author one
  bespoke `event-horizon → birth` sequence and pin it?
- **Rate cap unit:** per-stream-session or per-wall-clock-day?
  24/7 stream means "session" is forever — wall-clock is the right
  bucket.

---

## 9. Shortlist (where I'd start)

If the goal is _"ship a transit experience by next weekend"_:

1. **Test `lens.strength = 8` in the live build.** 30 seconds.
   Resolves §7.2 before any code. If it doesn't look gravitational,
   the whole plan needs the lens-shader extension first.
2. **Write `cineRunHorizonTransit` as interpretation A.** ~150 LoC.
   The five-beat sequence, scripted, no body teleportation. Three
   `SHOT_GRAMMAR` entries. New flavour token in
   `pickTransitionFlavour`.
3. **Add the audio LPF ramp.** ~25 LoC (`BiquadFilterNode` + a
   per-beat target curve).
4. **Anti-repeat & rate cap.** ~15 LoC. `recentTransitionEvents`
   rolling window, 45-minute cooldown.
5. **Rehearse the transit at 10× speed via `?rehearse=transit`.**
   Reuses [§14 of CINEMATIC_MODES.md](CINEMATIC_MODES.md). Without
   this, tuning the five amplitude curves is a 25-minute round-trip
   per attempt.

**Total: ~220 LoC, ~1.5 days.** Ship A; let it bake on the stream
for two weeks; if the moment lands, design B. If it doesn't, the
removal is one `delete` from `SHOT_GRAMMAR`.

---

## 10. What I'd want to confirm before writing code

- That the lens shader's `strength` actually scales gracefully past
  ~2 (§7.2 — settle this in the browser, not in the doc).
- A is the right starting point and B is a follow-up, not a parallel
  effort.
- We want this in the cinematic director, not as a separate "ride"
  mode. (A separate mode is a different product.)
- The destination set (`stephans-quintet / birth / bullet-cluster`)
  is sensible, or there's a fourth scene I should add to it.

If those land I can sketch `cineRunHorizonTransit` against the
existing `cineRunPushin` pattern.
