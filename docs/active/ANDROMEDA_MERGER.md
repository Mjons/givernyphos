---
status: exploration
last-updated: 2026-04-28
---

# Andromeda–Milky Way merger — design exploration

A scratchpad for promoting the existing "Milky Way × Andromeda" scenario from a sub-config of [`scene-collision`](#) into a first-class scene that names the real predicted event. Re-tunes orbital geometry to the actual numbers from observation, adds Triangulum (M33) as a satellite for completeness, gives the scene a dignified caption and a longer dwell. Zero new primitives. Half a day of code, half a day of tuning.

This is the smallest, lowest-risk entry on the [EVENT_SCENES.md](EVENT_SCENES.md) shortlist — a litmus test for whether the "real-event scene" posture is worth pursuing further.

---

## 1. The pitch in one paragraph

In ~4.5 billion years, the Milky Way and Andromeda will fall together. Andromeda is currently approaching at ~110 km/s radial velocity along a near-radial trajectory; the impact parameter is small enough that this is a near-head-on merger, not a graze. The result is "Milkomeda" — a single elliptical galaxy. The engine already has a generic Collision scene with this as a sub-scenario; promoting it to its own scene with real geometry, the satellite Triangulum included, and a "4.5 billion years from now" caption transforms a stateless astrophysical archetype into a specific, named, predicted event. The viewer can read the caption, watch the merger, and know they are looking at the literal future of their sky.

The hook: this is the only real event the universe has _promised_ us at the galactic scale. It is also one of the few that fits this engine perfectly without bending it.

---

## 2. What we have today

In [index.html:6860](index.html) (`COLLISION_SCENARIOS["Milky Way × Andromeda"]`):

```js
"Milky Way × Andromeda": {
  massRatio: 1.0,
  initialSep: 700,
  approachVel: 4.5,
  impactParam: 35,
  inclinationA: 30,
  azimuthA: 0,
  spinA: +1,
  inclinationB: 45,
  azimuthB: 60,
  spinB: -1,
  diskRadiusA: 130,
  diskRadiusB: 140,
}
```

This already runs. It produces a recognizable two-galaxy merger via [`sceneCollision`](index.html#L6993). But it is parked inside a generic scene-with-scenarios mechanism that nobody on the surface sees — the user has to dig into the Collision scene's settings panel to find it. From the outside, it looks like one of seven "Collision flavours," not the predicted future of the local group.

The lift is to surface it as its own scene key with a dedicated caption, more accurate geometry, and a third body.

---

## 3. The geometry (the part that needs tuning)

The current scenario is a "looks-pretty merger." A real-event scene wants the actual numbers, scaled to engine units. The astrophysical observations:

| Quantity                             | Real value                       | Notes                                         |
| ------------------------------------ | -------------------------------- | --------------------------------------------- |
| Current separation                   | ~2.54 Mly (~778 kpc)             | Maps to `initialSep` in scene units           |
| Andromeda radial velocity (approach) | ~110 km/s                        | Maps to `approachVel`                         |
| Andromeda tangential velocity        | ~17 km/s (recent measurements)   | Tiny — the merger is nearly head-on           |
| Mass ratio (M31 : MW)                | ~1.25 : 1 to 1.5 : 1             | M31 is heavier; tune `massRatio`              |
| Predicted first close approach       | ~4.5 Gyr from now                | The caption                                   |
| Andromeda disk inclination from sky  | ~77° (nearly edge-on from Earth) | `inclinationB`                                |
| Milky Way disk orientation           | Defined by viewer pose           | `inclinationA` is then a director's choice    |
| M33 (Triangulum) mass                | ~0.05 of MW                      | Optional satellite; small disk along for ride |
| M33 separation from M31              | ~860 kly                         | ~one-third the M31–MW separation              |

### 3.1 Recommended starting values

```js
const ANDROMEDA = {
  // Mass — Andromeda heavier than the Milky Way
  massRatio: 1.3, // M31 is the heavier (B in scene code)
  galaxyMassA: 22000, // Milky Way
  // (galaxyMassB derived as A × massRatio at scene-init)

  // Geometry — near-head-on, small impact parameter
  initialSep: 700, // unchanged; cinematic dwell starts mid-approach
  approachVel: 3.0, // slower than the current 4.5 — real merger is gentle
  impactParam: 18, // tighter than the current 35; near-radial encounter

  // Orientations — Milky Way as a reference, Andromeda nearly edge-on
  inclinationA: 12, // MW barely tilted
  azimuthA: 0,
  spinA: +1,
  diskRadiusA: 130,

  inclinationB: 77, // Andromeda's actual sky inclination
  azimuthB: 22, // small offset for visual interest
  spinB: -1, // counter-rotating — produces clean tidal tails
  diskRadiusB: 165, // Andromeda is genuinely larger than MW
};
```

The two changes that _most_ matter for realism: **lower impact parameter** (the real encounter is much closer to head-on than the current scenario's 35) and **mass tilt toward Andromeda** (the current 1:1 makes the merger feel symmetric; the real one isn't).

The two changes that most matter for _visuals_: **counter-rotating disks** (spinA=+1, spinB=-1) produce more dramatic tidal tails than co-rotating, and **Andromeda's larger disk radius** sells the real-world size difference.

### 3.2 Triangulum (M33) — the satellite that comes along

M33 is the third-largest galaxy in the Local Group. It is gravitationally bound to Andromeda and will arrive with it. Including it costs ~5% of the body budget but is the single highest-impact realism touch:

```js
// After the two main galaxy builds:
const m33Budget = Math.floor(MAX_BODIES * 0.05);
const m33Pos = positionRelativeTo(M31, distance: 90, angle: ...); // satellite of M31
const m33Vel = orbitalVelocityAround(M31, m33Pos, m33Mass: 700);

buildGalaxy(
  state.count,
  m33Budget,
  m33Pos.x, m33Pos.y, m33Pos.z,
  m33Vel.x, m33Vel.y, m33Vel.z,
  diskRadius: 45,            // small spiral
  inclination: 55,
  azimuth: 130,
  spin: +1,
  mass: 700,                 // ~3% of M31's mass
  galaxyKind: 1,             // shares M31's tint
);
```

The satellite tags along, gets disturbed by the merger, and contributes its own stream of bodies that wraps around the merging pair. Visually it reads as a third whorl of detail in the periphery. Mechanically it's a third call to `buildGalaxy` with a lower budget. ~30 LoC.

This is the single change that distinguishes a "Milky Way × Andromeda" scenario from an _Andromeda merger_ scene.

---

## 4. Scene registration

A new entry in `SCENES` next to `collision`:

```js
andromeda: {
  name: "Andromeda Merger",
  caption: "4.5 billion years from now · Milky Way meets M31",
  make: sceneAndromeda,
  camera: { pos: [950, 480, 950], tgt: [0, 0, 0], fov: 52 },
  palette: "nebula",            // matches existing collision; consider "ice" for cooler tone
  channel: "speed",
  post: {
    bloom: 1.30,
    bloomRadius: 0.65,
    exposure: 1.12,
    ca: 0.20,
    vignette: 0.42,
    grain: 0.025,
  },
  // Inherits collision physics — large softening protects the multi-BH integrator
  physics: { G: 1.0, softening: 4.0, dt: 0.012, speed: 1.0 },
  K: "collision",
  flock: 0.05,
  radiation: 0.05,
  tint: TINT_GALAXY,
},
```

The caption is the entire narrative device. `4.5 billion years from now · Milky Way meets M31` does three jobs in one line: names the event, places it in time, says which galaxies. Anything more is over-writing.

`sceneAndromeda` is a thin wrapper around `sceneCollision` that locks in the v3.1 numbers and adds the M33 build:

```js
function sceneAndromeda() {
  // Override collision config with Andromeda numbers
  Object.assign(collision, ANDROMEDA);
  collision.galaxyMassB = collision.galaxyMassA * collision.massRatio;
  collision.scenario = "Andromeda";

  sceneCollision(); // builds MW + M31 with overridden geometry
  appendM33(); // adds the Triangulum satellite as a third buildGalaxy call
}
```

This keeps the existing Collision-scenario plumbing intact and inherits all its fixes (the large softening for multi-BH stability per [the comment at index.html:8131](index.html#L8131); the `K: "collision"` interaction matrix preset).

---

## 5. Director treatment

Real events deserve more weight than ambient scenes. Three settings, each independent:

### 5.1 Longer dwell

The standard collision dwell is in the 8–16 minute range (per [CINEMATIC_MODES.md](docs/reference/CINEMATIC_MODES.md)). Andromeda should sit at the high end — **15–25 minutes** for Drift flavour, **8–12 minutes** for Pulse. The scene wants the viewer to register the caption, watch the approach, see the first contact, register that this is _their_ future. Cutting away at 8 minutes feels disrespectful.

### 5.2 Slower transitions in and out

Use a `dissolve` transition both into and out of Andromeda, with a `transitionMs: 90000` (90 seconds). The longest transitions in the engine. The merger should feel _predicted_, not abrupt.

```js
"birth→andromeda":            { flavour: "dissolve",  transitionMs: 90000 },
"andromeda→quiet-drift":      { flavour: "dissolve",  transitionMs: 90000 },
"event-horizon→andromeda":    { flavour: "pullback",  transitionMs: 75000 },
```

The third one is a story: the viewer pulls back from a black hole's accretion and finds themselves looking at the deep-time fate of their own sky. That's worth its own SHOT_GRAMMAR entry.

### 5.3 Anti-repeat with `collision`

The new scene should _not_ play within an hour of the generic Collision scene — they look superficially similar and back-to-back exposure undermines the "this is the specific real one" framing. Add to the anti-repeat window:

```js
recentSceneCousins["andromeda"] = ["collision"];
recentSceneCousins["collision"] = ["andromeda"];
```

(One-line addition wherever the anti-repeat table lives — pattern not yet established but trivial.)

---

## 6. The caption — which words

Five candidates, each says a slightly different thing:

| Caption                                            | Tone                         |
| -------------------------------------------------- | ---------------------------- |
| `4.5 billion years from now · Milky Way meets M31` | Factual, time-stamped, named |
| `Milkomeda · the merger to come`                   | Mythic, science-popular      |
| `Andromeda inbound · 110 km/s`                     | Observational, present-tense |
| `The Milky Way and Andromeda, in 4.5 Gyr`          | Encyclopedic                 |
| `Local Group · the merger`                         | Detached, formal             |

The first one is the recommendation. It places the viewer in time ("4.5 billion years from now"), names both galaxies, and uses the engine's existing `·`-separated caption convention. It is also the only candidate that contains _all three_ facts a viewer needs: when, what, which.

---

## 7. Risks

### 7.1 Visual collision with the existing Collision scene

The two scenes use the same physics, the same render path, similar palettes. A viewer who watches both back-to-back will see them as variants of one thing, not as two distinct scenes. Mitigations: (a) the M33 satellite makes the silhouette unmistakably different; (b) anti-repeat (§5.3) prevents back-to-back exposure; (c) a slightly cooler palette (consider `ice` instead of `nebula`) further differentiates. Worth A/B-ing in rehearsal.

### 7.2 The "future event" framing requires sustained dwell

If the scene cuts away in 4 minutes, it reads as just another collision. The §5.1 long dwell is load-bearing. If the director is overridden by a Pulse flavour that aggressively cuts everything to 60 seconds, the framing breaks. Solution: tag the scene as `composition: "real-event"` and have Pulse mode either skip it or honour a minimum 4-minute dwell.

### 7.3 The body budget is split three ways

With M33 taking ~5%, MW and M31 split the remaining 95% (~47.5% each, with M31 nudged a bit higher to reflect mass ratio). The disks may feel _slightly_ sparser than the existing Collision scenario. Mitigation: the M33 body count is genuinely small — at default density tier (4096 bodies), 5% is ~205 bodies, which is enough for a recognizable spiral but small enough not to starve the main pair. At lush tier (~65k), it's ~3.3k bodies, plenty.

### 7.4 The mass ratio creates a "lopsided" merger

A 1.3:1 mass ratio means the Milky Way disk gets disturbed more than Andromeda's. This is _correct_ (the Milky Way is the lighter galaxy and will be the more disrupted one), but a viewer used to the symmetric Antennae-style merger may read it as broken. Mitigation: the caption resolves this — once you know which galaxy is which, the asymmetry is the truth.

### 7.5 Andromeda's actual orientation is hard to read at default camera pose

A 77° inclination is nearly edge-on. From the default `[950, 480, 950]` viewpoint the disk reads as a thin streak rather than a recognizable spiral. This is _also_ astronomically correct (Andromeda is nearly edge-on from Earth) but visually less rich. Mitigation: the camera move scheduler can pick a 3/4 view of the merger that catches both disks broadside as they tilt during the encounter — let the moves add the visual interest the geometry refuses to give for free.

### 7.6 Caption truncation on small windows

The recommended caption is 50 characters. Existing captions in `SCENES` are 15–25 characters (`"Tidal stream · chaos"`, `"Heat · expansion"`). Verify the caption renderer wraps or truncates gracefully on narrow viewports before shipping. Likely fine; worth a 30-second check.

---

## 8. Open questions

- **Should Triangulum be optional?** A toggle in scene settings — `?triangulum=1` or a panel toggle — that lets the user see the merger with or without M33. Default on. Adds a UI surface; probably not worth the complexity for v1.
- **Does the scene survive long dwells gracefully?** The §5.1 15–25 minute dwell is longer than most existing collision scenes. After the first close pass, the bodies are scattered and the scene visually flattens — the merger is over, the new elliptical is forming. This is _true to the physics_ but may read as "nothing happening" to the viewer. Test in rehearsal at full dwell. If flat, consider a director-driven camera move that pulls back at minute 12 to show the new combined system.
- **Companion scene: a "before" view?** A pre-merger scene showing the two galaxies far apart, slowly approaching, no contact. Could be a sister scene `"andromeda-approach"` that runs at a different scale — same geometry, much earlier in time, the two disks visible as separate objects. Adds a second scene; defer to v2 unless the core Andromeda scene proves popular.
- **Audio?** A long sustained chord that builds as the disks approach, peaks at first contact, dissolves over the formation of Milkomeda. Too directly cinematic for the engine's "indifferent universe" tone? Or exactly right because this is one of the few moments where indifference serves drama? Defer to whichever direction the [music in `ssi_tracks/`](ssi_tracks/) is going.
- **What about M32 and M110?** Andromeda has its own satellite system. Adding them is more bodies in the periphery — probably below the threshold of visual impact, and the body budget is already split three ways. Skip.
- **Does this open the door to a "Local Group Suite"?** Andromeda + Triangulum + Magellanic Clouds + a "deep time" outer scene. A 3-scene event suite per the cross-scene-events idea in [EVENT_SCENES.md §6](EVENT_SCENES.md). Worth thinking about _after_ the single Andromeda scene proves itself.

---

## 9. Shortlist (where I'd start)

If the goal is _"ship the Andromeda merger as its own scene this afternoon"_:

1. **Add `ANDROMEDA` config object** with the §3.1 numbers. Next to `COLLISION_SCENARIOS` in [index.html:6845](index.html#L6845). ~25 LoC.
2. **Write `sceneAndromeda()`** — the wrapper from §4 that overrides `collision`, calls `sceneCollision()`, then calls `appendM33()`. ~15 LoC.
3. **Write `appendM33()`** — a single `buildGalaxy()` call positioned as M31's satellite with the §3.2 parameters. ~30 LoC.
4. **Register `andromeda` in `SCENES`** — the §4 entry. Add to `SCENE_ORDER`. ~15 LoC.
5. **Add SHOT_GRAMMAR entries from §5.2** — three transitions, ~5 LoC.
6. **Add anti-repeat link from §5.3** — ~3 LoC.
7. **Tune the geometry** in `?rehearse=andromeda` mode for ~30 minutes until the merger reads as the predicted real one (close encounter, slight asymmetry, M33 visible in periphery). No code, just eyeballing.
8. **Verify the caption renders** in narrow viewports — 30 second check.

**Total: ~90 LoC + half a day of tuning.** Lowest-risk entry on the [EVENT_SCENES.md](EVENT_SCENES.md) shortlist; demonstrates the "real-event scene" posture without committing to any new primitives.

---

## 10. What this proves if it ships

The Andromeda scene is the cheapest way to find out whether **named real events** are something the engine should keep doing. If a half-day re-tune produces a scene that visibly resonates more than the generic Collision (more dwells without skip, longer attention, viewers asking what it is) — that is the signal to invest in the more expensive entries on the [EVENT_SCENES.md](EVENT_SCENES.md) shortlist (Voyager Grand Tour, Crab supernova). If it doesn't — if it reads as just another collision with a longer caption — that's also useful information, and we can step back from the event-scene posture before sinking time into new primitives.

Either way, half a day, no new code paths, reversible at any point. The right size for an experiment.
