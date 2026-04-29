# Breathing arcs — design exploration

Today the director picks one scene, dwells, transitions, picks
another. The shape of any given hour is "shuffle within flavour."
The user feedback: this reads as _jumping around_ rather than
_unfolding_. We want the night to breathe — to feel like one
continuous sigh-and-swell rather than a playlist.

This doc proposes an **arc** layer above the existing per-scene
director: a slow envelope (30–90 min) that groups scenes into a
single emotional shape, with soft transitions inside the arc and
grand transitions only at arc boundaries.

---

## 1. What "breathing unfolding" means concretely

Three concrete things, in priority order:

### A. Continuous energy

Today, scene A → B can be a hard step in implied energy
(`event-horizon` to `quiet-drift` is a 5-step drop in one
transition). Arcs constrain successive scenes to be **adjacent in
energy**: each step changes energy by at most ±1 on a 5-point
scale. Energy across an arc traces a single bell or wave; you
never get whiplash.

### B. Soft within, grand between

Transitions _inside_ an arc are slow & layered (45–90s dissolve,
matched palettes, camera continuity if cheap). Transitions
_between_ arcs are the rare "moment" — a 20-second pullback,
a flare, a new color world. Most of the night is the soft kind;
the punchy kind happens 8–12 times an evening.

### C. Macro parameter envelopes

Bloom, exposure, fog density, particle scale don't reset per
scene. They drift along the arc's shape — rising into the peak,
ebbing on the way out. The viewer sees scenes change but feels
one continuous breath underneath. The "organism" feel from the
existing breathing sines, scaled up to arc length.

If we get all three of these right, the experience reads as
_unfolding_. If we only get A right and not the others, it just
reads as "less jumpy" — better but not transformed.

---

## 2. The arc concept

```js
const ARCS = [
  {
    id: "evening-drift",
    durationMin: [45, 75], // total length range
    palette: "warm-low", // shared palette family
    energyCurve: "bell", // bell | wave | flat | sigh
    energyPeak: 3, // 1–5 scale
    sceneFilter: (sc) => sc.energy <= 4 && sc.tags.includes("quiet"),
    transitionStyle: "dissolve", // default within-arc transition
    musicTags: ["ambient", "drone"], // passed to track picker (later)
  },
  {
    id: "collision-suite",
    durationMin: [30, 50],
    palette: "high-contrast",
    energyCurve: "wave", // builds, dips, builds again
    energyPeak: 5,
    sceneFilter: (sc) => sc.tags.includes("collision") || sc.energy >= 4,
    transitionStyle: "pushin",
    musicTags: ["intense", "rhythmic"],
  },
  // ... ~6–10 arcs total
];
```

An **arc** is a duration, a shape, a palette, and a scene filter.
The director picks an arc, then picks scenes from inside it whose
energy traces the chosen curve. When the arc's duration elapses
(or its scene pool runs dry), pick the next arc — and _that_ is
the only "grand" transition.

### 2.1 Energy curves

Four shapes, each cheap to evaluate:

- **bell** — `sin(πt)` over arc length. Quiet → peak → quiet.
- **wave** — `sin(2πt)` plus a slow drift. Two peaks separated
  by a lull.
- **sigh** — `1 - exp(-t/0.3)` then linear decay. Climbs fast,
  releases slow.
- **flat** — constant. For arcs that just want a vibe (drone +
  dust for 40 min).

Each scene inside the arc has its own innate energy (1–5). When
we need to pick the next scene, we evaluate the curve at the
current arc time and pick the scene from the arc's pool whose
energy is closest to the curve's value, biased away from
recently-shown scenes (existing anti-repeat logic still applies).

### 2.2 Arc-to-arc adjacency

Not all arc transitions are equal. An "evening-drift" → "deep-cluster"
flow makes sense; "evening-drift" → "collision-suite" is
jarring. Define an arc adjacency table similar to the SHOT_GRAMMAR
sketch in [CINEMATIC_MODES.md §9](CINEMATIC_MODES.md):

```js
const ARC_GRAPH = {
  "evening-drift": ["deep-cluster", "lattice-meditation"],
  "deep-cluster": ["evening-drift", "collision-suite"],
  "collision-suite": ["aftermath-drift", "event-horizon-suite"],
  // ...
};
```

A directed graph. The next arc must be adjacent to the current
one. This _guarantees_ macro continuity — you never go from
"calm" to "crash" without a transitional arc. Weighted, with
infrequently-shown arcs upweighted to keep variety.

---

## 3. Transition policy

Two regimes, very different feel.

### 3.1 Within-arc transitions

- **Default flavour:** `dissolve` (the softest existing one).
- **Duration:** 45–90s (today's are 6–15s). Long enough that the
  viewer is conscious of the _change_, not the _cut_.
- **Camera:** continuous. If feasible, plan one long camera path
  across the transition; camera doesn't snap to a new pose at
  the moment of swap.
- **Palette:** unchanged within an arc. Palette is an arc-level
  property, not a scene-level one.
- **Bloom/exposure:** carry over without reset. Macro envelope
  governs them; the scene change is invisible to those values.

### 3.2 Between-arc transitions

- **Flavour:** picked from `pullback / pushin / flare`, biased by
  the arc-pair grammar.
- **Duration:** 15–25s. Short enough to feel like an _edit_, not
  a fade.
- **Camera:** can snap. The grand transition is an honest cut.
- **Palette:** changes. The new arc reveals its palette in the
  first second of the transition (LUT swap during pullback).
- **Audio:** overlap longer than visual; let the new arc's track
  start playing 5s before visual transition ends, fade old out
  underneath.

The viewer experiences ~95% of transitions as the soft kind. The
5% grand ones become _moments_. Right now the ratio is closer to
50/50 because every transition is structured the same way; arcs
make grand transitions rare and therefore meaningful.

---

## 4. Macro parameter envelopes

This is where "breathing" lives. Today, breathing is per-scene
sines on top of a captured baseline, all reset on transition. We
keep that, but add an **arc envelope** that modulates the same
parameters over the full arc length.

```
finalBloom = baseline * (1 + arcEnvelope(arcT) * arcAmp + sceneSine(sceneT) * sceneAmp)
```

Where `arcT` is normalised 0..1 across the arc and `arcEnvelope`
is the energy curve (bell / wave / sigh / flat) at that t.
`sceneSine` is the existing per-scene breathing.

`arcAmp` is small (~0.15), enough to feel without dominating.
The point isn't that bloom doubles at the peak; it's that bloom
_drifts_ through the arc and you can't quite tell when it changed.

Parameters that get arc envelopes (priority order):

1. **Bloom strength** — biggest perceived effect, cheapest.
2. **Exposure** — second biggest, but watch for clipping.
3. **Particle scale** — subtle but disorientingly good when the
   cluster slowly grows over 20 minutes.
4. **Fog / vignette density** — adds intimacy at low energy, room
   at high energy.

Parameters explicitly _not_ arc-modulated:

- **G / softening / flock / radiation** — physics constants;
  changing these mid-arc breaks particle behaviour.
- **Spin** — already a slider; user-tunable, leave alone.
- **Camera FOV** — too visible, reads as a zoom not a breath.

---

## 5. Camera continuity (the hard part)

In an unfolding world, the camera doesn't restart between scenes
within an arc. Today it does: scene swap → director picks a new
move → camera snaps to a new orbit angle / FOV.

True continuity is hard because particles are different per scene
(different layouts, different "good" framings). Three escape
hatches in increasing ambition:

### 5.1 Don't break the move

Cheapest. When a within-arc transition fires mid-move, _don't_
cancel the move. Let it complete. Just swap the underlying
scene's particles during the dissolve. The camera continues
along its path; the cluster underneath morphs.

This is probably 90% of the win. Failure mode: the camera arrives
at a frame designed for the old scene and the new scene has
nothing there. Mitigation: framing sanity check (§3 of
CINEMATIC*MODES.md) applied to \_both* old and new scenes before
the transition starts. If the planned end-pose works for both,
proceed; if not, pick a different transition timing.

### 5.2 Plan moves at the arc level

More ambitious. The arc plans a long camera trajectory at start
(45 min sweep, with key poses every 5–8 min). Scene-level moves
are interpolations between arc-level keyposes. Director can no
longer pick spontaneous moves; everything is precomputed.

Rich, but expensive to author and brittle. Defer.

### 5.3 Shared focal point across the arc

Compromise. The arc designates a _focal subject_ (e.g., the
scene's COM, or a tagged landmark body) and all moves within the
arc orbit/dolly around that point. Transitions don't reset focal
point; they just swap what's in the frame. The viewer feels like
the camera "stays with" something even as scenes change.

Cheap and effective. Probably the right v1.

---

## 6. Where this lives in code

The director state machine at [index.html:8465](index.html#L8465)
becomes a two-level state:

```
ARC_STATE  : IDLE → ENTERING → DWELLING → EXITING → IDLE
SCENE_STATE: IDLE → DWELL → TRANSITION → DWELL  (existing)
```

Arc state ticks on the order of minutes. Scene state ticks at the
existing rate. The arc state's `DWELLING` block is what the current
director already does — except scene picking is filtered through
the active arc, and transition flavour defaults to the arc's soft
style.

Most of the existing code stays. Additions:

- `ARCS` data structure ([new], near `SCENE_TAGS`).
- `ARC_GRAPH` adjacency.
- `arcDirector` object: `{ activeArc, arcStartTime, arcEnergyCurve, sceneHistory[] }`.
- `arcDirectorTick(now)` called from main loop alongside `directorTick`.
- `pickNextScene` updated to filter by `activeArc.sceneFilter` and
  pick by energy-curve proximity.
- `pickTransitionFlavour` updated: if within-arc, return arc's
  default; else use existing logic + ARC_GRAPH grammar.
- Per-frame: arc-envelope value computed from `(now - arcStartTime) / arcDurationMs`,
  applied to bloom/exposure/etc.

Total: ~200–300 lines of additions, almost no edits to existing
code (most of the new logic gates _before_ existing logic).

---

## 7. Music coupling (mention; defer)

Mentioned in [CINEMATIC_MODES.md §7](CINEMATIC_MODES.md). Arcs
make music coupling almost trivial:

- Each arc has `musicTags: ["ambient", "drone"]`.
- Track metadata (one-time hand-tag): each track gets `tags: [...]`.
- Music director picks the next track by intersection.
- Within an arc, tracks rotate; arc end = track end (fade music
  out under the grand transition).

But this is its own commit. Don't bundle. The arc structure
should work with the existing shuffle music and feel right. If
arcs only land 70% of the way without music, music coupling
finishes the job but isn't load-bearing.

---

## 8. Failure modes (honest)

### Monotony

If all 6 scenes in an arc share palette and energy ±1, an hour
in the same arc could be boring. Mitigation: the energy curve
provides variation (peak at 3 vs trough at 1 still feels different
even within "warm-low"); also, arcs cap at 75 min. If we feel
boredom in testing, shorten the cap.

### Unrecoverable arcs

What if scene-loading throws inside an arc? The arc's `sceneFilter`
might exclude all valid scenes after a few exclusions. Mitigation:
fallback chain — `arcSceneFilter → flavourSceneFilter → all`. Always
have a scene to pick.

### "Same arc twice in a row"

The graph adjacency prevents direct repeats _across_ arcs but
doesn't prevent the _kind_ of arc repeating. After an evening of
"warm-low" arcs, the night feels stale. Mitigation: arc-level
anti-repeat (last 3 arcs, like the existing scene-level anti-repeat).

### Telemetry blind spot

Right now the director outputs nothing. Adding arcs without
[CINEMATIC_MODES.md §12 / §13](CINEMATIC_MODES.md) means we'll
never know which arcs play, how often, in what sequence. **Build
the debug overlay first.** Otherwise we're flying blind.

### Tuning hell

6–10 arcs × scene filters × energy curves × adjacency × envelope
amps = many parameters. Tuning by gut is impossible. Solution:
[CINEMATIC_MODES.md §14 rehearsal mode](CINEMATIC_MODES.md), but
at the arc level — `?rehearse-arc=collision-suite` runs that arc
at 10× speed so a 45-min arc takes 4.5 min to evaluate.

---

## 9. Phased commits

### Phase 1 — Arc data structure + scene filtering (no envelopes yet)

- Define `ARCS` and `ARC_GRAPH`.
- Add `arcDirector` state, picks an arc on boot.
- `pickNextScene` filtered by active arc.
- Within-arc transitions default to `dissolve`, 60s.
- Between-arc transitions: existing logic, with one arc-pair
  override per direction in `ARC_GRAPH`.
- **Success:** open the page, watch for an hour. Scene order
  feels coherent — each cluster of scenes shares a vibe — but no
  visible "breath" yet.
- ~150 LoC. Reverts cleanly.

### Phase 2 — Macro envelopes

- Compute `arcT = (now - arcStartTime) / arcDurationMs`.
- Apply energy curve to bloom + exposure (start with these two).
- **Success:** within an arc, the visual character drifts. Same
  scene at minute 5 and minute 35 of an arc looks subtly
  different even with no scene change.
- ~50 LoC. Standalone.

### Phase 3 — Camera continuity (focal-point variant, §5.3)

- Each arc designates a focal subject (default: scene COM).
- Director's `pickCameraMove` uses the focal subject when within
  an arc.
- **Success:** transitions within the arc feel like pans rather
  than cuts. Watch a 15-min arc, no point should feel like the
  camera "started over."
- ~80 LoC.

### Phase 4 — Telemetry + rehearsal mode

- Debug overlay (Shift+D): current arc, arc time, energy curve
  value, next scene, history.
- Rehearsal mode: `?rehearse-arc=<id>` runs that arc 10× speed.
- ~60 LoC. Critical for tuning phases 1–3 in less than days.

### Phase 5 — (Optional) Music coupling

Per §7. Self-contained.

### Phase 6 — (Optional) Arc-level moves (§5.2)

The maximalist version. Probably never needed.

---

## 10. Smallest interesting version

Just phase 1 + phase 2: arcs + envelopes, no camera continuity,
no music. ~200 LoC, reverts cleanly. Should be enough to feel
the difference between "shuffle" and "unfolding" — if it's not,
phase 3 is the next lever.

If you wanted _only one phase_: phase 1 alone, with within-arc
transitions defaulting to a 60s dissolve. That alone removes the
"jumping" complaint. The breath comes from phase 2; the camera
glue from phase 3. But the "jumping" stops at phase 1.

---

## 11. What this is not

- **Not a story engine.** Arcs are emotional shapes, not
  narratives. There's no "act 1 / act 2 / act 3" with character
  arcs. It's all vibe.
- **Not a replacement for the existing director.** Flavours
  (`drift / pulse / long-shadow / oracle`) still exist; arcs
  layer above. A `drift`-flavoured arc and a `pulse`-flavoured
  arc behave differently within their respective arcs.
- **Not a per-track playlist.** Music remains independent
  unless §7 ships separately.
- **Not deterministic.** Two evenings should never feel
  identical. The arc graph + energy curve randomness ensure
  variation.

---

## 12. Recommendation

Start with **phase 1 alone**, ship it, watch a full evening.
That's the minimum experiment to confirm the "jumping" complaint
is solved. If that landed but the night still feels static,
phase 2 (envelopes) is the next lever. If the camera feels
incoherent, phase 3.

Telemetry (phase 4) is tempting to defer but probably worth
doing _before_ phase 1 — without it, tuning the arcs is
guesswork and the first evening of testing yields no useful
data. At minimum, log every transition + arc change to the
console with timestamps so we can review the night after.

The vibe goal is well-defined and the simplest fix (phase 1) is
small. Worth trying before more ambitious cinematography work.
