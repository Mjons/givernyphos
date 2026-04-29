# Event Horizon Transit — implementation plan

Concrete plan for the **follow-cam-triggered, all-visual** transit
described in [EVENT_HORIZON_TRANSIT.md](EVENT_HORIZON_TRANSIT.md).

Decisions locked in from the exploration:

- **Interpretation A** — camera-only fakery. No body teleportation, no
  white-hole companion scene. The simulation underneath is a normal
  cinematic scene swap.
- **Trigger:** the user must be following a body that crosses the
  threshold radius in `event-horizon`. Director never fires it on
  its own.
- **Toggle-able mode:** off by default. When off, follow-cam
  in `event-horizon` behaves exactly as today (body crashes into the
  shadow, follow-cam releases). When on, the transit fires.

This doc covers the trigger, the mode toggle, the five-beat sequence,
edge cases, and the implementation order.

---

## 1. The mode toggle

### 1.1 Where it lives

A single boolean on the existing `followCam` object at
[index.html:8423](index.html#L8423):

```js
const followCam = {
  enabled: true,
  transitMode: false, // NEW — off by default; user opts in
  // ... rest unchanged
};
```

Persisted to `localStorage` as `phos.followCam.transitMode`.
Rehydrated on boot next to the rest of the settings.

### 1.2 How the user toggles it

Two surfaces, same boolean:

- **Hotkey:** `h` toggles transit mode and shows a brief toast
  ("Horizon transit: on" / "off"). `h` is currently free per the
  README hotkey table.
- **UI:** a checkbox in the existing follow-cam panel (the `prev /
next / release` controls already at
  [index.html:6638](index.html#L6638) onward). Label: _"Horizon
  transit"_. Tooltip: _"When following a body that falls into a black
  hole, the camera plunges through the event horizon and emerges in
  another scene."_

### 1.3 What it gates

When `transitMode === false`, no transit logic runs. The follow-cam
behaves exactly as today: a doomed disk body grazes the shadow,
density falls below the cull threshold, follow-cam releases, scene
continues. **No regressions for the default user.**

When `transitMode === true`, the trigger described in §2 is armed —
but only inside `event-horizon`. Other scenes are unaffected.

---

## 2. The trigger

### 2.1 Detection

Once per frame, after the follow-cam readback already fills
`followCam._pbuf` with the followed body's position
([index.html:7993](index.html#L7993)):

```js
if (
  followCam.transitMode &&
  scene.key === "event-horizon" &&
  followCam.state === "FOLLOWING" &&
  transit.state === "IDLE"
) {
  const r = Math.hypot(
    followCam._pbuf[0],
    followCam._pbuf[1],
    followCam._pbuf[2],
  );
  if (r < TRIGGER_RADIUS) cineBeginTransit(followCam.bodyIndex);
}
```

`TRIGGER_RADIUS = 28.0` — slightly outside `rInner = 24` from
[index.html:4087](index.html#L4087), so the transit starts while the
body is _still bright on the disk_, not after it has dimmed past the
ISCO. Lead time matters; we need ~5 seconds before the body actually
crosses.

### 2.2 Body filter

Don't fire if the followed body is a jet. Jets escape outward; their
"plunge" is misleading. Kind is encoded in `velA.w` (see
[index.html:4191](index.html#L4191) — jet kind is 0; disk kind is also
0 for most bodies, kind 3 for outer dust). Practically the cleanest
filter is **position-based, not kind-based**: only fire when the body
is moving _inward_ (`dot(pos, vel) < 0`) and below `|y| < 40`
(excludes the jet axis).

### 2.3 One-shot per visit

Set `transit.armed = false` on `cineBeginTransit`. Re-arm only when
the scene changes back into `event-horizon` from somewhere else. A
user can't trigger two transits in one visit even if they re-attach
follow-cam to another doomed body. Keeps the moment rare.

### 2.4 The "never plunges" problem

Most disk bodies are on stable sub-Keplerian orbits that drift inward
by ~0.5%/orbit. Some users might follow a body for ten minutes and
never see it cross. Two mitigations:

- **Physical:** when `transitMode === true` and the followed body is
  in the disk, _gently_ bias its `vRad` inward by ~0.05% per frame
  (a one-line tweak to the velocity uniform, applied only to
  `followCam.bodyIndex` via a new `uHintedBody` uniform on the velocity
  shader). Reaches the trigger radius in ~90s instead of ~10min.
- **UI:** show a HUD line _"transit armed — body falling"_ once the
  body's radius is `< 1.5 × rInner`. The user knows it's coming.

The physical bias is the load-bearing piece. Without it, the feature
fires too rarely to feel intentional.

---

## 3. The five-beat sequence (anchored to the followed body)

Same beats as [EVENT_HORIZON_TRANSIT.md §3](EVENT_HORIZON_TRANSIT.md),
re-anchored. The camera is already orbiting the followed body — every
target is in _the body's_ frame, not the BH's.

```
APPROACH (5s)   →  PLUNGE (4s)  →  THROAT (1.5s)  →  EMERGENCE (3.5s)  →  SETTLE (4s)
                                  │
                                  └── scene swap fires here
```

### 3.1 APPROACH (5s)

Follow-cam's normal behaviour, slightly accelerated. The orbit
distance (`followCam.endCam` distance to `_bodyPos`) decays from
its current value toward 8 units. FOV: `34 → 18`. `lens.strength: 1.0
→ 1.4`.

The body is now visibly accelerating toward the BH. Camera is
locked on it. Audience knows what's happening.

### 3.2 PLUNGE (4s)

The followed body's position passes through `r < r_shadow`. Camera
no longer reads the body's actual position (it would jitter into a
NaN-filled cull region) — instead the camera linearly extrapolates
"where the body would have been" along its last-known velocity.

Lens explodes: `strength: 1.4 → 8.0`, `einstein: 0.085 → 0.17`.
FOV: `18 → 8`. CA: `0.32 → 0.85`. Trail: freeze to `0.985`. Audio
LPF: `22000 → 800`.

### 3.3 THROAT (1.5s)

Single inverted-frame flash on entry. For 1.5s the framebuffer is
inverted (`postPass.invert = true`). At t = 1.0s into THROAT, scene
swap fires (`switchScene(destinationKey)` — see §4). When the next
frame renders, we're in the destination scene with an inverted
framebuffer for half a beat, then back to normal.

### 3.4 EMERGENCE (3.5s)

We're now in (e.g.) `birth` or `stephans-quintet`. The director's
post-FX baseline is _not_ applied yet — instead the lens is held at
`strength: 8.0, einstein: -0.17` (negative = repulsive) and decays
to 0 over 3.5s. FOV blooms `8 → destination.fov`. Camera origin is
the destination scene's centre-of-mass; the orbit kicks outward.

The user is no longer following any body. `followCamRelease("transit
emerged")` was called during THROAT. They're free to click another
body in the new scene if they want.

### 3.5 SETTLE (4s)

Hand off to the director's normal DWELL. Reset post-FX to the
destination's baseline. Audio LPF reopens to 22kHz. The transit is
over.

---

## 4. Destination scene selection

Three candidates, picked uniformly at random:

```js
const TRANSIT_DESTINATIONS = ["stephans-quintet", "birth", "bullet-cluster"];
const next =
  TRANSIT_DESTINATIONS[Math.floor(Math.random() * TRANSIT_DESTINATIONS.length)];
```

All three radiate outward from a centre — the EMERGENCE beat reads
correctly in any of them. The destination is recorded in the
director's `recentScenes` window so the next normal scene pick is
constrained as usual.

If the director was mid-cinematic, this overrides its currently
planned next scene. The director picks up from SETTLE without
complaint — its state machine treats the swap as a normal transition
that already happened.

---

## 5. Edge cases

### 5.1 User releases follow-cam mid-transit

User presses `Esc` or clicks empty space during APPROACH or PLUNGE.
The transit is committed at `cineBeginTransit` — it does not abort
on follow-cam release. The camera stays locked through THROAT and
EMERGENCE. Rationale: the transit is a 18-second cinematic event;
letting the user interrupt it produces a weird half-state.

`Esc` during SETTLE does what it normally does — break out of any
director state.

### 5.2 Density tier changes mid-transit

Forbidden. Density-change UI is dimmed while
`transit.state !== "IDLE"`. If a queued density change exists,
defer it to SETTLE end. (The follow-cam buffer logic is sensitive
to `TEX_SIZE` — changing it mid-transit would invalidate
`followCam._pickBuf`.)

### 5.3 Scene change fires from somewhere else

Director normally never fires during follow-cam (scene transitions
release follow-cam — see [index.html:8434](index.html#L8434)). But
if a manual `s` keypress happens during APPROACH, _abort the transit_
and let the manual scene change proceed. Restore baseline post-FX,
release follow-cam, no inversion.

### 5.4 The trigger fires for a jet body

Already handled by §2.2's position filter (jet bodies fail the
`|y| < 40` check). Belt-and-suspenders: in `cineBeginTransit`,
re-check the body's last known velocity. If `vy / |v| > 0.7` (mostly
axial), abort silently — log to the rolling telemetry from
[CINEMATIC_MODES.md §13](CINEMATIC_MODES.md).

### 5.5 The user toggled mode off mid-fall

Read `followCam.transitMode` only at trigger time. Once the transit
starts, it commits. Toggling off during APPROACH does nothing. (Same
rationale as §5.1.)

---

## 6. Implementation order

Each step is small and independently verifiable.

### Step 1 — mode toggle scaffold (~40 LoC)

- Add `transitMode` to `followCam` object.
- Add `localStorage` rehydrate at boot, persist on toggle.
- Add `h` hotkey handler in the existing keydown switch (same place
  as `c / s / r` at [index.html:5644](index.html#L5644) area).
- Add the toast.

**Verify:** press `h`, see toast, refresh page, toast on toggle still
works (state persisted).

### Step 2 — follow-cam UI checkbox (~25 LoC)

- Add a checkbox to the follow-cam panel near the `prev/next/release`
  cluster ([index.html:6638](index.html#L6638)).
- Two-way bind: checkbox ↔ `followCam.transitMode` ↔ localStorage.

**Verify:** clicking the checkbox is identical to pressing `h`.

### Step 3 — trigger detection only (~30 LoC, no transit yet)

- Add the `transit` state object: `{ state: "IDLE", armed: true,
destination: null, t: 0 }`.
- Detection runs every frame after the follow-cam readback.
- On trigger, log `"transit armed → would begin"` and re-disarm.
- Add the inward-bias uniform path on the followed body (§2.4).

**Verify:** follow a disk body in `event-horizon` with mode on, watch
the log. After ~90s of follow-cam, the trigger fires once. Body
visibly drifts inward faster than normal.

### Step 4 — APPROACH beat (~50 LoC)

- Implement `cineRunHorizonTransit_APPROACH(t)`.
- Drives FOV, camera distance, `lens.strength` per the curve in §3.1.
- Hands off to a stub `_PLUNGE` which just calls `restoreBaseline()`.

**Verify:** trigger fires, FOV crashes, camera tightens, then falls
back. No scene change yet.

### Step 5 — PLUNGE + THROAT + scene swap (~100 LoC)

- Camera extrapolation past r_shadow (§3.2).
- Lens / CA / FOV / trail amplitude curves.
- Inverted-framebuffer postPass flag for THROAT.
- `switchScene(pickDestination())` at THROAT t=1.0s.
- `followCamRelease("transit emerged")` on the same frame.

**Verify:** the full transit fires, the framebuffer inverts for half
a beat, and we land in a destination scene. Visual sanity: not a
glitch, looks intentional.

### Step 6 — EMERGENCE + SETTLE (~60 LoC)

- Hold lens at repulsive amplitude in destination, decay over 3.5s.
- FOV bloom from 8° to destination's natural FOV.
- SETTLE hands off to director DWELL with the destination's baseline
  post-FX.

**Verify:** full 18s arc reads as a single intentional movement.

### Step 7 — audio LPF ramp (~25 LoC)

- `BiquadFilterNode` inserted into the existing audio graph.
- Ramps per the schedule in §3.

**Verify:** transit audibly muffles at THROAT, reopens at SETTLE.

### Step 8 — edge cases & guards (~50 LoC)

- §5.1–5.5 handled.
- Density-change defer.
- Manual scene-change abort path.
- Jet-body re-check.

### Step 9 — rehearsal mode (~20 LoC)

- `?rehearse=transit` URL param.
- Forces follow-cam onto the brightest disk body, applies a 50×
  inward bias, runs the transit at 4× speed.
- Without this, tuning the amplitude curves in steps 4–6 is a
  3-minute round-trip per attempt.

**Total: ~400 LoC, ~2.5 days.**

---

## 7. Success criteria

We call this done when **all** of these are true:

1. Default user (transit mode off) sees zero behavioural change.
2. With mode on, following a disk body in `event-horizon` reliably
   triggers the transit within ~2 minutes.
3. The transit reads as a single intentional 18-second shot, not as
   five glued-together effects.
4. The destination scene picks any of the three candidates uniformly,
   and EMERGENCE looks coherent in all three.
5. Toggling mode on/off, pressing `s` mid-transit, releasing
   follow-cam mid-transit, and `Esc` mid-transit all behave per §5
   without leaving the renderer in a broken post-FX state.
6. The rolling-telemetry log (from [CINEMATIC_MODES.md §13](CINEMATIC_MODES.md))
   has a `transit-fire` entry for each transit.

---

## 8. Open questions

- **Hotkey letter.** `h` was free in the README table — confirm it's
  not bound elsewhere in `index.html` before locking it in.
- **Inward bias as feature vs. cheat.** §2.4's velocity nudge is an
  on-purpose violation of physics so the trigger fires often enough
  to feel intentional. Tune the rate or skip the nudge entirely?
- **Should the user be able to pre-pick the destination?** A
  "next time" indicator like _"transit will emerge in: Birth"_? Or
  always random for surprise? My instinct: random.
- **Inverted framebuffer in THROAT vs. pure black.** Both work. The
  invert is more interesting but might read as a bug. Build both,
  A/B during step 5 verify.
- **Does the destination scene's music change on the swap?** The
  default behaviour swaps tracks per scene. During the transit
  this would crossfade audibly during THROAT, on top of the LPF
  sweep. Could be perfect or could be muddy. Test in step 7.

---

## 9. What I want signed off before step 1

- The mode-toggle UX (hotkey `h` + checkbox in the follow-cam panel).
- The §2.4 inward-bias decision (yes / no / lower rate).
- That `?rehearse=transit` (step 9) is fine to add — it's a debug
  surface but it's also a one-line change to a URL the public can
  hit.

If those land I can start step 1 (~40 LoC, fully reversible).
