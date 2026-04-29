# Spin slider — design exploration

A new physics knob: "spin" — adds rotational drive around the system's
centre of gravity. Cheap force-field addition; visually huge.
This doc explores the variants, math, and integration surface before
committing to one.

## 1. What "spin" means

The user request — _"a little spin to the centre of gravity"_ — has
three honest interpretations. They differ in how much CPU/GPU work they
need and what they look like.

### A. Vorticity around the origin (cheapest)

Every body gets a tangential push perpendicular to its position vector,
about a fixed axis. Mathematically it's a **uniform angular-velocity
field** added to the existing accelerations:

```
a_spin = ω × (p - 0)        where ω = uSpin · axis
```

If `axis = +Y`, all bodies above and below the XZ plane swirl around Y.
At small magnitudes this looks like the system is gently rotating; at
high magnitudes orbits stretch into spirals and clusters fall into
disks.

Cost: ~6 FLOPs per body per frame — i.e., O(N) work bolted onto the
O(N²) gravity loop. Zero readback, zero new uniforms beyond `uSpin` and
maybe `uSpinAxis`.

**Caveat:** treats world origin as the centre. Most of our scenes are
already centred there ([index.html:5894-5904](index.html#L5894-L5904)
seeds physics from `sc.physics`, and scene factories build around (0,0,0)).
But the _system_ of bodies drifts off the origin in many films — by the
time `pilgrim` is in act 3 the cluster is far from where it started.
Spin around origin then looks wrong: bodies on the "far side" of the
cluster get a much larger tangential push than near-side bodies, so the
cluster shears instead of rotating.

### B. Vorticity around the live centre of mass (visually correct)

Compute the system barycenter each frame, use it as the spin pivot:

```
a_spin = ω × (p - p_com)
```

The centre of mass calculation is a reduction over all bodies. Two ways:

- **CPU-side, one frame stale.** We already read back position data
  every few frames for stats / pick / follow-cam
  ([PHASE1_WEBGPU.md §1.4](PHASE1_WEBGPU.md#L70-L75)). Add a `Σ m·p / Σ m`
  sum to the existing reduction, send it back as a uniform. One frame
  of latency is invisible at 60 fps.
- **GPU-side reduction.** A `workgroup_size(256)` reduction kernel
  before the velocity step. ~1 ms even at colossal. Properly
  synchronous, no latency. Adds a third compute pipeline to the WebGPU
  path and an analogue ping-pong texture to the WebGL path.

Either is fine. CPU-side is cheaper in code-surface; we already do the
readback. **Recommended.**

### C. Spin a _moving_ attractor (cinematic, but a different thing)

If the user wants the _gravity centre itself_ (a single attractor body
or a virtual mass) to spin in space — orbital mechanics around a
swirling point — that's a different feature. Several scenes already use
attractors (`virgo-m87`'s central black hole; `lattice`'s grid points)
but they're fixed. Making them move on a circular path would be cool
and is orthogonal to (A)/(B).

Out of scope for this slider. If the user wants this, it's a separate
"orbit centre" feature.

---

## 2. The math, concretely

For variant B (recommended) the per-body addition is:

```wgsl
let r       = posA.xyz - p.com;          // p.com = vec3<f32> uniform
let a_spin  = cross(p.spinAxis * p.spin, r);
acc        += a_spin;
```

`p.spin` is signed scalar (negative = retrograde). `p.spinAxis` is a
unit vector — Y by default, but exposing it later means tilted rotators
are one click away.

For the integrator, this is just another force term added before
`velA.xyz + acc * p.dt * p.sign` at [index.html:1627](index.html#L1627)
(WGSL) and the equivalent GLSL line at [index.html:2497](index.html#L2497).

### 2.1 Stability

A pure tangential force isn't conservative — it pumps energy into the
system if `spin` is large compared to bound-orbit velocities. In
practice:

- Small `spin` (≤ ~0.05): looks like the system is gently rotating;
  bound orbits widen slightly into precession.
- Medium (~0.1–0.3): clusters flatten into disks.
- Large (> ~0.5): orbits shear apart, dust trails stretch into
  long arcs that escape the system.

That's a feature, not a bug — same character as the existing G slider
where high values smash everything into a black-hole core. The slider
should expose 0..0.5 for "musical" range and let users push past via
keyboard nudge if they want chaos.

### 2.2 Time-reverse

`uSign` flips the sign of `dt` for time-reverse. Since `a_spin · dt`
inherits the sign automatically, retrograde becomes prograde under
reversal — physically consistent. No extra work.

---

## 3. Implementation surface

### 3.1 WGSL changes ([index.html:1563-1632](index.html#L1563-L1632))

Add to `SimParams`:

```wgsl
spin:     f32,        // signed scalar, 0 = off
spinAxisX: f32,
spinAxisY: f32,
spinAxisZ: f32,
comX:     f32,
comY:     f32,
comZ:     f32,
```

(Pack to 16-byte alignment with existing `_pad` slots; we already have
two `_pad` u32s at indices 8/9 in the params buffer per
[PHASE1_WEBGPU.md §2.3](PHASE1_WEBGPU.md#L181-L189).)

After the all-pairs loop, before the integrator:

```wgsl
if (alive && p.spin != 0.0) {
  let r       = posA.xyz - vec3<f32>(p.comX, p.comY, p.comZ);
  let omega   = vec3<f32>(p.spinAxisX, p.spinAxisY, p.spinAxisZ) * p.spin;
  acc        += cross(omega, r);
}
```

### 3.2 GLSL changes ([index.html:2448-2500](index.html#L2448-L2500))

Mirror block. Same logic, GLSL syntax. ~5 lines.

### 3.3 JS uniform plumbing

Three touch points:

- `installSimUniforms` ([index.html:2575](index.html#L2575)): seed
  `uSpin = 0`, `uSpinAxis = (0,1,0)`, `uCom = (0,0,0)`.
- `applyScenePhysics` ([index.html:5894](index.html#L5894)):
  `uniforms.uSpin.value = sc.physics.spin ?? 0` so scenes can ship a
  default. Most scenes leave it 0; `vortex` and `virgo-m87` could
  default to something non-zero.
- Per-frame writer ([index.html:1932-1939](index.html#L1932-L1939))
  for the WebGPU params buffer: extend the float layout to include
  spin + axis + com.

### 3.4 COM tracking (variant B)

A new function `updateBarycenter()` — runs in the existing stats
readback path on whatever cadence the stats already use (currently
every few frames, see [index.html:8121](index.html#L8121)).

```js
let comAccum = new Float32Array(3);
function updateBarycenter(positions) {
  let sx = 0,
    sy = 0,
    sz = 0,
    sm = 0;
  for (let i = 0; i < positions.length; i += 4) {
    const m = positions[i + 3];
    if (m <= 0) continue;
    sx += positions[i] * m;
    sy += positions[i + 1] * m;
    sz += positions[i + 2] * m;
    sm += m;
  }
  if (sm > 0) {
    comAccum[0] = sx / sm;
    comAccum[1] = sy / sm;
    comAccum[2] = sz / sm;
  }
}
```

At titanic+ this iterates 130k–518k floats CPU-side. Not free but on
the order of 1 ms; fine since stats already pay this cost. If it
shows up in a profile we move it to a GPU reduction kernel later.

### 3.5 Slider UI

Slot into the Physics section in `buildSettingsPanel`
([index.html:7686](index.html#L7686)) right after the G slider:

```js
const spinS = Slider({
  label: "Spin",
  min: -0.5,
  max: 0.5,
  step: 0.01,
  hint: "Adds rotation around the system's centre of gravity. Negative spins the other way.",
  get: () => params.spin,
  set: (v) => {
    params.spin = v;
    velVar.material.uniforms.uSpin.value = v;
  },
});
phys.appendChild(spinS.el);
```

Bipolar range with 0 at centre is the right default — both directions
are useful, and the slider visually communicates "neutral in the middle".

---

## 4. Visual character at different settings

(Predictions based on the math; verify on real hardware.)

| `spin` | What it looks like                                              |
| ------ | --------------------------------------------------------------- |
| 0      | Existing behaviour — pure gravity / flock / radiation           |
| 0.02   | Bare hint of rotation; bound systems precess slowly             |
| 0.05   | "The galaxy is rotating" — clear coherent motion, orbits intact |
| 0.1    | Clusters flatten into thick disks; eccentric orbits circularise |
| 0.2    | Spiral arms emerge in dense scenes; thin disks                  |
| 0.3+   | Outer bodies spin off into long arcs; system loses cohesion     |
| 0.5    | High shear, comet-like streaks dominate                         |

Worth adding a one-line visual cue under the slider that updates as the
user drags — same pattern as the existing `hint` field but live, e.g.
"gentle rotation" / "spiral arms" / "centrifugal escape". Optional.

---

## 5. Cinematic mode integration

The director has `accent` actions (gravity pulse, flock pulse, perturb)
at [index.html:11176-11243](index.html#L11176-L11243). A natural new
accent: **"swirl"** — temporarily ramp `uSpin` up over a few seconds,
then back to baseline.

```js
case "swirl": {
  const baseSpin = a.baseSpin ?? 0;
  velVar.material.uniforms.uSpin.value =
    baseSpin + (a.peak - baseSpin) * shaped;
  if (t >= 1) velVar.material.uniforms.uSpin.value = baseSpin;
  break;
}
```

Particularly nice for `vortex`, `nebula-pillar`, anything with a
visible cluster. Out of scope for the first pass of this slider but
keep the uniform name stable so the director can adopt it later.

---

## 6. Mood / accent / palette modulation

The mood system already nudges `uG` and `uFlock` per palette
([applyScenePhysics](index.html#L5894)). Spin would slot in cleanly:

- `calm` palette → spin defaults to 0 (no swirl)
- `tense` palette → small retrograde drift (-0.02)
- `bright` palette → small prograde drift (+0.04)

Cheap to wire and adds an extra dimension to mood character. Optional —
the slider works without it.

---

## 7. Tradeoffs / open questions

1. **Origin-locked vs COM-locked** — variant A is 5 lines and works
   for most scenes; variant B is ~30 lines and works always. Recommend
   shipping B from the start; the cost difference is small and avoiding
   the "shear instead of rotate when cluster drifts" failure mode is
   worth it.
2. **Spin axis exposure.** First version: hard-code Y. Second version:
   expose axis as three sliders or a 3D widget. Most users will never
   touch axis; defer until requested.
3. **Default range.** -0.5..+0.5 is musical. We could go ±2 but the
   slider becomes hard to set finely without a non-linear curve. Keep
   it tight; users wanting chaos can keyboard-nudge past the bounds.
4. **Per-scene defaults vs global override.** Scenes can set
   `physics.spin`; the slider should reset to that on scene change,
   matching how G and softening work today. Confirmed pattern at
   [applyScenePhysics](index.html#L5894).
5. **Persistence in capture.** The slider state is already part of
   `params`, which is captured in scene snapshots and bookmarks (when
   that lands per [NOTES_SCALESPACE_REDDIT.md §4.4](NOTES_SCALESPACE_REDDIT.md)).
   No extra work.
6. **Time-reverse interaction with COM tracking.** When `uSign = -1`
   the COM still drifts the same way (mass-weighted average is
   sign-invariant). No issue.

---

## 8. Recommended path

**Ship variant B with hard-coded Y axis, slider range -0.5..+0.5,
default 0.** Specifically:

1. Add `uSpin`, `uCom` uniforms to GLSL + WGSL shaders. ~10 LoC.
2. Add `params.spin = 0` and the slider in the Physics section. ~15 LoC.
3. Add `updateBarycenter()` to the existing stats readback path.
   ~20 LoC.
4. Wire `params.spin → uSpin.value` and `comAccum → uCom.value` per
   frame. ~5 LoC.
5. Default to 0 in `installSimUniforms`; honour `sc.physics.spin` in
   `applyScenePhysics`. ~5 LoC.

Total: **~55 LoC of new code, ~1 day.** Reversible — single uniform,
single slider. If it doesn't feel right we delete five lines and the
slider is gone.

Stretch (after the basic version is in hand):

- "Swirl" accent for the director.
- Mood-driven spin defaults.
- Live caption under the slider ("gentle rotation" / "spiral arms").
- Axis sliders.

---

## 9. What I'd want from you before writing code

- Does variant B match the intent, or did you mean something closer to
  C (spin a moving attractor)?
- OK with -0.5..+0.5 default range, or want something else?
- Should this slider exist on the Physics panel, or somewhere more
  prominent (e.g. the main HUD)? The Physics panel is the natural
  home but it does hide the knob a click away.
