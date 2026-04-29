# Stargazer intro — implementation plan

A ~12-second cinematic cold open. A small, round, cute character is
already on a hill with a telescope. One click — they pad over, lean
in, and the eyepiece becomes the universe sim.

Short, cute, cinematic. **No game, no walking-around, no UI.** Like
the first 10 seconds of a Pixar short. The point is to give the
cosmos an author: a small figure on the other end of the eyepiece.

---

## 1. The shot (12 seconds total)

Single continuous camera move, no cuts. Character is on screen the
whole time until the very end.

```
ESTABLISH (3s) → APPROACH (3s) → LEAN-IN (2.5s) → THROUGH (2.5s) → SIM (∞)
                  ↑
                  user clicks anywhere here, or auto-plays after 4s
```

### ESTABLISH (3s)

Wide shot. Hillside in silhouette, starfield overhead (the existing
starfield from [index.html:3596](index.html#L3596) — same shader,
same twinkle). Character stands beside the telescope, lit by a warm
lantern at the tripod base. Slow camera drift: a 1° push and a 0.5°
tilt-down. **No instructions on screen.** A tiny pulsing glow on
the eyepiece reads as "click here," but if the user does nothing,
APPROACH auto-fires after 4s.

### APPROACH (3s)

Character pads three steps to the eyepiece. Camera arcs from wide
to over-the-shoulder. Lantern bobs. Footstep thuds.

### LEAN-IN (2.5s)

Character bows toward the eyepiece, one little hand resting on the
telescope barrel. Camera pushes past the character's shoulder and
reframes on the eyepiece sphere. FOV narrows 50 → 30. The eyepiece
is now showing **live sim footage** (see §3) as a small porthole.

### THROUGH (2.5s)

Camera enters the eyepiece. FOV 30 → 18. Sphere grows to fill the
frame. At the end of the beat, a 0.5s crossfade swaps the porthole
texture for the sim composer rendering directly to canvas. The
intro scene is released.

### SIM

The existing app, exactly as today. The cinematic director takes
over.

---

## 2. The character

Cute, not cool. ~6 primitives, all spheres and rounded capsules.
Chibi proportions: big round head, tiny round body, stub limbs.

- **Round head, no face.** A subtle pair of dot eyes is OK if the
  silhouette feels too blank. No mouth, ever.
- **Knit cap with a pom-pom.** The pom-pom bobs on every step.
  Most of the cuteness lives in this one detail.
- **A tiny scarf** that drifts in the (non-existent) wind via a
  2-bone procedural sim.
- **Stubby limbs.** Arms swing 30° on the walk. Legs do a waddle,
  not a stride.
- **Idle breathing** — vertical scale 1.00 ↔ 1.03 over 3s sine.
- **Telescope-glance** — during ESTABLISH, the head tilts up at
  the sky once, then back. Implies they were already watching.
- **Hand-on-barrel** — during LEAN-IN, one arm raises and rests on
  the telescope. Familiar gesture. The single most "soft" beat.

No dialogue. No name. The cuteness is entirely shape + pom-pom +
scarf + posture.

---

## 3. The eyepiece-as-portal trick

This is the load-bearing visual idea. The sim composer renders into
a `WebGLRenderTarget` instead of the canvas; that target is the
texture on the eyepiece sphere material. So as the camera dollies
in during LEAN-IN and THROUGH, you literally see the cosmos through
the lens before you fall into it.

Same render-target pattern already used by [planetScene at
index.html:10788](index.html#L10788). Reuse the existing camera and
renderer; only the active scene + composer-target change.

If perf is tight, render the porthole at half res during
LEAN-IN — the sphere is small enough on screen that nobody
notices.

---

## 4. Audio

Three layers, all gentle, all WebAudio-synthesized (no samples):

- **Wind bed** — quiet pink noise from frame 1.
- **Footstep thuds** — three soft envelope-shaped noise bursts on
  APPROACH.
- **Pom-pom chime** — single soft pluck on the LEAN-IN bow. The
  cute beat needs an audio bow-tie.

At THROUGH end, the sim's first track fades in. The first user
click also satisfies the browser's audio-gesture requirement, so
the sim audio plays without a silent first frame.

---

## 5. Skip + persistence

- **First visit:** intro plays automatically.
- **Click anywhere during ESTABLISH:** skips ahead to APPROACH.
- **`Esc` or click "skip →" (top-right, low-emphasis):** jumps to
  the THROUGH crossfade — the metaphor is preserved even for
  skippers.
- **After one full play or skip:** persist `phos.introSeen = true`
  to localStorage. Subsequent visits go straight to the sim.
- **`?intro=1`** force-replays. **`?intro=0`** force-skips.

Returning users never pay the 12s tax. New users get the gift once.

---

## 6. Implementation order

Five steps. Each one verifiable on its own.

### Step 1 — gating + render swap (~80 LoC)

URL param parsing, `phos.introSeen` localStorage, "skip →" button.
New `introScene = new THREE.Scene()` (sibling of [planetScene at
index.html:10788](index.html#L10788)). When intro is active, the
sim composer renders into a `WebGLRenderTarget`; the canvas runs a
`RenderPass(introScene, camera)`. When intro completes, swap back.

### Step 2 — set + character (~180 LoC)

Hillside plane (subdivided + low-freq noise), ground fog, lantern
point light, moonlight directional. Character built from spheres +
capsules per §2. Idle breathing + telescope-glance scripted on
timers. Telescope geometry (tripod + barrel + eyepiece sphere).

### Step 3 — the cinematic move (~140 LoC)

The four beats from §1, all driven by a single `t` timer. Camera
position / FOV / target are scripted curves, not interactive. Walk
animation (waddle + arm swing + pom-pom bob) tied to the APPROACH
timeline — character moves itself, no controls.

### Step 4 — eyepiece portal + handoff (~120 LoC)

Wire the sim composer's render target onto the eyepiece sphere.
Boot the sim director early so the porthole has live footage during
LEAN-IN. THROUGH-end crossfade and intro-scene release.

### Step 5 — audio + skip wiring + polish (~100 LoC)

Wind, footsteps, the LEAN-IN chime. Click-to-skip from ESTABLISH.
`Esc` and "skip →" both jump to THROUGH. `phos.introSeen` write on
completion. Honor `prefers-reduced-motion` (cuts straight to
THROUGH, no camera move).

**Total: ~620 LoC, ~3 days.**

---

## 7. Success criteria

1. First visit plays the intro by default; subsequent visits don't.
2. The whole thing reads as one continuous ~12s shot, not five
   glued-together beats.
3. The eyepiece-to-sim handoff is invisible — no flash, no pop.
4. The character reads as **cute** to a stranger shown the
   recording cold (the pom-pom carries a lot of this).
5. Skipping at any point lands cleanly in the sim with no broken
   post-FX.
6. 60fps on the README-baseline.

---

## 8. Open questions

- **Auto-play vs. require-click.** Currently auto-plays after 4s of
  ESTABLISH. Pure auto-play (0s) would be more cinematic; require-
  click would solve the audio-gesture cleaner. The 4s grace is the
  compromise — try both during step 5.
- **Dot eyes or no.** Faceless silhouette is more "tasteful";
  two-pixel dot eyes are more "cute." Build both, A/B during step 2.
- **A second character?** A tiny glowing firefly companion that
  orbits the head would be very cute — and cheap (one billboard
  sprite). Tempting but optional. Defer to v1.1 unless step 2 has
  budget.
- **The pom-pom chime.** A literal cute audio bow-tie risks being
  twee. If it lands wrong in step 5, drop it — the visual carries
  on its own.

---

## 9. What I want signed off before step 1

- The 12s budget (vs. shorter — 8s? — or longer).
- Auto-play after 4s vs. require-click vs. immediate auto-play.
- Cute-chibi character (this plan) vs. the earlier "soft silhouette"
  direction. Locking in **cute** but worth one explicit check.

If those land I can start step 1 (~80 LoC, fully reversible).
