# Hand tracking — design exploration

A new input source: the user's webcam, processed by MediaPipe
HandLandmarker, feeding landmark data into the existing physics knobs so
hands subtly nudge the simulation. Camera in, attractor out. The goal is
**influence, not puppetry** — the system should feel like it's
responding to a presence, not being directly controlled.

This doc lays out the pipeline, the mapping choices (the actual hard
part), the integration surface, and a phased commit plan.

---

## 1. What "subtle manipulation" means

Three honest interpretations, ordered by ambition:

### A. Ambient presence (cheapest, ship first)

A single hand position becomes a soft, low-strength attractor that
drifts the cluster. Pinch (thumb-tip → index-tip distance) modulates
attractor strength. Nothing snaps; everything smooths over ~200 ms.
Looks like the camera viewer is breathing on a flock.

### B. Two-handed shaping

Both hands tracked. One hand attracts, the other repels — or pinch
distance between hands sets the spin rate (§3.5 of `SPIN_SLIDER_PLAN.md`).
Palm rotation maps to scene exposure or bloom intensity. Closer to a
musical instrument than a god-mode camera.

### C. Gesture vocabulary (out of scope for this plan)

Discrete gestures (fist, peace sign, open palm) trigger scene
transitions, mode swaps, or capture. Requires a gesture classifier on
top of landmarks and a state machine — separate feature, separate doc.

**Recommended path:** ship A first as one commit, see how it feels,
_then_ decide if B is worth the complexity. C waits.

---

## 2. The pipeline, end-to-end

```
   ┌──────────┐   ┌──────────────────┐   ┌──────────┐   ┌────────────┐
   │ <video>  │──▶│ HandLandmarker   │──▶│ One-Euro │──▶│ params.hand│
   │ getUM... │   │ detectForVideo() │   │ smoothing│   │ + uniform  │
   └──────────┘   └──────────────────┘   └──────────┘   └────────────┘
        │                  │                                   │
   30 fps capture    21 landmarks/hand                   each frame in
                     in normalized coords                 writeWgpuParams
```

### 2.1 Capture

A hidden `<video>` element fed by `navigator.mediaDevices.getUserMedia({
video: { width: 640, height: 480 }, audio: false })`. 640×480 is enough
for landmark accuracy; bigger just costs GPU time. No display — the
viewer never sees their own face.

### 2.2 Inference

MediaPipe Tasks Vision (`@mediapipe/tasks-vision`) loaded as an ESM
module from CDN — fits the project's "one HTML file, scripts via CDN"
posture (Three.js, Tone.js already do this). The `HandLandmarker`
returns 21 3D landmarks per hand in **normalized image coordinates**
(0..1 for x/y, depth-relative for z). We call `detectForVideo()` once
per `requestAnimationFrame`, _not_ on a separate timer — keeping it
sync'd to the render loop avoids extra wakeups.

Delegate: `GPU` (WebGL backend). The MediaPipe WebGPU delegate exists
but is experimental and would contend with our compute pipelines —
keep this on WebGL for now.

### 2.3 Smoothing

Raw landmarks jitter ±2-3 px frame to frame; pinch distance is
_especially_ noisy. Use a **one-euro filter** (de Casson & Roussel, 2012) on each scalar we feed downstream — it lets fast motion through
while killing tremor at rest. Tiny filter, ~10 lines of JS. Tuning:
`mincutoff=1.0, beta=0.01` is a good starting pair for hand tracking.

### 2.4 Mapping → physics

Smoothed landmarks update `params.hand` each frame; `writeWgpuParams()`
copies the relevant scalars/vectors into the WebGPU SimParams buffer
(extending the struct at [index.html:1555](index.html#L1555)).
The WebGL2 path mirrors via `velVar.material.uniforms`.

---

## 3. The mapping (the actual creative work)

This is where "subtle" lives or dies. Bad mappings feel like a broken
mouse driver. Good mappings feel like the scene noticed you walked in.

### 3.1 What we have to map _into_

From the params object at [index.html:6532](index.html#L6532) and the
WebGPU SimParams at [index.html:1555](index.html#L1555):

| Param                | Range (typical) | Visual effect                     |
| -------------------- | --------------- | --------------------------------- |
| `G`                  | 0.5 – 2.0       | overall gravitational strength    |
| `flock`              | 0.0 – 0.5       | local cohesion / alignment        |
| `radiation`          | 0.0 – 0.3       | outward pressure                  |
| `spin`               | -1.0 – 1.0      | rotational drive around COM       |
| (new) `handPos`      | vec3            | attractor position in world space |
| (new) `handStrength` | 0.0 – G         | attraction magnitude              |

### 3.2 Recommended mappings (ambient-presence variant)

- **Wrist landmark (index 0)** → `handPos`. Map normalized image (x, y) →
  world (x, y) via the camera's NDC frustum at `z = 0` plane, so the
  hand "lives" on the screen plane the viewer sees. Mirror x (selfie
  camera).
- **Pinch distance** (landmark 4 ↔ landmark 8, normalized by hand
  bounding box so it's scale-invariant) → `handStrength`. Pinch closed
  = strong attraction; open palm = zero. Mapped exponentially: `s =
k * exp(-α · d)` so closing a half-open pinch ramps up smoothly
  rather than linearly.
- **Hand presence** (landmarker confidence > 0.7 for ≥ 5 frames) →
  fade-in of strength over 500 ms. **Loss of presence** → fade-out over
  1500 ms. Asymmetric on/off avoids flicker when tracking briefly drops.

That's it. One position + one scalar + a presence envelope. Three
numbers driving the simulation. Anything more is two-handed-shaping
territory (§B).

### 3.3 What _not_ to map (yet)

- **Don't** map hand → camera position. Camera control is already busy
  (cinematic director, follow-cam, mouse drag). Adding a fourth driver
  fights the others.
- **Don't** map individual finger joints. 21 landmarks × 2 hands × 60 Hz
  is more bandwidth than the simulation can absorb without becoming
  twitchy. Reduce to summaries (pinch, palm normal, wrist).
- **Don't** map z-depth from MediaPipe in v1. Their depth is
  relative-to-wrist, not metric, and noisy. Keep input 2D until we
  prove the 2D version feels right.

---

## 4. The one-euro filter, concretely

```js
// One per scalar we want to smooth
function makeOneEuro(mincutoff = 1.0, beta = 0.01, dcutoff = 1.0) {
  let xPrev = null,
    dxPrev = 0,
    tPrev = null;
  const alpha = (cutoff, dt) => {
    const r = 2 * Math.PI * cutoff * dt;
    return r / (r + 1);
  };
  return (x, t) => {
    if (tPrev === null) {
      tPrev = t;
      xPrev = x;
      return x;
    }
    const dt = Math.max(1e-3, (t - tPrev) / 1000);
    const dx = (x - xPrev) / dt;
    const aD = alpha(dcutoff, dt);
    const dxHat = aD * dx + (1 - aD) * dxPrev;
    const cutoff = mincutoff + beta * Math.abs(dxHat);
    const a = alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * xPrev;
    tPrev = t;
    xPrev = xHat;
    dxPrev = dxHat;
    return xHat;
  };
}
```

Allocate three filters at boot: `handX`, `handY`, `pinch`. Feed the raw
landmark/distance through, read the smoothed value, write to params.
That's the entire smoothing layer.

---

## 5. Integration surface

(File:line refs are current as of the step-7b commit.)

### 5.1 Boot

A new async init function, called once after WebGPU detection finishes
(around [index.html:1515](index.html#L1515)). It:

1. Creates a hidden `<video>` element, sets `playsInline`,
   `autoplay`, `muted`, requests `getUserMedia`, awaits `loadeddata`.
2. Imports MediaPipe Tasks Vision via CDN ESM, awaits
   `FilesetResolver.forVisionTasks(...)` and `HandLandmarker.createFromOptions(...)`.
3. On failure (no camera, permission denied, MediaPipe load failed):
   logs once, sets `handTracker.disabled = true`, and returns silently.
   The simulation continues with zero hand input — this feature is
   strictly additive.

### 5.2 Per-frame read

Inside the existing `loop()` at [index.html:16213](index.html#L16213),
**before** the WebGPU/WebGL2 branch at [index.html:16226](index.html#L16226):

```js
if (handTracker.ready && !handTracker.disabled) {
  handTracker.tick(performance.now()); // detectForVideo + smoothing
  params.handPos.copy(handTracker.worldPos);
  params.handStrength = handTracker.strength;
}
```

`tick()` internally throttles: if the video element hasn't advanced a
frame since the last call (`video.currentTime` unchanged), it skips
detection. So at vsync = 60 fps and capture = 30 fps, we run inference
every other frame — free.

### 5.3 GPU upload

Extend `SimParams` at [index.html:1555](index.html#L1555):

```wgsl
struct SimParams {
  // ... existing 16 f32 + K array ...
  handX: f32, handY: f32, handZ: f32, handStrength: f32,
  K: array<f32, 49>,
};
```

This grows the buffer by 16 bytes (320B → 336B). Update the
`device.queue.writeBuffer(...)` length in `writeWgpuParams()` at
[index.html:2000](index.html#L2000). Also extend `_wgpuParamsScratch`
allocation.

### 5.4 GPU consumption

In the WGSL velocity-update kernel (search for `uG * d / r3` or similar
gravity term), add after the existing acceleration:

```wgsl
let toHand = vec3(p.handX, p.handY, p.handZ) - pos;
let r2 = max(dot(toHand, toHand), 0.04);
let r = sqrt(r2);
acc = acc + (p.handStrength / r2) * (toHand / r);
```

A 1/r² Newtonian pull — same shape as gravity, just with one virtual
attractor. At `handStrength = 0` it's algebraically zero, no branching
cost. Mirror the same addition in the WebGL2 fragment shader for
parity.

### 5.5 What does _not_ need to change

- Pointer handlers ([index.html:8965](index.html#L8965)): orthogonal,
  hand input is additive.
- Cinematic director, follow-cam, click-to-follow: untouched. The hand
  attractor is just another force in the existing accel sum.
- Scene factories: untouched. `params.handStrength = 0` when no hand
  is present means scenes behave identically when the camera is off.

---

## 6. Phased commits

Each phase ends in a clean, working state. Reverting any commit leaves
the project in a working state too.

### Phase 1 — Capture only (no sim impact yet)

- Add `<video>` element + `getUserMedia` boot.
- Add HandLandmarker init.
- Console-log smoothed wrist position + pinch every 30 frames.
- **Success:** open the page, grant camera, see numbers ticking in
  console that respond to your hand. Sim looks identical.

### Phase 2 — Wire to GPU (gravity-style attractor)

- Extend WGSL + GLSL SimParams structs.
- Extend `writeWgpuParams()`.
- Add the 1/r² term in the velocity kernel.
- Permanent low strength (0.05) just to confirm it works.
- **Success:** the cluster drifts toward a hardcoded screen-space
  point. Visible but gentle. Reverting this commit restores the prior
  look bit-for-bit.

### Phase 3 — Connect input to attractor

- Replace hardcoded position with smoothed wrist landmark.
- Replace constant strength with pinch-driven strength.
- Add presence-envelope fade.
- **Success:** wave a hand at the camera, the cluster gently leans
  toward it. Pinch closed, it pulls harder. Walk away, it fades out.

### Phase 4 — Polish (optional, gate on whether it feels right)

- Calibration UI: a small "show me my hand" overlay during a 3-second
  setup so the viewer knows tracking works.
- Per-scene strength override (some scenes — `pilgrim` act 3 — won't
  want any external force; others might want more).
- A toggle in the UI / URL param (`?hands=1`) to opt in.

---

## 7. Risks and open questions

- **Permission UX.** First load shows a camera prompt before the
  simulation even renders. Some viewers will close the tab. Mitigation:
  defer the `getUserMedia` call until first user click, or gate behind
  `?hands=1` opt-in. Recommended: **opt-in only for v1**, promote to
  default if it lands well.
- **GPU contention.** MediaPipe's WebGL delegate uses the same GL
  context family as our renderer. Inference at 30 fps adds ~3-5 ms per
  inference frame on a mid-range integrated GPU. At colossal density
  on integrated graphics, this could push frametime past 16 ms.
  Mitigation: detection at 15 fps (skip every other video frame) is
  usually fine for hand input.
- **Privacy.** Even a hidden `<video>` element holding a camera
  stream is something some viewers will not want. Document clearly in
  README that no frames are recorded, transmitted, or persisted. The
  inference is fully local. **Do not** add any analytics or telemetry
  on this code path, ever.
- **Tracking failures.** Black backgrounds, dim rooms, or out-of-frame
  hands all break tracking. The presence-envelope fade-out (§3.2)
  hides this, but for a presentation context where lighting is bad,
  the feature may simply not work. Acceptable failure mode: the sim
  still runs, the feature is silent.
- **Scenes that already feel "alive."** `pilgrim`, `event-horizon`,
  and the spin-driven scenes may not benefit from a third driver
  jostling them. We may need a per-scene `acceptsHandInput: false`
  flag. Defer until phase 3 reveals which scenes feel wrong.

---

## 8. What this is _not_

- Not a control scheme. The viewer cannot pause, navigate scenes, or
  trigger captures with their hands. That's the gesture-vocabulary
  feature (§1C), out of scope.
- Not a face/pose tracker. Just hands, just landmarks. Adding face or
  full-body tracking is a separate doc.
- Not a fallback for missing pointer input. Mouse, touch, and keyboard
  remain the primary inputs. Hands are atmosphere.

---

## 9. Recommendation

Ship phase 1 (capture only) as a single commit behind `?hands=1`.
Watch the console, get a feel for the latency and jitter on your own
hardware. Then decide whether phase 2's hardcoded attractor feels good
enough to justify phase 3. The smallest interesting version is **one
hand, one attractor, presence-faded, opt-in** — and that's probably
all this should be.
