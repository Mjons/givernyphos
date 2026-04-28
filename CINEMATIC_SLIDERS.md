# Sliders & cinematic mode

Which Settings sliders get modulated when cinematic mode (Director) is
running, and which get left alone. Useful when tuning defaults — the
"used" sliders need values that work _across all scenes the director
might transition into_, while the "not used" sliders are pure user
taste and never get auto-touched.

Indirect modulation comes from four director sub-systems:

- **Accents** — short force-pulses (`tickAccent` at [index.html:12816](index.html#L12816))
- **Moods** — visual modulators that linger (`tickMood` at [index.html:12700](index.html#L12700))
- **Scene transitions** — when director picks a new scene, physics + post are lerped to the new scene's values (`applyScenePhysics` / `applyScenePost` at [index.html:7236](index.html#L7236), [index.html:7350](index.html#L7350))
- **Camera moves** — pan, dolly, tilt, fov, orbit, grand-arc, etc. (`pickCameraMove` at [index.html:12296](index.html#L12296))

---

## Used by cinematic mode

### Physics panel

| Slider          | How cinematic touches it                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| **G (gravity)** | Accent (`gravity`, ±8% triangular envelope, [index.html:12843](index.html#L12843)) + scene transition |
| **Softening**   | Scene transition (replaced from `sc.physics.softening`)                                               |
| **Spin**        | Scene transition only (replaced from `sc.physics.spin`). **No accent yet** — see opportunity below    |
| **Timestep**    | Scene transition (replaced from `sc.physics.dt`)                                                      |

### Emergence panel

| Slider                 | How cinematic touches it                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| **Flocking**           | Accent (`flock`, 2× multiplier, [index.html:12849](index.html#L12849)) + scene transition     |
| **Radiation pressure** | Accent (`radiation`, 2× multiplier, [index.html:12855](index.html#L12855)) + scene transition |
| **Gravitational lens** | Scene transition only (replaced from `sc.lens?.strength`)                                     |

### Post panel

| Slider                   | How cinematic touches it                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- |
| **Exposure**             | `contrast` mood (-0.25 dip, [index.html:12751](index.html#L12751)) + scene transition   |
| **Bloom**                | `contrast` mood (×1.25 boost, [index.html:12750](index.html#L12750)) + scene transition |
| **Bloom radius**         | Scene transition only                                                                   |
| **Chromatic aberration** | Scene transition only                                                                   |
| **Vignette**             | Scene transition only                                                                   |
| **Grain**                | Scene transition only                                                                   |
| **Trails**               | Scene transition only                                                                   |
| **Doppler beaming**      | Scene transition only                                                                   |

### Camera panel

| Slider            | How cinematic touches it                                                           |
| ----------------- | ---------------------------------------------------------------------------------- |
| **Field of view** | Camera move (`fov` move, [index.html:12367](index.html#L12367)) + scene transition |

### Time panel

| Slider    | How cinematic touches it                            |
| --------- | --------------------------------------------------- |
| **Speed** | Scene transition (replaced from `sc.physics.speed`) |

### Render panel

| Slider          | How cinematic touches it                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Point scale** | Scene transition — lerps to `sc.pointScale` if the scene specifies one; otherwise the user's value is preserved across the swap |

---

## Not used by cinematic mode

The director never reads or writes these — they're pure user-taste
knobs. Adjust freely without affecting cinematic playback.

| Slider         | Panel   | Why cinematic ignores it                                        |
| -------------- | ------- | --------------------------------------------------------------- |
| **Substeps**   | Physics | Pure perf knob — sim accuracy/cost tradeoff, no cinematic value |
| **SFX volume** | Audio   | Director plays SFX cues but never changes volume                |
| **Volume**     | Audio   | Music routing — orthogonal to the visual director               |

### Collision-scene-builder sliders

These appear when a collision scene's config is being prepared, not
during runtime playback:

| Slider                 | Notes                                             |
| ---------------------- | ------------------------------------------------- |
| **Mass ratio (B/A)**   | Configures the next collision scene's body masses |
| **Impact parameter**   | Aim point for the colliding clusters              |
| **Approach velocity**  | Initial speed of the approach                     |
| **Initial separation** | Distance at scene start                           |

If the director picks a collision scene, these values are read once at
scene-construction time but never modulated during play.

---

## Notes on the boundary

A few cases where the answer is technically "yes" but the user-visible
effect is small or indirect:

- **`perturb` accent** ([index.html:12793](index.html#L12793)) — fires
  `rollDice()` (one-shot velocity scramble). Doesn't modulate any
  slider value, but does affect the live sim state. Catalogued under
  accents for completeness even though no slider moves.
- **`channel` and `palette` moods** — these change the colour mapping
  and palette but those are pill/select controls, not Sliders. Out of
  scope for this document.
- **Scene transitions** are technically optional — `params.allowMoods`
  / `allowAccents` per scene gates them ([index.html:6802](index.html#L6802),
  [index.html:11574](index.html#L11574)). A scene with `allowAccents: false`
  freezes G / flock / radiation at scene-transition values for the
  whole DWELL. Affected sliders behave as if "not used" for that
  scene's duration.

---

## Opportunity: spin accent

Currently **Spin** is the only physics slider in the "used" column with
no accent. [SPIN_SLIDER_PLAN.md §5](SPIN_SLIDER_PLAN.md) already proposed
a `swirl` accent — would slot into `ACCENT_WEIGHTS`
([index.html:12764](index.html#L12764)) cleanly:

```js
const ACCENT_WEIGHTS = {
  gravity: 15,
  perturb: 25,
  flock: 15,
  radiation: 15,
  swirl: 12, // new
};
```

With a temporary spin ramp envelope mirroring the gravity accent's
shape. Gives the director another tool for "make this feel like a
slow rotation is starting" without committing to a permanent spin
value. Still gated by the existing scene `allowAccents` toggle.
