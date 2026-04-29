---
status: exploration
last-updated: 2026-04-28
---

# Event Scenes — replicating real or fictional moments in the engine

## Premise

Most existing scenes are **categories of phenomenon**: a galaxy, a collision, an accretion disk, a cluster. They are stateless astrophysical archetypes. They do not point at a specific moment or story.

This doc explores a different scene posture: scenes that **replicate a specific event** — real or fictional. Halley's Comet, the 1994 SL9 impacts, GW170817, the Voyager Grand Tour. Or: the Petrova Line, the Death's End dimensional foil, the Crab supernova witnessed in 1054.

The question is not _can we do narrative_. The engine has no text, no audio sync, no per-frame scripting. The question is: **which events are already physics, and which would force us to bend the engine into something it isn't?**

Related active work:

- [PETROVA_LINE.md](docs/active/PETROVA_LINE.md) — the _Project Hail Mary_ Petrova line as a scene. Already an event-scene in motion.
- [PIXEL_THOUGHTS.md](docs/active/PIXEL_THOUGHTS.md) — user-authored moments absorbed into the field. Adjacent posture.
- [SHOW_DARK_MATTER_AUDIT.md](docs/active/SHOW_DARK_MATTER_AUDIT.md) — already shows scene authoring drift; new event scenes should set the example for consistency.

---

## The pattern

Scenes in this engine are init-only. From the [scene authoring surface](#authoring-template):

> Populate bodies via `setBody(i, x, y, z, mass, vx, vy, vz, kind)`, register palette/physics/post, hand off to the director. No per-frame update.

That constraint is the whole design challenge. **The event has to be encoded into initial conditions plus standing force fields.** It plays itself out under symplectic Euler — we don't direct it frame-by-frame.

This is liberating in the right cases. Two galaxies on intercept → tidal tails _emerge_. A black hole ringed by inspiraling debris → accretion _emerges_. The sim is the storyteller.

It is fatal in the wrong cases. An event that needs a clock ("at minute 3, the star collapses") needs either (a) the director to bridge multiple scenes, or (b) a new "scripted scene" primitive we don't have. For v1 of any event scene, prefer (a).

So the rubric is:

1. **Can the event be expressed as gravity + initial state?** → Strong fit.
2. **Does it need one new force/kind primitive (e.g. constant thrust per body, like astrophage)?** → Stretch, but doable in a few hundred lines, à la Petrova Line.
3. **Does it need text, audio, branching, or rigid bodies?** → Wrong tool. Skip, or wait until a primitive lands.

---

## Candidate events

### Strong fit — pure N-body or gravity + small variation

| Event                                              | Sketch                                                                                                                                                                                               | Notes                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shoemaker-Levy 9 → Jupiter (July 1994)**         | One massive body (Jupiter) + 21 fragments on a near-radial intercept, pre-disrupted by tidal forces. Each fragment plunges in sequence, kicks up an ejecta plume.                                    | Needs ~22 heavy bodies + dust shell around Jupiter for impact-flash effect. Bloom + radiation pulse on contact reads as the impact flashes. **No new primitive.**                                                                                                                                 |
| **GW170817 binary neutron star merger**            | Two compact heavy bodies inspiraling, surrounded by a thin disk of accreted matter. As they merge, an isotropic ejecta shell launches → kilonova.                                                    | The inspiral is automatic given softened gravity + drag (we don't have drag, but a pre-tuned approach orbit gets close). Kilonova flash = sudden bloom spike on merge. **Could need a tiny "merge → eject" event hook**, or fake it with a high-velocity ejecta shell pre-seeded around the pair. |
| **Crab supernova (1054 CE)**                       | Single very-massive body at center surrounded by ejecta shell with velocity gradient (faster on outside, but actually the opposite — homologous expansion: v ∝ r). Pulsar at center implied by jets. | Pure N-body, but the _shell_ topology is unusual — we don't have a "spherical shell" generator, just disks. **Add a `buildShell(N, r₀, v_homol)` helper.** Then a long, slow expansion as a meditative scene.                                                                                     |
| **Andromeda–Milky Way merger (~4.5 Gyr from now)** | Already half-built as `sceneCollision`. Difference: tune for the _real_ orbital geometry (Andromeda inbound at ~110 km/s along a known sky vector).                                                  | Mostly a re-tune of an existing scene. Worth doing as a tribute to a real predicted event. **No new primitive.**                                                                                                                                                                                  |
| **Voyager Grand Tour (1977–1989)**                 | Sun + four giant planets on real orbits + one "spacecraft" body whose path naturally curves through each gravity well.                                                                               | Needs a lightweight spacecraft kind (mass ≈ 0, fully passive under gravity, narrow point-sprite). The flyby curve is _the entire point_ — physics produces it for free. **One new kind, no new force.** Same primitive Petrova Line wants for its passing-ship sighting.                          |
| **Death's End "two-vector foil" (Liu Cixin)**      | Solar system being collapsed from 3D into 2D.                                                                                                                                                        | Cheat: a strong attracting plane (z → 0). All bodies decelerate in z while preserving xy motion. Visually: a sphere pancakes into a disk over ~30s. **One new force: planar attractor.** Slim primitive, big payoff.                                                                              |
| **Petrova Line (Project Hail Mary)**               | Already specced — see [PETROVA_LINE.md](docs/active/PETROVA_LINE.md). Star + planet + ~50k self-propelling astrophage particles.                                                                     | The canonical example. Adds `KIND_ASTROPHAGE` + a thrust term in the velocity kernel. **Already on the shortlist.**                                                                                                                                                                               |

### Stretch — needs one small primitive

| Event                                      | What's missing                                                                                                                 | Cost                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apollo 11 Earth–Moon–Earth**             | Spacecraft kind that experiences gravity but has trivial mass. _Same primitive as Voyager._                                    | New kind, ~30 LoC.                                                                                                                                                                                                                                          |
| **Cassini Grand Finale (2017)**            | Saturn + ring system + spacecraft on the proximal orbit threading the rings. Ends with a planned plunge.                       | Needs a ring-particle generator with sharp inner/outer edges + a Roche-zone gap. We don't have a structured ring builder — current `buildGalaxy` makes disks, not banded rings. **Add `buildRingSystem(planet, bands)`.**                                   |
| **EHT image of M87\* (2019)**              | We already have `sceneEventHorizon`. Difference: tighter framing, photon-ring asymmetry (Doppler beaming), single bright knot. | Bake a "framing preset" + a per-particle Doppler color shift on the disk. **No new primitive, just tuning.**                                                                                                                                                |
| **Tunguska / Chelyabinsk meteor airburst** | A single body decelerating in atmosphere → fragmenting → energy dump as light + ejecta.                                        | The deceleration profile is alien to the sim (we have no atmosphere model). Could be a one-time "explode at t=0" particle fountain. Better as a **sub-event triggered by the director** at the end of an "Earth approach" scene than as a scene itself.     |
| **Halley's Comet 1986 perihelion**         | Sun + cometary body with a tail. The tail = particles released continuously, blown outward by radiation pressure.              | We have radiation pressure already. Need a _body that emits particles over time_ — currently scenes can't spawn bodies after init. Either (a) pre-seed the tail as a long stream, accepting it doesn't grow, or (b) add an emitter primitive (bigger lift). |

### Wrong fit — skip or wait

These all want something the engine isn't shaped to give:

- **Galileo first observing Jupiter's moons (1610)** — wants text, a telescope frame, narrative voice. Wrong medium.
- **Destruction of Alderaan, Death Star superlaser, Borg cube emerging** — wants rigid-body meshes and authored geometry. Engine has only points.
- **First contact / Arrival heptapods** — wants a scripted alien geometry, language, and dialogue. None of which is N-body.
- **Apollo 11 landing on the surface** — wants terrain and a lander mesh. Voyager-style flyby is the right level for this engine.
- **Project Mayhem / Fight Club tower collapse** — gravitational free-fall of buildings is rigid-body, not particle.
- **The Big Bang** — too short on the front end (Planck epoch is irrelevant), too long on the back (structure formation is gigayears). Better as a director-driven _suite_ across multiple scenes than a single event.

---

## Authoring template

A v1 event scene should look like this in [index.html](index.html):

```js
function sceneShoemakerLevy() {
  zero();
  let i = 0;

  // Jupiter — the gravitational anchor
  setBody(i++, 0, 0, 0, 1.5e6, 0, 0, 0, KIND_BLACK_HOLE);

  // Fragments — disrupted chain on intercept
  for (let f = 0; f < 21; f++) {
    const offset = (f - 10) * 0.18; // pearl-string spacing
    const x = 12 + offset,
      y = 0.4 * offset;
    const vx = -3.2,
      vy = 0; // radial plunge
    setBody(i++, x, y, 0, 1.0, vx, vy, 0, KIND_PLANET);
  }

  // Jovian halo dust — for the impact flashes to disturb
  for (; i < MAX_BODIES; i++) {
    // ... ring-distributed dust around Jupiter
  }
}

SCENES["shoemaker-levy"] = {
  name: "Shoemaker-Levy 9",
  caption: "Twenty-one fragments fall toward Jupiter, July 1994",
  make: sceneShoemakerLevy,
  camera: { pos: [0, 4, 22], tgt: [0, 0, 0], fov: 50 },
  palette: "ember",
  channel: "speed",
  post: {
    bloom: 1.6,
    exposure: 0.95,
    ca: 0.4,
    vignette: 0.55,
    grain: 0.05,
    trail: 0.92,
  },
  physics: { G: 1.0, softening: 0.05, dt: 0.0035, speed: 1.0 },
  K: "neutral",
  flock: 0.0,
  radiation: 0.4, // each impact flares
  bhHighlight: 0.2,
};
```

Two things to note:

1. **The dramatic moment is encoded in geometry** — the pearl-string of fragments and their shared inbound velocity. We don't _script_ the impacts. They happen because the fragments hit the gravity well one after another.
2. **Caption is the only narrative device.** No on-screen text, no countdown. The viewer reads the caption once when the scene begins, then watches physics.

This is the discipline. If you can't fit the event into geometry + caption, it's not the right event for this engine yet.

---

## Cross-scene events (when one scene isn't enough)

Some events are arcs, not moments. The director already handles arcs via [CINEMATIC_MODES.md](docs/reference/CINEMATIC_MODES.md). An event arc would be a curated sequence:

> **Voyager Suite** (~25 min)
>
> 1. _Launch_ — Earth + Sun, spacecraft on departure trajectory (3 min)
> 2. _Jupiter encounter_ — gas giant + spacecraft slingshot (5 min)
> 3. _Saturn encounter_ — rings + spacecraft + Cassini-like thread (6 min)
> 4. _Outer system_ — Uranus, Neptune, distant scale (5 min)
> 5. _Heliopause_ — shrinking sun, growing emptiness (6 min)

Each scene is independent and physics-only. The _event_ is the director's choice to play them in order. This bypasses the "no per-frame scripting" limit entirely.

This pattern composes well: any major event can become a 3–6 scene suite. The Crab supernova suite. The Andromeda merger suite. The Petrova / Hail Mary suite.

The director already supports flavour-filtered playlists; an "Event Suites" flavour would surface only these curated chains.

---

## Primitives worth adding (in priority order)

If even three of the candidate events feel worth shipping, these primitives unlock them all:

1. **`KIND_SPACECRAFT`** — passive body, gravity-affected, mass ≈ 0, narrow point-sprite. _Unlocks: Voyager, Apollo, Cassini, Petrova ship sighting._ ~30 LoC.
2. **`buildShell(N, r, v_homol)`** — homologous expanding spherical shell. _Unlocks: Crab, GW170817 ejecta, kilonova._ ~50 LoC.
3. **`buildRingSystem(N, planet, bands, gaps)`** — banded rings with structured radii. _Unlocks: Cassini, Saturn, ringed-planet visuals._ ~80 LoC.
4. **Planar attractor force** — strong z→0 acceleration, scene-toggled. _Unlocks: Death's End foil, dimensional collapse motifs._ ~40 LoC kernel branch.
5. **Per-body thrust term** (already proposed in PETROVA*LINE) — `vec3 thrust(kind, pos, t)`. \_Unlocks: Petrova astrophage, any "directed swarm" event.* Shared cost.

None of these break the init-only contract. They all extend the _vocabulary of initial conditions and standing forces_.

---

## Decisions

Three early calls that shape how event scenes integrate with the rest of the engine. None require new engine primitives — each is a tag on the scene metadata plus a small handler somewhere in the director or UI.

### Attribution mode — yes

Each event scene carries an attribution string with more detail than the caption: full event name, date or epoch, specific moment if applicable. On scene-init, a transient overlay surfaces the attribution for ~6–8 seconds, then fades. The caption stays for the duration; the attribution is the one-time-on-arrival weight that says _this is a specific moment, here is its provenance_.

```js
// addition to scene metadata
attribution: {
  text: "Comet Shoemaker-Levy 9, fragment R impact · 21 July 1994 · 07:32 UT",
  source: null,        // null for real events; book/film/author for fictional
}
```

For fictional events, the source field carries the citation:

```js
attribution: {
  text: "Petrova Line · astrophage migration · Tau Ceti system",
  source: "Project Hail Mary, Andy Weir, 2021",
}
```

Parity is the right principle. Real and fictional events both get attribution; the difference is what fills the source line. This avoids the awkwardness of "real events deserve more weight" — they don't, the design just acknowledges that fiction is also worth citing.

The overlay sits below the existing caption strip, smaller font, dimmer, fades on a 1.5s ramp after its dwell. ~40 LoC of UI work.

### Filterable in the scene browser — yes

Each event scene tags itself with a `provenance` field:

```js
provenance: "real" | "fictional";
```

Non-event scenes (the existing 16 archetypes) leave it unset. The scene browser gains a three-state toggle — `Real / Fictional / Both` — that filters event scenes by provenance. Non-event scenes always show, so the toggle never hides the engine's existing surface.

The same field can drive a director playlist filter: a "Real Events" flavour and a "Fictional Events" flavour, surfacing only the matching subset. ~30 LoC for the browser toggle, ~10 LoC for each new flavour.

### Director treats events differently — yes

Three rules, applied to any scene tagged `composition: "event"`:

1. **Longer dwells.** 1.5× the flavour's baseline dwell, with a floor of 4 minutes. The viewer needs time to read the attribution, settle, and watch the geometry play out.
2. **Calm follow-on.** The transition out of an event prefers a low-energy scene (`quiet-drift`, `lattice`, `dust`) over another high-energy one. No event-into-collision; no event-into-event. The post-event silence carries weight.
3. **Anti-repeat between events.** No two event scenes within 30 minutes of each other. They are by definition the engine's most narratively-loaded surface; spacing them out preserves their gravity.

Implementation: existing `recentScenes` window plus a `composition` field check in the next-scene picker. ~25 LoC.

The Andromeda Merger scene already embodies these rules — see [ANDROMEDA_MERGER.md §5](ANDROMEDA_MERGER.md). Once the rules are generalized, every future event scene gets them by tagging itself.

---

## Open questions

- **Where's the line between "event" and "place"?** Sgr A\* is a place (the Event Horizon scene). The kilonova GW170817 is an event. The Petrova Line is somewhere in between (a recurring phenomenon, not a one-off). Worth a taxonomy pass before authoring scenes 3 or 4 — the `provenance` and `composition` tags above carry the system that the taxonomy will eventually formalize, so getting the categories right early is cheap, and getting them wrong is also cheap to migrate. Resolve before the first event scene that _isn't_ clearly one or the other ships.
- **Consent and tone for tragic events.** Tunguska, K-Pg impact, Tycho's supernova — these were either devastating or witnessed by humans as omens. The engine's "indifferent universe" tone may not be the right register for _every_ real event. Pick events that read as awe, not mourning. **TBD.** The candidates currently on the [shortlist](#shortlist-if-we-pick-this-up) (Andromeda, Voyager, Crab, Petrova) all lean toward awe; revisit before adding any event from the "wrong side."

---

## Shortlist (if we pick this up)

A minimum first cut to validate the posture:

1. **Andromeda–Milky Way** — re-tune the existing Collision scene with real orbital geometry and a real-event caption. Zero new primitives. Half a day.
2. **Voyager Grand Tour** — adds `KIND_SPACECRAFT`. Worth the lift; same primitive Petrova needs. One day plus tuning.
3. **Petrova Line** — already specced and shortlisted in [PETROVA_LINE.md](docs/active/PETROVA_LINE.md). Three days.
4. **Crab supernova** — adds `buildShell`. Second day after Voyager. Pairs naturally with the Event Horizon scene as a "death of stars" suite.

Four scenes, two new primitives, ~6 days of work. After that, the question becomes whether event scenes pull their weight against more archetype scenes — and we'll have enough to judge.
