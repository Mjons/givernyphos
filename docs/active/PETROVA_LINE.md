# Petrova Line — design exploration

A scratchpad for a new scene: a star and a planet, separated by a
curved beam of millions of bright particles streaming between them.
The Petrova line from _Project Hail Mary_ — astrophage swimming
across a solar system, IR-glowing, gravity-bent into a long arc.
And occasionally, threading through the migration, one of three
named ships from the book: the Hail Mary, the Blip-A, or a Beetle.

The thing that makes this exciting for our engine specifically: the
curved beam is **not authored**. It emerges from particle physics —
each astrophage is being pulled by the star, thrusting toward the
planet, and the net path is a curve. We don't paint the line; we
simulate the cause and the line appears.

This doc is exploratory. The physics, three composition variants,
the ship-sighting system that lives within the scene, and a
shortlist for v1. Ship rendering, trajectory, and archetype design
live in [PASSING_SHIPS.md](PASSING_SHIPS.md); this doc owns _when_
and _whether_ a ship appears. Not decided.

---

## 1. The pitch in one paragraph

A K-type star, dimmed and red. A small terrestrial planet at ~60
scene-units of orbital distance. Between them, a luminous curved arc
of ~50,000 particles — astrophage migrating from star to planet,
each one a tiny Petrova-frequency emitter. The arc bends because the
particles are thrusting outward against the star's gravity and
toward the planet's; the resulting trajectory is a slow curve, not a
straight line. At the planet, particles "arrive" (despawn with a soft
pulse), and respawn near the star to start the journey again. The
scene is one of the most distinctive single visuals in modern hard
SF, and it's almost free for an engine that already does N-body
gravity with per-particle kind flags.

If the rest of the project is "weather", this is a _migration_ —
with the occasional [explorer crossing it](PASSING_SHIPS.md) (§5).

---

## 2. What we have today that this can lean on

- **N-body gravity kernel** — the velocity shader already integrates
  forces per-body ([PARTICLE_SCALING.md](PARTICLE_SCALING.md)). Adding
  a per-body **thrust toward a target** is one extra term inside the
  velocity update — five lines of GLSL, one new uniform (the planet
  position).
- **Body kinds** — the existing `kind` flag (disk / jet / dust /
  ship) extends to a new `kind = ASTROPHAGE`. The kernel branches
  cheaply on it.
- **Trail buffer** — the existing accumulation pass paints fast-moving
  bright points as streaks. Astrophage moving at high speed along
  the corridor will read as continuous lines without any extra work.
- **Scene system** — `sceneEventHorizon`, `sceneBirth` etc. are
  self-contained init functions. `scenePetrovaLine` slots in next to
  them, no architectural changes.
- **Director / SHOT_GRAMMAR / breathing** — the new scene drops into
  the rotation, gets its own dwell range and pace bias, contributes
  to anti-repeat windows.
- **Ship sightings (this scene's signature embellishment)** — the
  Hail Mary, the Blip-A, and the Beetles cruise through this scene
  and only this scene. They're a core part of the petrova-line's
  identity, not a generic feature that happens to fire here. The
  spawn scheduler lives in §5 of this doc; the rendering /
  trajectory / archetype design lives in [PASSING_SHIPS.md](PASSING_SHIPS.md).

So the new surface is: a thrust term in the velocity kernel, a
respawn lifecycle, a star + planet + corridor seeding routine, the
director hookup, and a per-scene ship spawn scheduler. The hard
part is tuning, not architecture.

---

## 3. The physics (the heart of why this works)

### 3.1 Per-particle force

Each astrophage feels three forces, summed each frame:

```glsl
// inside the velocity kernel, when kind == ASTROPHAGE
vec3 toStar   = uStarPos    - pos;
vec3 toPlanet = uPlanetPos  - pos;

vec3 fGravStar   = normalize(toStar)   * G * uStarMass   / dot(toStar,   toStar);
vec3 fGravPlanet = normalize(toPlanet) * G * uPlanetMass / dot(toPlanet, toPlanet);
vec3 fThrust     = normalize(toPlanet) * uAstroThrust;   // self-propulsion

velocity += (fGravStar + fGravPlanet + fThrust) * dt;
```

Three uniforms (`uStarPos`, `uPlanetPos`, `uAstroThrust`), one
extra term. The kernel still pays no per-other-body cost for
astrophage — they don't gravitate each other (mutual is negligible
for bodies this small in the book's physics, and computationally
this keeps them in the cheap branch).

### 3.2 Why the beam curves

A particle starting near the star at rest:

- The star pulls it inward (would fall straight back without thrust).
- Thrust pushes it toward the planet (which is offset, not radial).
- The net force has a tangential component — the particle accelerates
  along a curve.
- As it travels, the gravity-vs-thrust ratio shifts (gravity weakens
  with `1/r²`, thrust is constant), so the curvature changes along
  the path.

The result is a smooth arc, exactly the Petrova-line shape from the
book's Sol-Venus scene. **We get this for free** from physically
correct integration. No splines, no pre-baked paths.

### 3.3 Tunable knobs

Three values control the visual entirely:

- **`uAstroThrust` (acceleration magnitude)** — higher thrust = faster
  arrival, _straighter_ arc (gravity matters less). Lower thrust =
  more curvature, slower migration.
- **Star/planet mass ratio** — heavier star = tighter curve near the
  star, more gentle arc far from it.
- **Spawn distribution** — where in the star's vicinity new
  astrophage appear sets the beam's _width_. Tight spawn near one
  star pole = thin coherent beam. Spherical spawn around the star =
  diffuse halo with one direction of net flow.

Tuning these three is most of the v1 work. Default starting point:
moderate thrust (gravity-equivalent at ~0.3 × star-planet distance),
tight polar-cap spawn, planet at 60 units.

### 3.4 Lifecycle (the respawn mechanic)

Existing scenes don't despawn bodies — they stay alive forever. The
Petrova line needs a respawn loop:

```glsl
// after force integration
float dArrive = length(pos - uPlanetPos);
if (dArrive < uPlanetRadius) {
  // particle "arrived" at planet — respawn near star with fresh seed
  pos = sampleSpawn(uStarPos, hash(gl_FragCoord.xy + uTime));
  vel = sampleSpawnVelocity(pos, uStarPos);
}
```

The respawn is the only fragment-shader-side state mutation we need.
With ~50,000 astrophage and a typical transit time of ~12 seconds,
the despawn-respawn flux is ~4,000 particles/second — invisible if
the spawn region is small enough that incoming particles fade in
gradually rather than popping.

A soft "arrival pulse" at the planet — a brief brightness spike on
the planet body whenever astrophage arrive — would sell the
mechanic. But it's optional. Without it the beam just looks like an
endless flow, which is also fine.

---

## 4. Composition variants (three "Petrova lines")

The book has three notable Petrova-line systems. Each is a different
scene mood; one (or all three) becomes a director-rotated variant.

### 4.1 Sol → Venus (the dimming)

The opening of the book. A G-type star (yellow-white), Venus as the
sink (small, hot, with a faint red arrival glow).

- **Palette:** sun yellow-white, beam IR-orange, Venus reddish
- **Mood:** ominous, "something is wrong"
- **Beam density:** medium-high (Sol is being _drained_ visibly)
- **Director pace bias:** slow — this is a hold-and-stare scene

### 4.2 Tau Ceti → Adrian (the destination)

Where the Hail Mary arrives. A K-type star (orange), Adrian as a
larger gas-environment world.

- **Palette:** Tau Ceti deep amber, beam burnt-orange, Adrian
  green-grey (Taumoeba presence)
- **Mood:** alien, far-from-home
- **Beam density:** very high (Tau Ceti dimmer means more astrophage
  at a brighter rate)
- **Cross-feature:** _the_ scene for a Hail Mary or Blip-A sighting

### 4.3 40 Eridani A → Erid (the Eridian crisis)

The other ailing system. An orange dwarf with the same problem.

- **Palette:** 40 Eridani warm-orange, beam crimson, Erid dark
- **Mood:** parallel — the Eridians are dying, too
- **Beam density:** medium
- **Director hint:** good as a "sister" scene to Tau Ceti — pairing
  them in adjacent dwells (separated by a `pullback`) tells a story
  without words

### 4.4 Picking between them

Three approaches:

- **Single scene with seeded variants** — one `scenePetrovaLine`
  function, the seed picks Sol/Tau Ceti/40 Eridani. Cheapest.
  Director sees one scene key.
- **Three scene keys** — `scene-petrova-sol`, `scene-petrova-tau`,
  `scene-petrova-erid`. Director treats them as distinct, can build
  story arcs (`tau` followed by `erid` reads as "the same crisis,
  different system"). Adds three SHOT_GRAMMAR entries instead of one.
- **One scene key, but the variant persists across dwell** — cycles
  randomly between dwells. Adds a director knob.

I'd ship **single scene, variant picked at scene-init from a
weighted seed**, with all three variants present. Multiple scene
keys is a follow-up if the storytelling between them turns out to
matter.

---

## 5. Ship sightings (the Hail Mary, the Blip-A, the Beetles)

Within this scene — and only this scene — a small spacecraft from
_Project Hail Mary_ occasionally cruises through the frame. The
viewer who's read the book sees the explorer crossing the migration
the explorer was sent to study. The viewer who hasn't sees a small
intentional shape moving through the beam.

This section owns _when_ ships appear and _which one_; the
rendering, trajectory math, and archetype designs live in
[PASSING_SHIPS.md](PASSING_SHIPS.md).

### 5.1 The spawn scheduler (scene-local)

The scheduler lives inside `scenePetrovaLine`'s tick function, not
in the global director. It runs only while this scene is the active
scene and the director is in DWELL.

```js
// roughly, per frame, only while petrova-line is the DWELL scene
if (
  petrova.shipState === "IDLE" &&
  now >= petrova.nextSighting &&
  director.state === "DWELL"
) {
  const archetype = pickArchetype(); // §5.4 weights
  const seed = (Math.random() * 0xffffffff) | 0;
  petrova.shipState = "ACTIVE";
  petrova.activeShip = spawnShip(archetype, seed); // from PASSING_SHIPS
  petrova.nextSighting = now + sampleSightingDelay();
}

// Long-tail distribution: hard floor + exponential tail.
// Median wait ~12 minutes of *time-in-this-scene*, which combined
// with the scene's own rotation gives multi-hour real-time gaps.
function sampleSightingDelay() {
  const floorMin = 4; // never sooner than this
  const tail = -Math.log(Math.random()) * 10; // exponential, mean 10min
  return (floorMin + tail) * 60_000; // ms
}
```

The cooldown is **time-in-this-scene**, not wall-clock. If the user
is parked in petrova-line for 20 minutes straight, they might see
two ships. If they cycle through other scenes for an hour and only
return to petrova-line for 3 minutes, they'll likely see nothing.
This is correct: the sighting is a function of "you're watching the
migration," not "time has elapsed."

### 5.2 Why scene-local, not global

The scheduler is intentionally scene-local rather than tied into the
director-wide cooldown. Three reasons:

- **Surprise compounds.** The petrova-line scene is itself rare in
  director rotation (anti-repeat, depth 3). Within it, a sighting is
  rare. Two layers of rarity multiply, and the user can't predict
  either.
- **No "due-but-vetoed" awkwardness.** A global scheduler with a
  per-scene veto table needs rules for what happens when the cooldown
  expires in a vetoed scene. Scene-local sidesteps this entirely.
- **Implementation simplicity.** ~50 LoC of scheduler that lives in
  one file, vs. a global system that needs persistence, per-scene
  weights, and cross-scene state.

### 5.3 Director awareness during a sighting

Once `petrova.shipState === "ACTIVE"`:

- The director **does not pick a transition** until the cruise
  completes. A transition mid-cruise cuts the moment. Implementation:
  a soft-block flag the director's state machine checks before
  picking its next transition.
- The framing sanity check ([CINEMATIC_MODES.md §3](CINEMATIC_MODES.md))
  treats ship nodes as _high-priority_ key bodies, so any move
  scheduler that fires keeps the ship visible.
- Optional: `pickCameraMove` gets a soft bias toward gentle pans
  during a sighting — a slow pan that follows a passing ship across
  the beam is the whole emotional payoff. Default off for v1; opt-in
  via a director flag.

When the cruise completes, `petrova.shipState` returns to `IDLE` and
the director resumes normal behaviour.

### 5.4 Archetype weights & anti-repeat

When the scheduler decides to spawn, it picks an archetype from the
weighted distribution defined in [PASSING_SHIPS §5.4](PASSING_SHIPS.md):

- **Hail Mary:** 0.45
- **Blip-A:** 0.45
- **Beetle (solo):** 0.08
- **Beetle (paired / all-four):** 0.02

Plus a rolling window depth 2 to prevent back-to-back repeats. The
co-primary Hail Mary and Blip-A means neither feels rarer; the
Beetle is the genuine surprise.

### 5.5 The paired sighting (rare)

The book's iconic image: the Hail Mary and the Blip-A docked, parked
together at Tau Ceti. As a sighting, this means spawning **two ships
in formation** — one Hail Mary, one Blip-A, on parallel paths
offset by a fixed distance, cruising as a paired silhouette.

Mechanically a small extension of the spawn function in
[PASSING_SHIPS](PASSING_SHIPS.md): spawn two ships with shared
trajectory parameters, offset perpendicular to the path. ~30 LoC
addition.

Trigger: ultra-rare (~2% of sightings, weighted into §5.4 above).
A genuine once-an-evening moment.

### 5.6 The Beetle's collection behaviour

A Beetle sighting in this scene gets one extra trajectory beat: at
the midpoint of its cruise, slow to ~25% speed, hover for ~2s, emit
a small brightness pulse ("collecting astrophage"), resume. Reads
as the probe doing its job.

~30 LoC of trajectory state extension on top of the base trajectory
generator in [PASSING_SHIPS §4](PASSING_SHIPS.md). Defer to v1.5
along with the Beetles archetype itself.

---

## 6. Where this lives in the engine

### 6.1 The scene file

A new `scenePetrovaLine()` next to the existing scene init functions.
Allocates:

- 1 star body (high mass, position at origin)
- 1 planet body (low mass, position at +60 units along X)
- ~50,000 astrophage bodies (kind = ASTROPHAGE)
- A handful of background "stars of the local neighborhood" (very
  faint, scattered) for visual depth — kind = DUST

Total body count fits comfortably within all density tiers (lush =
~75k, titanic = ~130k); this scene wouldn't push the cap.

### 6.2 The velocity-kernel branch

```glsl
if (kind == KIND_ASTROPHAGE) {
  // §3.1 — gravity to star, gravity to planet, thrust to planet
} else if (kind == KIND_SHIP) {
  // PASSING_SHIPS path — position written from CPU, skip force eval
} else {
  // existing N-body inner loop
}
```

The kind branch is uniform within a workgroup (all threads at the
same texel index see the same kind), so it's cheap. Astrophage skip
the inner N² loop entirely — they don't gravitate to other particles.
This is an _O(N)_ scene relative to astrophage count, not _O(N²)_.

That makes it cheaper than every other scene we have, despite the
high body count.

### 6.3 The respawn pass

The §3.4 lifecycle lives in the same kernel — one extra `if (dArrive
< uPlanetRadius)` after the integration. No second pass needed.

### 6.4 Director integration

`SHOT_GRAMMAR` entries. Some that feel right:

```js
"birth→petrova-line":         { flavour: "pushin",    durationMul: 1.4 },
"petrova-line→event-horizon": { flavour: "pullback",  durationMul: 1.5 },
"petrova-line→stephans-quintet": { flavour: "dissolve" },
"event-horizon→petrova-line": { flavour: "horizon-transit" }, // chef's kiss
```

The last one is the wormhole-to-Petrova-line move. The user just
plunged through a black hole's throat and emerges in a star system
where someone is dying of light-starvation. That's a story.

### 6.5 Anti-repeat & breathing

Standard treatment — `recentScenes` includes `petrova-line`,
breathing baseline captured per [CINEMATIC_MODES.md §1](CINEMATIC_MODES.md).
Pace bias: slow (this is a meditative scene, not a fast one).

---

## 7. Audio

The scene wants its own sonic palette. Three suggestions:

- **A low sustained pad** in the key of the dominant beam color.
  Tau Ceti variant in F minor (warm, burnt); 40 Eridani in C# minor
  (cold, distant); Sol/Venus in A minor (familiar, ominous).
- **Granular high-frequency texture** mapped to beam density —
  louder when more astrophage are mid-flight, quieter at low-density
  moments. The viewer hears the migration.
- **A soft chime on each "arrival pulse"** at the planet (§3.4) if
  we ship that. Quiet, infrequent (one per ~60 arrivals, not one
  per arrival, or it'd be a constant tinkle).

V1 can ship with just the pad. The granular texture is a nice-to-have.

---

## 8. Risks

### 8.1 The beam doesn't curve enough (or curves too much)

The §3.3 thrust knob is doing all the work. Wrong value and the
beam is a straight line (boring) or a tight loop (unreadable). Need
a `?rehearse=petrova&thrust=N` URL param to bisect during tuning.
~10 LoC.

### 8.2 The respawn boundary "pops"

If astrophage spawn fully bright at the star surface, they pop into
existence. Mitigation: spawn with `emissivity = 0`, ramp to full
brightness over the first ~1 second of life. Same trick at the
planet — fade to 0 over the last ~0.5 seconds before despawn.
~20 LoC, makes the difference between "magical" and "buggy".

### 8.3 The beam dominates the composition too hard

The existing scenes have multiple regions of interest (disk + jets

- ambient). The Petrova line is _one_ feature — beam, star, planet,
  done. Risk: it reads as monotonous after 30s of dwell. Mitigations:

* **Short dwell range** — 25-60s, vs. the existing 60-180s for
  busier scenes. Tag the scene as `composition: "linear"` and have
  the director pick shorter dwells for it.
* **Camera moves that travel along the beam** — a slow pan from
  star to planet (or reverse) gives the viewer a different angle on
  the same visual every few seconds. The existing camera move
  scheduler handles this if `pickCameraMove` knows the beam's axis.

### 8.4 Particle count vs. beam thinness

50,000 astrophage in a corridor is the v1 estimate. Could need 100k
for the beam to read solid, or 20k could be enough if trail length
is high. Tuning question; the body-count budget allows up to ~80k
for this scene before pushing density tiers.

### 8.5 Ship sighting cut by a director transition

If a sighting is mid-cruise when the director picks a `petrova-line
→ event-horizon` transition, the ship gets cut in half. Handled by
the §5.3 director soft-block: while `petrova.shipState === "ACTIVE"`,
the director defers transitions until the cruise completes. ~15 LoC,
listed as Phase B step 9 in §10.

### 8.6 IP / fan-tribute caveat

This scene is unmistakably a _Project Hail Mary_ reference — the
Petrova line is a specific element from a copyrighted novel. The
underlying physics (particles thrusting between bodies) is generic;
the _staging_ (curve, palette, planet pairings, the Hail Mary
sighting) is the homage. This is fine for personal / non-commercial
use; if the project is ever distributed commercially the references
would need a closer look. Not a code question. Worth flagging once.

---

## 9. Open questions

- **Single scene or three?** §4.4 — single with seeded variant is
  cheapest, three keys gives the director storytelling power.
  Default: single.
- **Astrophage gravitate each other?** Default no (handled in §6.2).
  But if any tier of body count makes the beam feel "stiff", a tiny
  inter-astrophage attraction (negligible mass, weak G) could give
  the beam an inner waviness. Optional, late tuning.
- **The arrival pulse on the planet (§3.4).** Adds 15 LoC and
  meaningful visual feedback, but also adds a distracting pulse
  pattern. Test in rehearsal mode.
- **Does the star dim over time?** In the book the star is being
  drained. We could slowly desaturate / dim the star body over the
  scene's dwell. Subtle; might read as a bug. Skip for v1, consider
  later.
- **Should the planet rotate / show terrain?** Bodies in this engine
  are points, not spheres with surface detail. The planet would just
  be a bright dot. That's fine — the beam is the hero, the planet is
  a sink. No special rendering needed.
- **Multiple planets at the same star?** Tau Ceti has several. We
  could have two beams (Adrian + a second sink), which would make a
  visually richer scene. Adds tuning surface; defer to v2.
- **Camera default pose.** Star-side wide shot, planet in the upper
  right? Or beam-axis top-down so the curve is fully visible? The
  curve is the hero, so prefer a 3/4 view that shows it. Test in
  rehearsal.

---

## 10. Shortlist (where I'd start)

If the goal is _"ship a petrova-line scene with ship sightings in a
week and a half"_, two phases:

### Phase A — the scene itself (~3 days, ~250 LoC)

1. **Add `KIND_ASTROPHAGE` and the velocity-kernel branch (§3.1).**
   ~30 LoC of GLSL + uniform plumbing. Test with a hand-built case:
   100 astrophage at the star, planet at +30 units, eyeball the
   curve.
2. **Add the respawn lifecycle (§3.4).** ~20 LoC of GLSL. Verify
   particles arrive and respawn without popping.
3. **Build `scenePetrovaLine()`** (~150 LoC) — star body, planet
   body, 50k astrophage seeded into a corridor, palette set.
4. **Tune the three knobs (§3.3)** in `?rehearse=petrova` mode until
   the beam curves the way the book describes. ~half a day of
   eyeballing, not code.
5. **Director hookup** — add to `SHOT_GRAMMAR` (~20 LoC), give it a
   slow-pace bias, dwell range 60–180s (long enough that a ship
   sighting fits comfortably; see §11).
6. **Pick one variant for v1** — Tau Ceti / Adrian, the destination
   variant. Sol/Venus and 40 Eridani are v1.5.
7. **Audio pad** — load a sustained low drone matched to the
   palette. Reuse the existing `<audio>` infrastructure. ~10 LoC.

At the end of Phase A, the scene is shippable on its own. Ships are
the next layer.

### Phase B — ship sightings within the scene (~3 days, ~320 LoC)

This depends on the implementation in [PASSING_SHIPS.md](PASSING_SHIPS.md);
do its steps 1–7 in parallel with Phase A.

8. **Scene-local spawn scheduler (§5.1).** ~50 LoC: cooldown sampler,
   `petrova.shipState` machine, archetype picker, anti-repeat
   window. Lives in `scenePetrovaLine`'s tick function.
9. **Director soft-block during a sighting (§5.3).** ~15 LoC: when
   `petrova.shipState === "ACTIVE"`, the director defers transitions.
10. **Wire `spawnShip(archetype, seed)` from
    [PASSING_SHIPS](PASSING_SHIPS.md) step 6.** ~10 LoC. The scene
    calls; the function lives over there.
11. **`?rehearse=petrova&ship=hail-mary` URL param** — combines the
    two rehearsal modes. Forces a sighting on every scene init in
    petrova-line. ~15 LoC.

**Phase B v1.5 (defer):** the paired Hail Mary + Blip-A sighting
(§5.5, ~30 LoC), the Beetle archetype (~50 LoC), the in-beam Beetle
collection beat (§5.6, ~30 LoC). Ship after the Hail Mary and Blip-A
solo sightings have baked.

### Total

- **Phase A only:** ~250 LoC, ~3 days. Scene shipped, no ships.
- **Phase A + B (Hail Mary + Blip-A solo sightings):** ~570 LoC,
  ~6 days.
- **+ v1.5 (Beetles, paired, collection):** ~110 LoC and ~1 day on
  top.

---

## 11. What I'd want to confirm before writing code

- That the velocity-kernel can take a third per-body branch
  (`ASTROPHAGE` alongside the existing kinds and the `SHIP` branch
  from PASSING_SHIPS) without GLSL register pressure becoming a
  problem. Likely fine; modern GPUs handle 3-way kind branches
  cheaply.
- That respawning particles inside the kernel (writing both pos and
  vel from a hash function) doesn't violate any double-buffering
  assumption in the existing pos/vel ping-pong. Should be fine —
  respawn writes to the next-frame buffer like every other update,
  but verify.
- That a 50k-astrophage scene at ~12s transit time doesn't visibly
  starve the corridor at any moment. Math: 50k bodies / 12s lifetime
  = ~4.2k bodies arriving and respawning per second; at any instant,
  50k bodies are distributed along the curve. That's ~830 bodies per
  scene-unit of beam length on a 60-unit transit — should be plenty
  for a coherent line, but verify.
- That the §4.4 "single scene, seeded variant" is the right call vs.
  three separate scene keys. Affects director storytelling; cheap to
  upgrade later if we pick wrong.
- That a dwell range of 60–180s is long enough for a ~12s ship cruise
  to feel like a moment within the scene, not the whole scene. At
  the lower end (60s dwell), a sighting consumes 20% of the scene
  time — feels right. At the upper end (180s), a sighting is one
  detail of many. If dwells get shorter than ~45s, sightings start
  feeling like the scene's whole point, which we don't want.

If those land, step 1 is reversible and self-contained — get a
single curving particle stream from one body to another, then build
out from there.
