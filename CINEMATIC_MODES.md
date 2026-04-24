# Cinematic Mode — robustness & depth

Notes on where the director lives today, what can go wrong, and where
the next wins are. Every suggestion ties to code so it's actionable,
not vapour.

## What exists today

Source: [index.html:8110-8570](index.html#L8110-L8570).

- **State machine** — `IDLE → DWELL → TRANSITION → DWELL`, ticked by
  `directorTick()` ([index.html:8465](index.html#L8465)).
- **Four flavours** (`drift`, `pulse`, `long-shadow`, `oracle`) — each
  a preset of dwell range, move/mood/accent cadences, scene filter,
  transition grammar, breathing amplitudes, transition-duration
  multiplier ([index.html:8132](index.html#L8132)).
- **Three paces** (`slow`, `normal`, `restless`) — scalar multiplier
  on dwell and accents.
- **Schedulers** — camera moves (`orbit/counter/pan/dolly/tilt/fov/hold`),
  mood cross-fades, physics accents. Independent cooldown clocks.
- **Breathing** — four sines (bloom, exposure, CA, FOV) modulating a
  captured baseline during DWELL; phase preserved across scenes so
  the "organism" feel doesn't reset ([index.html:8374](index.html#L8374)).
- **Anti-repeat** — 3-deep rolling windows for scene / palette /
  channel / collision-scenario.
- **Transition grammar** — `dissolve / pullback / pushin / flare`
  with two structural overrides: intimate→cosmic prefers `pullback`,
  cosmic→intimate prefers `pushin` ([index.html:8327](index.html#L8327)).
- **User-activity gate** — 8s idle threshold; moves pause when the
  human touches the canvas.

It's a real director. The gaps below are about making it survive a
24/7 stream and read more like a film editor than a playlist shuffler.

---

## Robustness (the actual "robust" ask)

### 1. Crash-recovery / state persistence

**Problem:** on a stream restart, everything resets. Rolling windows
empty, breathing phases re-randomise, dwell timers zero. First
post-restart minute often picks the same palette it just showed for
half an hour.

**Fix:** persist `director.recentScenes / recentPalettes /
recentChannels / recentCollisionScenarios / phases / flavour / pace`
to `localStorage` once per transition (not per frame — per-frame is
noise). On boot, rehydrate and resume in `IDLE`.

### 2. Transition watchdog

**Problem:** at [index.html:8495](index.html#L8495) the director sits
in `TRANSITION` until `transitionRaf` clears. If a scene's `init` or
GPU upload throws silently, the transition loop can die without ever
clearing the flag. Result: the director freezes forever.

**Fix:** stamp `director.stateTimer` against an expected-completion
deadline = `2 × opts.durationMs / 1000` seconds. If `stateTimer`
exceeds that while in TRANSITION, log, force `restoreBaseline()`, and
snap back to DWELL on the previous scene.

### 3. Framing sanity check before committing a move

**Problem:** `pickCameraMove()` picks an end pose from kinematics
alone. Nothing guarantees the end frame contains anything. A dolly
can finish pointed at dust 400 units away while the cluster is behind
the camera.

**Fix:** before the move locks in, project the scene's centre-of-mass
(or the top-N brightest bodies) into the proposed end pose's NDC
space. If fewer than ~30% of the key bodies fall inside a central
60% rect, reject and re-pick up to 3 times. Cheap: one matrix build,
one loop over ≤32 bodies.

### 4. Scene-energy gate on dwell

**Problem:** dwell length is flavour-constant. But Dust and Cluster
can reach a low-variance equilibrium well before the 16-minute drift
timer fires — the viewer sees a still image for eight minutes.

**Fix:** sample kinetic-energy variance over a ~20s window. If it
drops below a per-scene threshold _and_ we're past `0.4 ×
dwellDuration`, short-circuit to `cineBeginTransition()`. Add a
per-scene `minInterestVar` to `SCENES[x].cinematic`.

### 5. Visibility-aware director

**Problem:** when the Twitch OBS window gets occluded,
`requestAnimationFrame` throttles hard, but the director's
wall-clock timers (via `realDt` from rAF's dt) keep counting. On
occlusion→reveal you can snap through a dwell.

**Fix:** in `directorTick()`, clamp `realDt ≤ 0.25` always (already
true in many places in this repo but not here). Additionally, when
`document.visibilityState === "hidden"` skip mood / accent ticking —
nobody's watching and the GPU churn is waste.

### 6. Rolling-window size scales with SCENE_ORDER

**Problem:** the hardcoded `>3` cap at
[index.html:8267](index.html#L8267) was sized for the original 8
scenes. `SCENE_TAGS` now lists 16, so "no repeat in last 3" still
lets a palette come back after two scenes — tight.

**Fix:** `const HISTORY_DEPTH = Math.min(5, Math.floor(SCENE_ORDER.length / 3));`
and use it everywhere in `recordHistory` / `pickNextScene`.

---

## Directing quality (the "more cinematic" upgrades)

### 7. Audio-reactive beats

Single biggest lift. The 24/7 stream has forty-six bespoke tracks and
the director currently ignores them.

- Cheap version: FFT the current `<audio>` element (low-band RMS,
  spectral-flux peaks). Expose `audio.energy` and `audio.onset`. Use
  `onset` to bias mood/accent fire windows; use `energy` as a bloom
  breathing amp multiplier.
- Proper version: author per-track metadata JSON
  (`ssi_tracks/<name>.json` with `{ bpm, downbeats[], sections: [{t,
kind}] }`). Director reads sections at transition picking time and
  either (a) waits for the next downbeat before starting
  `cineBeginTransition()`, or (b) stretches/shortens transition
  duration to land on the next sectional boundary. Transitions that
  land on musical boundaries read as _edits_, not cross-fades.

### 8. Follow-cam as a move type

The engine supports click-to-follow a body. The director never uses
it. Add a `follow` move that picks a bright, long-lived body (not
one about to be ejected) and orbits around it for the move's
duration. Bias it heavily in `oracle` and on `collision` /
`event-horizon`. Add `follow` to the `moveHistory` anti-repeat.

### 9. Shot-pair grammar beyond intimate/cosmic

`pickTransitionFlavour` has exactly two structural overrides today.
Extend to named pairs — treat it as a small lookup table:

```js
const SHOT_GRAMMAR = {
  "accretion→event-horizon": { flavour: "pushin", durationMul: 0.8 },
  "collision→quiet-drift": { flavour: "pullback", durationMul: 1.3 },
  "orrery→sagittarius": { flavour: "pullback", durationMul: 1.5 },
  // ...
};
```

Falls back to the current flavour-weighted pick when no entry matches.
Gives you a place to hand-craft the five or six transitions that
really matter without re-architecting anything.

### 10. Coupled breathing clock

The four breathing sines at [index.html:8399](index.html#L8399) have
independent random phases. They occasionally align and produce a
constructive peak — a moment where bloom, exposure, CA and FOV all
swell together — which reads as a glitch, not a breath.

**Fix:** derive the four phases from one organism clock with fixed
offsets (0, π/3, 2π/3, π) so peaks are staggered by construction.
Still random per session, but never coincident.

### 11. "Wake" curve on user takeover return

Today: user grabs the mouse → director pauses → user idle 8s → moves
snap back on. It's a hard edge.

**Fix:** during the first 6s after `userActive` clears, scale move
amplitudes from 0 → 1 via a smooth curve. The director "wakes up"
rather than pouncing.

---

## Observability

### 12. Debug overlay

Hidden panel (`Shift+D`?) showing: flavour, pace, state, state-time,
dwell-remaining, last-3-scenes/palettes/channels, next planned move,
next mood, next accent, and a count of rejected picks. Tweaking
flavour ranges without this is guesswork.

### 13. Ring-buffer telemetry

Keep a rolling 200-event log of `{ ts, kind, payload }` where `kind`
∈ `transition | move-start | move-end | move-rejected | mood |
accent | watchdog-fire`. Dump to console on `Shift+Ctrl+D`. When a
stream looks wrong at 3am, this is the only artefact you have.

### 14. Rehearsal mode

A `?rehearse` URL param that runs a single flavour at 10× dwell /
transition speed so you can see a full cycle in 90 seconds. Makes
flavour tuning tractable; today tuning `long-shadow` means watching
for 30 minutes.

---

## Shortlist (where I'd start)

If the goal is _"robust enough to run 24/7 unattended"_:

1. **Transition watchdog** (§2) — single biggest stability win, ~20
   LoC.
2. **Crash-recovery persistence** (§1) — second biggest; stream
   restarts stop looking ugly.
3. **Framing sanity check** (§3) — kills the single most common
   visual failure (empty frames).
4. **Debug overlay** (§12) — not user-facing, but you'll want it the
   moment you start tuning anything else.
5. **Audio onset → accent/mood bias** (§7, cheap version) — biggest
   perceived quality jump for the least code.

Everything else can follow.
