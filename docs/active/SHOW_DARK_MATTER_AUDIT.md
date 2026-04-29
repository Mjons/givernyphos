# "Show dark matter halo" — why it looks like nothing happens

## TL;DR

The toggle works. But on most scenes — including the **default scene (Quiet Drift)** — there are _no halo (kind = 4) particles in the simulation at all_, so flipping the uniform reveals nothing. The toggle has no UX feedback that it just unhid 0 particles.

Only **4 of ~22 scenes actually contain kind-4 halo bodies**: Milky Way, Collision, Antennae, Bullet Cluster. Even on those scenes the halo is intentionally faint (alpha 0.32, size × 0.4) and lives on the _outside_ of the disk, so unless the camera is pulled back the unhidden particles fall outside the frame.

## What the toggle actually does

[index.html:10466-10474](index.html#L10466-L10474) — the toggle in the Settings panel:

```js
const hT = Toggle({
  label: "Show dark matter halo",
  hint: "Reveals invisible 'halo' particles that only pull gravitationally...",
  get: () => params.showHalo,
  set: (v) => {
    params.showHalo = v;
    pointMat.uniforms.uShowHalo.value = v ? 1.0 : 0.0;
  },
});
```

Same flag is also bound to the `X` hotkey at [index.html:18377-18379](index.html#L18377-L18379).

The shader path it gates is in the point vertex shader — [index.html:5202-5205](index.html#L5202-L5205):

```glsl
bool isHalo = (kindI == 4);
if (isHalo && uShowHalo < 0.5) {
  gl_Position = vec4(2.0); gl_PointSize = 0.0; vAlpha = 0.0; return;
}
```

So the toggle is wired correctly: it flips a uniform that suppresses kind-4 bodies. Working as designed.

## Why it looks dead

### 1. Most scenes spawn zero kind-4 bodies

Searched every scene's `make` function for emissions of kind = 4. Results:

| Scene                     | Spawns halo (kind 4)? | Notes                                                                           |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| **Quiet Drift** (default) | ❌ none               | Only kinds 0 (star) + 3 (dust) — [index.html:6747-6775](index.html#L6747-L6775) |
| Sagittarius               | ❌ none               | `makeSpiralGalaxyCore` only emits kinds 0/3                                     |
| Birth                     | ❌                    |                                                                                 |
| Event Horizon             | ❌                    |                                                                                 |
| Dust Storm                | ❌                    |                                                                                 |
| Orrery                    | ❌                    |                                                                                 |
| Lattice                   | ❌                    |                                                                                 |
| Stephan's Quintet         | ❌                    |                                                                                 |
| Coma Cluster              | ❌                    | uses `makeElliptical` with kind = 0                                             |
| Virgo · M87               | ❌                    |                                                                                 |
| Sombrero                  | ❌                    |                                                                                 |
| Horsehead                 | ❌                    |                                                                                 |
| **Milky Way**             | ✅ ~355               | [index.html:7752-7777](index.html#L7752-L7777) — sparse spheroid r ∈ [80, 360]  |
| **Collision**             | ✅ ~40% of budget     | via `buildGalaxy` → halo loop at [index.html:6454-6471](index.html#L6454-L6471) |
| **Antennae**              | ✅ ~40% of budget     | same `buildGalaxy` path                                                         |
| **Bullet Cluster**        | ✅ ~55% of budget     | via `addHaloCloud` calls at [index.html:7470, 7482](index.html#L7470)           |

So if you flip the toggle on Quiet Drift / Sagittarius / Birth / Event Horizon / etc., **literally nothing changes** — there are no kind-4 bodies for the shader to suddenly start drawing.

`makeSpiralGalaxyCore` ([index.html:6327-6370](index.html#L6327-L6370)), used by half a dozen scenes, was never wired to spawn halo particles. Only the more elaborate `buildGalaxy` ([index.html:6372-6473](index.html#L6372-L6473)) and the bespoke `sceneMilkyWay` / `sceneBulletCluster` paths do.

### 2. Even where halos exist, they're hard to see

When you _are_ on a scene with halos (e.g. Milky Way), the halo is rendered to be barely-visible by design:

- Alpha is 0.32 vs 1.0 for stars — [index.html:5262](index.html#L5262)
- Point size multiplied by 0.4 — [index.html:5214](index.html#L5214)
- Milky Way only spawns 355 halo bodies (vs ~3,500 disk + 260 bar) — [index.html:7751](index.html#L7751)
- Halos sit at r = 80–360 in MW; default MW camera is at distance ~360 with FOV 48 — many halo particles fall outside the frame at the default framing

The label "Show dark matter halo" implies a thick visible cloud will appear; the actual change on Milky Way is a faint sparse spherical haze that's easy to miss against the bloom + ember palette.

### 3. No "0 particles affected" feedback

The Settings panel doesn't know whether the current scene has any kind-4 bodies. It always shows the toggle as enabled and never indicates that on this scene the toggle is a no-op.

## Suggestions (pick what fits the project's voice)

1. **Cheap, high-leverage**: in the toggle's `set`, count kind-4 bodies in `state.velocities` (kind is `Math.floor(V[i*4+3])`) after the next frame and `showToast("Dark matter", "no halo bodies in this scene")` if zero. One toast, no shader changes.
2. **Better default visibility on MW**: bump halo alpha when `uShowHalo` is on (e.g. 0.32 → 0.55), and/or its point-size multiplier (0.4 → 0.7). The current values were tuned for the "halo invisibly pulls" mode, not the "user explicitly asked to see it" mode.
3. **Make `makeSpiralGalaxyCore` emit halo too** (gated by a parameter, default off so existing scenes don't change). Then Sagittarius / M87 satellites / Sombrero would also have something to show.
4. **Disable the toggle on scenes without halos**: in `syncUIToScene` / panel rebuild, dim + disable + tooltip "this scene has no halo particles". Same idea as (1) but more honest UI.
5. **Rename to be precise**: "Show dark matter halo" → "Show halo particles (when present)". Lower expectations.

## Verifying the diagnosis (manual repro)

1. Load the page on default scene (Quiet Drift) → flip the Settings → Visibility → "Show dark matter halo" toggle → confirm zero pixels change.
2. `applyScene("milky-way", { immediate: true })` from devtools (or pick Milky Way from the scene browser) → flip toggle → faint outer haze should appear/disappear.
3. Same on `bullet-cluster` → big offset blobs flanking each cluster appear (this is the most dramatic case).
