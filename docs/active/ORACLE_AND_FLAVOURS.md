# Oracle & flavour rotation — design exploration

Two related problems showed up while watching the cinematic for a long
session:

1. The **flavour rotation is stuck**. The cinematic settles into Oracle
   and never advances to drift / pulse / long-shadow again.
2. **Oracle's "follow" act feels unfinished.** It picks a body, chases
   it for a while, then just lingers near the release point. The thing
   the body actually _did_ — the curve it carved through the scene —
   never gets shown.

This doc is exploratory. The diagnosis for (1), a proposed re-shape for
(2), how the two interact, and a v1 shortlist. Not decided.

---

## 1. The pitch in one paragraph

Oracle should be the slow flavour: pick one bright body, lock the
camera onto it for **3–6 minutes**, and during that whole time record a
glowing trail of where it has been. When the lock releases, the camera
does **not** stay near the body — it pulls back, frames the entire
trail as a static curve in the field, and orbits it for ~30–60 seconds
so the viewer sees the path the body authored. Only then does the
flavour rotation tick over to the next flavour. The act has three
movements: **lock**, **release**, **reveal**. Today only the first two
are implemented, and the rotation never advances anyway.

If drift is "weather" and pulse is "heartbeat", Oracle is _"a body
draws a line, then we read the line."_

---

## 2. What we have today

Findings from a code read of [index.html](../../index.html):

- **Flavours** are defined at `index.html:12639–12768`. Four entries:
  `drift`, `pulse`, `long-shadow`, `oracle`. Rotation order at
  `index.html:12769`.
- **Oracle params** (`index.html:12724–12767`):
  - `dwellS`: 600–900s (10–15 min per scene)
  - `followDurationS`: 180–300s (3–5 min follow each body)
  - `followLingerS`: 120–180s (linger at release point 2–3 min)
  - `sceneFilter`: only event-tagged scenes
- **Rotation tick**: `tickFlavourRotate(now)` at `index.html:13665–13672`,
  called every frame (`13406`). Swaps flavour every `ROTATE_PERIOD_MS`
  (30 min, `12855`).
- **Manual flavour pick** (`index.html:13635`): `setCinematicFlavour()`
  calls `setRotateMode(false)` — once the user (or any code path)
  manually picks a flavour, **rotation is disabled and never
  re-enabled**. This is the strongest candidate for the bug.
- **Follow move** (`index.html:13932–13965`): `pickFollowTarget()`
  selects a bright body, chases it for `followDurationS`, then lingers
  near release for `followLingerS`. No camera pull-back, no trail
  reveal.
- **Trail rendering already exists**: `starTrail` object + `trailsPass`
  (AfterimagePass at `index.html:6122`), `params.trail` slider
  (`9712–9716`), `startTrail()` / `stopTrail()` (called near `11902`,
  `11922`). The plumbing for "record a body's path and freeze it" is
  already in the engine — used elsewhere for the user-visible trails
  slider.

So the engine already has the ingredients. The work is wiring them
into Oracle's act structure, plus fixing the rotation latch.

---

## 3. The rotation bug — diagnosis

**Hypothesis A (most likely):** something is calling
`setCinematicFlavour('oracle')` programmatically at startup or scene
init, which flips `rotateMode` off (`13635`) and there is no path that
flips it back on. From then on, `tickFlavourRotate` early-exits on the
`!rotateMode` guard and rotation never fires.

Things to grep for to confirm:

- All call sites of `setCinematicFlavour(` — is one of them firing on a
  code path that should _not_ disable rotation? (e.g. scene transitions,
  intro completion, deep-link / URL param handling)
- Whether `setRotateMode` is ever called with `true` outside of
  user-initiated UI

**Hypothesis B (secondary):** `director.rotateAt` is initialised to
`now + ROTATE_PERIOD_MS` but `now` is sourced from a clock that resets
or drifts — e.g. perf timer reset on visibility change, or persisted
timestamp restored from localStorage. Less likely but worth checking
the init path of `rotateAt`.

**Fix shape (regardless of A/B):**

- `setCinematicFlavour` should take an explicit `{ source: 'user' | 'system' }`
  argument. Only `user` disables rotation. System-initiated picks (scene
  init, intro end, deep-link) should leave `rotateMode` alone.
- Add a small debug overlay line: `flavour: oracle (rotates in 4m32s)` —
  surfaces both what's playing and whether rotation is armed. If it
  shows "rotation off" and the user didn't disable it, the bug is
  obvious next time.

---

## 4. The Oracle redesign — three movements

### Movement 1: Lock (3–6 min)

Pick the brightest body in a stable orbit (existing `pickFollowTarget`
is a fine starting point). Chase-cam locks on. **Start `starTrail`
recording on this body specifically**, with a long persistence
(currently the global `params.trail` is user-controlled — Oracle should
push it temporarily to ~0.85–0.95 so the trail accumulates rather than
fading).

The duration is a single value: pick once at lock-on from
`U(180s, 360s)` — i.e. 3–6 min, matching the user's ask. Note: the
current code uses 3–5 min; widening to 3–6 min costs nothing and gives
a touch more variance.

### Movement 2: Release (≤2s)

End of lock. Stop chase-cam. **Freeze the trail** (`stopTrail`-style:
keep the geometry on screen, stop appending new samples). The body
keeps moving but the trail no longer follows it — it's a static curve
in space now, marking where the body _was_.

### Movement 3: Reveal (30–60s)

Camera pulls back along the negative-of-mean-trail-normal so the whole
arc is in frame. Aim point: centroid of the trail samples. Distance:
auto-fit so the trail spans ~60% of the frame's narrow axis. Then a
slow orbit around the trail centroid, ~30–60s, so the viewer sees the
path from multiple angles. The body itself may still be on screen and
moving — that's fine, even nice; it shows _the line was real_.

After the reveal completes, **Oracle's act is done**: clear the trail
(or fade it over ~5s), unlock all the camera overrides, and let
`tickFlavourRotate` advance to the next flavour. The 30-min global
rotation doesn't have to wait — Oracle's own act-end is a natural swap
point.

This shrinks Oracle's total dwell from "10–15 min" to roughly
"4–8 min" (lock + release + reveal). That's a feature, not a bug —
flavour rotation gets healthier and Oracle stops dominating the
session.

---

## 5. Edge cases

- **Body dies during lock.** If the followed body merges or gets
  ejected from the simulation mid-lock, snap to release immediately
  and play reveal anyway — the trail up to the death is still
  interesting, often _more_ interesting (the path of a body that no
  longer exists).
- **Trail too short / boring.** If the body barely moved (low-energy
  orbit), the reveal frame ends up tight and dull. Add a min-arc-length
  check at release: if total trail length < some threshold, skip the
  reveal and just rotate immediately.
- **Trail self-occluded.** A body in a tight closed orbit produces a
  loop, not an arc. The orbit-around-centroid camera handles this
  fine — the loop reads as a ring from off-axis.
- **User takes manual camera control during lock.** Existing director
  smooth-takeover should already handle this; on takeover, abort
  Oracle's act and rotate.
- **Multiple followed bodies?** v1: one body per Oracle act. v2 maybe:
  Oracle could chain — lock A, reveal A's trail, _then_ pick B in the
  same flavour cycle. Don't over-build.

---

## 6. Crossover with the rotation fix

These two are independent fixes but they reinforce each other:

- Fix the rotation latch alone → Oracle still feels unfinished, but at
  least we see the other flavours.
- Implement the reveal alone → Oracle becomes self-completing, which
  means even if rotation _does_ stick, each Oracle cycle ends cleanly
  and naturally cues a "now show me something else" feeling.

Doing both means Oracle has a real shape **and** the cinematic breathes
through all four flavours over a long session. That's the goal.

---

## 7. Shortlist for v1

In order:

1. **Audit `setCinematicFlavour` call sites** — find the system-initiated
   pick that's latching `rotateMode` off. Add the `{ source }` argument
   and only let `'user'` disable rotation. _(Half a day.)_
2. **Add the debug overlay line** showing flavour + time-until-rotate.
   Cheap insurance against this regressing. _(Hour.)_
3. **Wire trail recording into Oracle's lock** — start on lock-on, freeze
   on release, fade on reveal-end. Reuse `starTrail` / `trailsPass`. _(Day.)_
4. **Implement the reveal camera move** — pull-back-and-orbit, framed
   on the trail centroid. Probably a new `cinematicMove` entry that
   Oracle can call after release. _(Day.)_
5. **Tune the durations** — lock 3–6 min, reveal 30–60s, post-reveal
   trail fade ~5s. Run a long session and see if Oracle now feels like
   a complete act. _(Half a day of just watching.)_

Stretch:

- v2 chain mode (lock A → reveal A → lock B → reveal B) within one
  Oracle cycle.
- Oracle-aware scene picking: prefer scenes where at least one body has
  a high-contrast trajectory (high speed, or eccentric orbit). The
  current `sceneFilter: event` is a coarse proxy; trajectory-energy is
  a more direct signal.

---

## 8. Open questions

- Does `starTrail` support per-body recording today, or only one
  body globally? If global only, there's a small refactor to scope
  it to the followed body and not collide with the user's
  `params.trail` UI setting.
- Should the reveal camera be diegetic (a smooth move from the chase
  position outward) or hard-cut to the wide framing? Diegetic feels
  right for the rest of the project — every other camera move is a
  smooth blend — but a hard cut would emphasise "the act is over,
  look at what was made." Test both.
- Is Oracle the only flavour that should grow this kind of trail
  reveal, or is it a primitive other flavours could borrow? E.g.
  long-shadow could do a dimmer, slower trail; pulse never. Probably
  Oracle-exclusive in v1; revisit after it's working.
