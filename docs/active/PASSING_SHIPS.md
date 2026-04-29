# Passing Ships — implementation notes

> **v1 scope:** ships only appear in the [PETROVA_LINE](PETROVA_LINE.md)
> scene. The Hail Mary, the Blip-A, and the Beetles are all from Andy
> Weir's _Project Hail Mary_; pulling them into other scenes raises
> "what is a human starliner doing at Stephan's Quintet?" questions
> we don't want to answer in v1. Cross-scene sightings (with a
> non-PHM taxonomy) are deferred — see §10.

This doc owns the **rendering, trajectory, and archetype design** for
the PHM ships. Spawning, scheduling, and per-scene integration live
in [PETROVA_LINE.md §5](PETROVA_LINE.md). The split:

- **PETROVA_LINE** decides _when_ a ship appears.
- **PASSING_SHIPS** (this doc) decides _what_ it looks like and _how_
  it moves once spawned.

Three rendering interpretations, the trajectory math, the three PHM
archetypes, risks, and a shortlist for v1. Not decided.

---

## 1. The pitch in one paragraph

Within the [PETROVA_LINE](PETROVA_LINE.md) scene — the curved
astrophage migration between a star and a planet — every so often a
small spacecraft from _Project Hail Mary_ cruises through the frame.
A Hail Mary, a Blip-A, or rarely a Beetle. Each appearance is
procedurally varied (different sensor positions, palette shift,
centrifuge phase) but always recognisably one of those three named
ships. The cruise lasts ~10–15 seconds. No UI, no labels, no fanfare.
The viewer who's read the book gets a private moment of recognition;
others see a small intentional shape moving through the migration.

Always **a surprising delight**: never expected, never on a schedule
the viewer can feel.

If [PETROVA_LINE](PETROVA_LINE.md) is the migration, this is the
explorer crossing it.

---

## 2. Pieces this implementation builds on

- **Body system with kinds** — disk, jet, dust live as integer `kind`
  values inside the velocity uniform (e.g. the disk/jet split near
  [index.html:4191](index.html#L4191)). Ships add a new kind
  (`KIND_SHIP`) that the gravity solver _ignores_ — its position is
  advected by a scripted path, not by the field. Cheap to graft on.
- **Trail buffer** — the existing accumulation pass already paints
  bright moving points as streaks. Engine glow comes free if a ship
  has a couple of high-emissivity points at its rear.
- **Breathing baseline + post-FX** — already amplitude-aware. The
  ship doesn't need its own bloom or CA budget; it paints into the
  same buffer.
- **Per-scene scheduler hook** — [PETROVA_LINE](PETROVA_LINE.md)
  tracks its own DWELL state and owns the ship spawn rate. This doc
  doesn't touch the global director state machine.

So the surface here is: a procedural ship generator, a path follower,
and a render path. Spawn timing belongs to the scene.

---

## 3. Three rendering interpretations (pick one — they read very differently)

### A. Sprite billboard

A small screen-space sprite (say 32×32 to 96×96 px) drawn once per
frame at the ship's world position, billboarded toward the camera,
oriented along the velocity vector. The sprite is generated at
appearance time from a procedural recipe (§5).

**Pros:** ~80 LoC. Doesn't touch the particle pipeline. Sprite can be
arbitrarily detailed (anti-aliased edges, glowing windows, colored
running lights). Readable as a _ship_ even at small angular size.
**Cons:** sprite + particles look like two different art styles
glued together. The ship pops, in a bad way.

### B. Constellation of bodies

A ship _is_ N existing particles (~18 for the Hail Mary, ~26 for the
Blip-A) held in a fixed local arrangement, advected as a rigid body
along a path. They paint themselves through the same trail buffer as
everything else, so the ship has continuity with the rest of the
picture. Engine glow is just two or three rear points sitting at
higher emissivity.

A handful of points moving in formation reads as _intentional_
against the surrounding swirl — the eye picks it up immediately. It
also looks _native_ to the simulation, because it is.

**Pros:** ~150 LoC. Native art style. Trails come for free.
Body-count cost is negligible (24 bodies / 50k astrophage = noise).
Naturally compatible with the lens shader, palette, exposure.
**Cons:** the "ship-ness" lives entirely in the constellation
pattern; abstract. A naive viewer might read it as "a small cluster
moving funny" rather than "a craft." Mitigated by the §5 patterns
(centrifuge animation, internal/external rotor distinction) and by
the trajectory (§4 — ships move in straight-ish lines, no swirling,
no acceleration toward a body).

### C. Mini geometry pass

A real triangle mesh — generated procedurally from the recipe — drawn
in a tiny secondary pass after the particles. Proper hull, proper
shading, proper silhouette.

**Pros:** unambiguously a ship. Could even cast the lens shader's
warp behind it.
**Cons:** ~500 LoC + a new render pipeline + a generative-mesh
library. Different art style from particles in a more pronounced way
than (A). Worth considering only after (B) ships and we know the
feature lands.

My instinct is **B** for v1 — it costs little, looks native, and the
ship-ness comes from pattern + trajectory, not from rendering tricks.
**A** is the fallback if (B) reads too abstract in playtest.
**C** is a follow-up if anyone falls in love with v1.

---

## 4. Trajectory

A ship enters from somewhere outside the camera frustum, takes
10–15s to cross, exits the other side. Detail per beat:

```
 SPAWN    →   CRUISE (8–12s)    →   EXIT
 (offscreen)    (across frame)       (offscreen)
```

### 4.1 Spawn pose

- Pick an entry direction uniformly from a hemisphere oriented away
  from the camera-up axis (so ships don't enter from "below the
  floor" of the composition).
- Place the spawn point ~1.4× outside the visible frustum edge along
  that direction.
- Choose an exit point on the far side of the frustum, biased so the
  cruise path passes through the central 60% rect (the framing
  sanity check from [CINEMATIC_MODES.md §3](CINEMATIC_MODES.md)
  applies in reverse — we _want_ the path to be visible).
- In [PETROVA_LINE](PETROVA_LINE.md), bias spawn so the cruise
  crosses the astrophage beam at least once. Ships intersecting the
  migration is the visual point.

### 4.2 Path

A cubic Bézier from spawn to exit with two control points jittered
~10% off the straight line. Yields a gentle curve, never a
spirograph. Constant arc-length parameterisation so the ship moves
at uniform speed regardless of the curve's shape.

### 4.3 Speed

- Target: ship traverses ~½ frame width per 5 seconds.
- In world units, depends on scene scale. Compute at spawn from the
  scene's natural body-velocity median × 0.6, so the ship reads as
  "moving with purpose" but slower than fast astrophage in the beam.
  (A ship moving faster than the beam reads as a missile, not a
  vessel.)

### 4.4 Orientation

Forward = unit tangent of the path. Up = camera-up projected onto
the plane perpendicular to forward. Mild banking on path curvature
(roll = `k × curvature × forward·right`, capped at 25°). Banking is
the cheapest cue that the ship has a "down" — without it, the
constellation reads as a freely tumbling rock.

### 4.5 No interaction with the sim

The ship's particles are advected from the path, not from the field.
They are explicitly _excluded_ from the gravity kernel by their kind
flag. This matters in [PETROVA_LINE](PETROVA_LINE.md): a ship
crossing the astrophage beam should pass through cleanly on its
scripted path, not get caught up in the migration's gravity well.
(Visually implying "the pilot is steering" is much more interesting
than watching the ship drift with the flow.)

---

## 5. The three Project Hail Mary archetypes

The feature commits to a single source: the spacecraft of Andy
Weir's _Project Hail Mary_. Two named ships — the **Hail Mary**
(human) and the **Blip-A** (Eridian) — plus an optional rare third
(the **Beetles**, small Astrophage-collection probes). Every
appearance is the same ship at a different moment of its journey.

This is a tighter scope than a generic taxonomy and it earns more in
return:

- **Coherent identity.** The feature has a _meaning_ — these are the
  ships from a specific story crossing the migration that story is
  about. Not just "various spacecraft."
- **Higher v1 quality.** ~270 LoC budget buys two hand-tuned ship
  designs instead of eight half-tuned ones.
- **Sharper "did this read?" test.** "Would a PHM reader recognise
  it?" is more useful than "does this look human or alien?"
- **Variation lives in the seed.** Same hull recipe, different
  sensor-node placement, palette shift, centrifuge phase. Each Hail
  Mary sighting is the same ship at a different moment of a
  multi-year mission.

Every appearance is a fresh `seed`. The recipe shape:

```js
{
  archetype: "hail-mary" | "blip-a" | "beetle",
  nodes: [{ localPos, emissivity, color, role }, ...],
  centrifuge: { axis, period, nodeIndices } | null,
  glowTrailNodes: [...],
  palette: { hull, glow, accent },
  seedJitter: { ... },
}
```

### 5.1 The Hail Mary (~18 nodes)

The signature visual is the **three-pod centrifuge** — Yáo /
Ilyukhina / Grace's compartments rotating around the spine. Without
it, the Hail Mary is just a row of dots. With it, the brain locks on
instantly as a specific named ship.

Layout, forward to aft along local +Z:

| Section            | Nodes | Notes                                         |
| ------------------ | ----- | --------------------------------------------- |
| Nose / control     | 1     | Steady white prow light                       |
| Centrifuge ring    | 3     | **Rotates** around +Z at ~1 rev / 4s          |
| Lab module         | 1     | On spine                                      |
| Dorm module        | 1     | On spine                                      |
| Storage module     | 1     | On spine                                      |
| Junction           | 1     | On spine                                      |
| Spin drive         | 6     | Tight rear cluster, IR-red glow, engine trail |
| Antennae / sensors | 4     | Small, off-axis, mostly forward-half          |

- **Symmetry:** bilateral along spine, asymmetry ~0.05.
- **No aviation nav lights** — explicit choice. The Hail Mary is a
  NASA-lineage research craft, not an airliner; book-accurate is a
  single steady white at the prow plus the IR-red spin-drive glow at
  the rear. Also more visually distinctive than generic red/green.
- **Palette:** off-white / gunmetal hull, IR-red engine glow,
  pale-warm prow light.
- **Seed variation:** sensor-node positions jitter ±15%, centrifuge
  phase randomises (so we see it at different rotational positions
  per sighting), palette temperature drifts ±10%.

The centrifuge animation is the cheapest, highest-impact authoring
choice in the whole feature — ~5 LoC of "rotate three node positions
around the local +Z axis at constant angular velocity, advect with
the ship's path."

### 5.2 The Blip-A (~26 nodes)

Harder to render: the book describes it as an "irregular xenonite
blob, no clear front" — exactly the failure mode a constellation
can fall into. We need it to read as _intentional irregularity_, not
_failed regularity_. Levers:

- **Lumpy main body** — 18 nodes distributed in a 3D blob with a
  vague longest-axis but no mirror plane, asymmetry ~0.5.
- **Internal rotating section** — 4–5 nodes spinning around an axis
  _inside_ the hull (the Eridians' high-G centrifuge). Crucially
  _internal_ rather than external — the inverse of the Hail Mary's
  external ring. That contrast is the visual rhyme that ties the two
  ships together across sightings.
- **Warm-orange aft glow** — 2–3 nodes (Eridians use astrophage too,
  parallel invention), more diffuse than the Hail Mary's tight
  spin-drive grid.
- **Dark grey-brown palette** (xenonite), no strobes, no nav lights.
- **Subtle internal node drift** — small per-node oscillation around
  hull positions. The Hail Mary is rigid; the Blip-A breathes.

Seed variation: the lumpy-body distribution re-rolls per sighting
(within asymmetry bounds), internal rotor phase randomises, palette
shifts toward either rust-brown or slate-grey per seed.

The "internal vs external centrifuge" trick is what makes the pair
_read as a pair_ even when sightings are hours apart.

### 5.3 The Beetles (optional, ~5 nodes each)

Small autonomous Astrophage-collection probes — John, Paul, George,
Ringo. Half the screen-size of a Hail Mary or Blip-A.

- 4 small body nodes in a tetrahedron arrangement
- 1 brighter rear node (small spin drive)
- Pale-white hull, faint red engine glow
- Symmetric, mass-produced — asymmetry 0

Spawn variations: usually solo, but ~10% chance of a **paired** or
**all-four** sighting — multiple beetles in loose formation on
parallel paths. "All four coming home" is its own kind of magic.

In [PETROVA_LINE](PETROVA_LINE.md), Beetles get an extra behaviour:
slow mid-cruise, hover briefly _in_ the astrophage beam, brighten
slightly ("collecting"), resume. Pure cinematic, ~30 LoC of
trajectory state extension.

### 5.4 Anti-repeat & sighting weights

These are scene-local — [PETROVA_LINE](PETROVA_LINE.md) owns the
when, this section just specifies the relative weights when the
scene picks an archetype:

- **Hail Mary:** 0.45
- **Blip-A:** 0.45
- **Beetle (solo):** 0.08
- **Beetle (paired / all-four):** 0.02

Hail Mary and Blip-A are co-primary — neither feels rarer than the
other in aggregate. Beetles are the genuine surprise; one Beetle
sighting per evening is the magic dose.

A rolling window depth 2 across the three archetypes prevents
back-to-back repeats. Combined with the scene's own appearance
rarity (the petrova-line scene itself isn't on every dwell), this
gives effortless variety.

---

## 6. Where this fits in the engine

- **Render path** — interpretation B (constellation of bodies) means
  ships render through the existing particle pipeline. ~24 extra
  point bodies per active sighting, painted via the trail buffer.
  No new render pass. See §3.
- **Velocity-kernel branch** — `kind == KIND_SHIP` skips the gravity
  inner loop entirely. Position is written from CPU each frame from
  the trajectory generator (§4). One extra branch in the kernel
  alongside the `KIND_ASTROPHAGE` branch added by
  [PETROVA_LINE §6.2](PETROVA_LINE.md).
- **Spawn lifecycle** — owned by [PETROVA_LINE §5](PETROVA_LINE.md).
  When the scene decides to spawn, it calls `spawnShip(archetype,
seed)` defined here; the function allocates the ship's body slots,
  builds the constellation per §5, and starts the trajectory loop
  per §4. On cruise completion, the slots are freed.
- **Director awareness** — the scene knows when a ship is in flight
  and defers transitions accordingly. See [PETROVA_LINE §5](PETROVA_LINE.md).

---

## 7. Audio

Silent for v1. The whole point is the visual surprise of seeing a
shape that doesn't belong in the migration. Music continues
uninterrupted; the ship has no theme, no whoosh, no sting. The
viewer who notices it gets a private moment of _"wait, was that the
Hail Mary?"_

If audio ever joins:

- A single sub-bass swell that crests at the ship's closest approach
  to the camera, ducks out as it exits. ~6 seconds, -24 dBFS, mostly
  felt rather than heard.
- No engine noise — that pushes toward "this is a video game scene,"
  which is the failure mode for the whole feature.

---

## 8. Risks

### 8.1 The ship reads as a glitch

If interpretation B's constellation is too abstract, the viewer's
pattern-matcher fails and they read "a few particles moving weird"
instead of "a vessel." Mitigations:

- Lean hard on **trajectory regularity** — straight-ish path, mild
  banking, constant speed. Real bodies in this sim don't move like
  that. The trajectory does most of the work.
- Lean hard on the **centrifuge animation** for the Hail Mary —
  three nodes rotating in a stable ring against the surrounding
  swirl is unambiguously _machinery_, not natural motion. This is
  the load-bearing read for the human archetype.
- A/B test interpretation B against the sprite (A) for the Hail Mary
  before fully committing. If B fails the legibility test, the
  architecture allows a per-archetype switch (Hail Mary uses A,
  Blip-A uses B).

### 8.2 Distracting from the meditative tone

The [PETROVA_LINE](PETROVA_LINE.md) scene already pulls toward
narrative — there's a star dying, a planet receiving, a migration in
flight. A ship is more narrative on top of that. Risk: the scene
reads as "a story" rather than "weather you can stare at."

Mitigation: ship sightings are infrequent enough that most
petrova-line dwells contain none. The narrative weight builds only
on the rare sighting; the default scene experience is just the beam.
Plus the small angular size (the ship occupies <8% of the frame's
shorter dimension at closest approach) keeps it a detail, not a
focal subject.

### 8.3 Procedural ships look bad

Procedural geometry has a known failure mode: parameter spaces too
wide produce ugly outliers. Mitigations:

- **Tight per-archetype parameter ranges** — each generator is
  hand-tuned for its specific ship, not a single global recipe with
  switches.
- **A reject-and-resample step** for the Blip-A specifically — after
  generating a lumpy body, score it on simple heuristics (no two
  nodes too close, hull is connected, asymmetry within bounds).
  Reject and resample if it fails. ~10 LoC; saves embarrassment.
- **A `?rehearse=ships` URL param** that fires a new ship every 8s in
  the petrova-line scene, so we can flip through ~50 ships in a few
  minutes during tuning.

### 8.4 Density-tier collisions during a sighting

Density changes rebuild the body-storage textures. If a ship is in
flight when the user changes density, its node indices become
invalid. Two clean options:

- **Defer the density change** while a ship is active (mirrors
  [EVENT_HORIZON_TRANSIT_PLAN.md §5.2](EVENT_HORIZON_TRANSIT_PLAN.md)).
- **Despawn the ship instantly** (no animation) on density rebuild.
  The user is interacting; the magic moment is already broken.

I'd ship the despawn — simpler, and respects the user's input
priority.

---

## 9. Open questions

- **Interpretation A vs B for v1.** The doc's instinct is B, but it
  needs an in-browser legibility test before committing. The
  centrifuge is the make-or-break visual for B.
- **Curious vs indifferent camera.** When a ship spawns, does the
  director do anything with the camera? Indifferent (no change) is
  safer; curious (4-second gentle pan toward the ship's mid-cruise
  position) is more magical but risks "the camera is attached to a
  UFO" reads. Default: indifferent for v1.
- **User-triggerable.** A hotkey (`u` for "UFO"?) that forces a
  sighting in the current petrova-line scene. Useful for
  screenshots and showing someone the feature without waiting.
  Probably yes via URL param (`?ship=hail-mary`), unbound by
  keyboard for v1 — keeps it a debug surface.
- **Telemetry.** Log each sighting with `{ archetype, seed,
petrovaVariant, cruiseDuration, peakFovOccupancy, beamCrossings }`
  to the rolling-telemetry buffer ([CINEMATIC_MODES.md §13](CINEMATIC_MODES.md)).
  So that "the Hail Mary at minute 47" is recoverable from the seed.
- **Bookmark integration.** [FUTURE_IDEAS.md](FUTURE_IDEAS.md)
  sketches a bookmarks system. Should bookmarks capture an
  in-flight ship's seed + path-time so it can be re-spawned on
  restore? Probably yes if both features ship.

---

## 10. Shortlist (where I'd start)

Assumes [PETROVA_LINE](PETROVA_LINE.md) is being built in parallel —
the ships need a scene to live in. Both docs are intertwined: build
the scene first, then layer the ships into it.

1. **Pick interpretation B.** Constellation-of-bodies render path —
   new `KIND_SHIP` value, gravity kernel skips it, trail buffer
   paints normally. ~80 LoC.
2. **Hand-build a static Hail Mary at origin in the petrova-line
   scene.** ~30 LoC + manual node coordinates. Verify the 18-node
   constellation reads as a ship before building the generator. The
   centrifuge animation is mandatory for this test — without it,
   the legibility check is meaningless.
3. **Build the Hail Mary generator.** ~60 LoC of seeded recipe.
   Centrifuge animation, palette, sensor jitter. Per §5.1.
4. **Build the Blip-A generator.** ~70 LoC. The harder one — needs
   reject-and-resample to keep the lumpy body from looking random.
   Per §5.2.
5. **Trajectory generator** — spawn / Bézier path / orientation /
   banking, per §4. ~100 LoC.
6. **Wire to [PETROVA_LINE](PETROVA_LINE.md)'s spawn scheduler.**
   ~10 LoC: scene calls `spawnShip(archetype, seed)`, this doc
   provides the function.
7. **`?rehearse=ships` URL param** that fires a new ship every 8s in
   the petrova-line scene, with `?ship=hail-mary|blip-a` to force
   archetype. ~20 LoC.
8. **Beetles archetype** — defer to v1.5 once Hail Mary + Blip-A
   land. ~50 LoC including the in-beam collection behaviour.

**Total for v1 (Hail Mary + Blip-A): ~270 LoC, ~3 days** on top of
the petrova-line scene itself. Beetles add ~50 LoC and half a day.

### v2 — passing ships across all scenes

If the petrova-line ship feature lands and we want to bring back the
"any scene might surprise you with a ship" idea: introduce a
non-PHM archetype taxonomy (the original eight from earlier drafts:
human-cruiser, alien-jellyfish, alien-lattice, etc.) and a global
cross-scene scheduler with a 75-minute median cooldown. Ships in
non-petrova-line scenes use the generic archetypes; ships in
petrova-line stay PHM-specific. ~200 LoC on top of v1.

The original-draft global-scheduler design (35-minute hard floor,
exponential heavy tail, persistence to localStorage, per-scene veto
table) is retained in the git history of this doc as a starting
point if v2 happens.

---

## 11. What I'd want to confirm before writing code

- That a constellation of 18 nodes reads as the Hail Mary (not "some
  particles moving weird"). Settle in the browser first with a
  hand-built static example before building the generator. The
  centrifuge animation is the load-bearing visual element.
- That the Blip-A's lumpy-body distribution can be made to look
  intentional rather than failed-symmetric within the §5.2 reject-
  and-resample budget. Worth a 30-minute spike with hand-rolled
  parameters before committing to the generator.
- That the trail buffer paints a slow rigid body cleanly without
  smearing into the surrounding astrophage swirl. Should be fine —
  trails are per-body — but worth a 5-minute spike.
- That [PETROVA_LINE](PETROVA_LINE.md)'s dwell range is long enough
  for a ~12s ship cruise to feel comfortable, not rushed. The scene
  doc plans 25–60s dwells; the lower end leaves only ~13s of margin.

If those land, step 1 is reversible and self-contained — start with
the new `kind`, get a single static Hail Mary at the origin, then
build outward.
