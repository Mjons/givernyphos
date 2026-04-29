# Capture WYSIWYG — audit & plan

The complaint: **PNGs don't match what's on screen.** Specifically, CA
and trails were called out as absent from saves. This doc separates
real bugs from intentional behavior, and proposes fixes ordered by
user impact.

## What "WYSIWYG" means here

The pixel that hits your monitor inside the canvas rect should be
the same pixel that ends up in the file. DOM overlays (HUD, rail,
panels) are explicitly _not_ part of the canvas and are not in scope
— that's a separate "render the UI into the file" feature, which is a
different (and rarely wanted) thing.

So WYSIWYG = canvas-fidelity. Everything inside the canvas — bloom,
trails, CA, vignette, grain, lens, follow-cam pulse, halos — should
round-trip through the saver.

## What's WYSIWYG today (audit findings)

The composer chain is:
**RenderPass → lensPass → bloom → trailsPass (afterimage) → caPass →
(planetPass) → vigGrainPass → OutputPass**.

Trails are scene-graph `THREE.Line` meshes (`starTrail.meshA/B`),
captured by `RenderPass`. The follow-cam pulse is a uniform on
`pointMat`, so it's also "in" the scene. Halos are scene meshes.
**All of the canvas-side effects are technically captured.**

### Per-path summary

| Path                    | Method                       | Composer? | CA, bloom, trails, etc. |
| ----------------------- | ---------------------------- | --------- | ----------------------- |
| `takeScreenshot(scale)` | resize + `composer.render()` | ✅        | ✅ (with caveat §1)     |
| `exportPNG()`           | resize + `composer.render()` | ✅        | ✅ (with caveat §1)     |
| `maybeCaptureThumbnail` | resize + `composer.render()` | ✅        | ✅ (with caveat §1)     |
| WebM record             | `canvas.captureStream(60)`   | live      | ✅ (whatever's on)      |
| Fidenza generator       | CPU 2D canvas                | ❌        | ❌ — algorithmic        |
| Filament generator      | CPU 2D canvas                | ❌        | ❌ — algorithmic        |

So if you press **P** or use **Capture → Save PNG** with CA enabled in
settings, CA _is_ in the file. If you press **I** (Fidenza) or **U**
(Filament), it's not — those are deliberately CPU-side vector outputs
that don't see the GPU pipeline at all.

The user's "missing CA / trails" complaint resolves into four concrete
issues, listed below.

---

## Issue 1 — Resolution-dependent passes don't get re-uniformed on resize

### What happens

`takeScreenshot(scale)` and `exportPNG()` both do:

```js
renderer.setSize(W, H, false);
composer.setSize(W, H);
camera.aspect = W / H;
camera.updateProjectionMatrix();
composer.render();
// ... toDataURL, then reset
```

`composer.setSize()` resizes the internal render targets. But shader
passes that hold a `uResolution` (or `uTexelSize`, `uAspect`) uniform
don't get those uniforms updated automatically — Three.js doesn't
know which uniforms in a `ShaderPass` are size-dependent.

Concretely, **`caPass.uniforms.uAspect`** is set once at construction
time. At 4× export it samples with the viewport aspect, not the
upscaled aspect, so the radial falloff lands in the wrong place. CA
fringes drift off the bodies that triggered them. The vignette and
grain passes have similar pitfalls if any of their uniforms are
size-tied (need to verify per-pass).

### Fix

Wrap the resize so size-dependent uniforms get rewritten:

```js
function resizeRenderForCapture(W, H) {
  renderer.setSize(W, H, false);
  composer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  // Refresh size-dependent shader uniforms.
  if (caPass?.uniforms?.uAspect) caPass.uniforms.uAspect.value = W / H;
  if (caPass?.uniforms?.uResolution)
    caPass.uniforms.uResolution.value.set(W, H);
  if (vigGrainPass?.uniforms?.uResolution)
    vigGrainPass.uniforms.uResolution.value.set(W, H);
  if (lensPass?.uniforms?.uAspect) lensPass.uniforms.uAspect.value = W / H;
  // bloom auto-handles via setSize() — verify by reading UnrealBloomPass.
}
```

Use it in all three paths (`takeScreenshot`, `exportPNG`,
`maybeCaptureThumbnail`) and on the reset back to viewport size.

**Estimated effort:** ~30 LoC, one helper. **Impact:** the actual
"CA looks wrong in saved PNGs" complaint disappears at 2× and 4×.

---

## Issue 2 — Stale uniforms at capture time

### What happens

A few passes have time-driven or state-driven uniforms set inside the
main loop (`uTime`, `uFollowPulse`, etc.). The capture functions call
`composer.render()` directly without first ticking the per-frame
uniform updates. Result: a screenshot can capture a frame where
`uTime` is from N frames ago and the trail "afterimage" pass holds
state from a different size.

This is invisible on most frames but explains intermittent
"the saved PNG looks subtly off" reports — the grain seed is stale,
the follow-cam pulse uniform may be at a different point in its
animation than the visible frame.

### Fix

Before the capture `composer.render()`, copy the current
animation-loop uniform values one more time:

```js
function syncFrameUniformsForCapture() {
  pointMat.uniforms.uTime.value = simTime;
  if (starfieldMat) starfieldMat.uniforms.uTime.value = simTime;
  if (vigGrainPass?.uniforms?.uTime)
    vigGrainPass.uniforms.uTime.value = simTime;
  // Any other per-frame uniforms — pull this list from the main loop body.
}
```

Call it inside `resizeRenderForCapture` after the resize, before
`composer.render()`.

**Estimated effort:** ~10 LoC. **Impact:** matches grain phase /
follow pulse / time-driven shader effects exactly to what's on
screen at the moment of capture.

---

## Issue 3 — `trailsPass` (afterimage) state on resize

### What happens

`trailsPass` is `AfterimagePass`, which keeps a feedback texture of
the previous frame. When `composer.setSize()` resizes the internal
target, the feedback texture is reallocated — meaning the _first
frame after a resize_ has no afterimage history.

`takeScreenshot(scale)`:

1. resizes to `W*scale × H*scale`
2. calls `composer.render()` once
3. captures
4. resizes back

That single render at the new size **starts with empty afterimage
state**, so the saved PNG has no trail-fade on top of the line-mesh
trails. The line meshes are fine (they're in the scene graph), but
the soft motion-blur halo from the afterimage pass is missing.

### Fix

Two options:

- **A — Render twice.** Call `composer.render()` twice; the second
  call gets a one-frame afterimage seeded from the first. Not perfect
  but better than zero. Roughly doubles capture time at 4× resolution
  (still <100ms, fine).
- **B — Skip the resize, render at viewport size, upscale via
  off-screen canvas.** Renders once at native resolution into a
  cached offscreen render target, then upscales the result via 2D
  canvas drawImage to the export size. Loses the benefit of
  super-sampled exports but the afterimage state is preserved. Bad
  trade for high-res output.

Recommendation: **A**. The afterimage pass is decoration on top of
the (correctly captured) trail meshes; one extra render is cheap and
restores fidelity.

**Estimated effort:** one extra `composer.render()` call in each
capture path. **Impact:** afterimage motion-blur trails appear in
saves the way they do on screen.

---

## Issue 4 — Fidenza & Filament are not WYSIWYG by design

### What happens

`I` (Fidenza) and `U` (Filament) skip the GPU pipeline entirely.
They:

1. Read positions/velocities from GPU once
2. Build a flow field on CPU
3. Walk strokes / chains
4. Render with `canvas.getContext('2d')`

No bloom, no CA, no trails, no grain. By design — these are
_generative-art_ outputs, not screenshots. But the user's expectation
("WYSIWYG") doesn't match what the buttons do.

### Three options, pick one

#### A — Rename the buttons / clarify in UI

Change the Capture panel labels from "Fidenza" / "Filament" to
"Fidenza print" / "Filament print" (or "Fidenza vector"). Add a
one-line caption: "stroke-based reinterpretation of the current frame
— ignores post-processing." Cheapest fix; honest about scope.

#### B — Composite the live frame on top after 2D render

After `_fidenzaRender()` finishes, blend the WebGL canvas (with all
post-processing) on top at low alpha. Result: vector strokes plus a
ghost of the actual scene with bloom + CA. Could look great, could
look muddy — needs a visual pass. Behind a "blend with live frame"
toggle.

#### C — Add a true "Save canvas" button

Add a third capture mode: "Save current frame" which is just
`takeScreenshot(1)` exposed via the panel. Keeps Fidenza/Filament as
the algorithmic outputs they are, gives users a direct WYSIWYG saver
that matches the live image 1:1. (Note: `P` already does this; the
fix is making it discoverable in the panel UI.)

**Recommendation:** **A + C.** Rename to clarify Fidenza/Filament are
_reinterpretations_, and add a "Save frame as PNG" button alongside
them.

**Estimated effort:** A is 2-line UI change. C is ~15 LoC button

- wiring.

---

## Out of scope (intentional non-WYSIWYG)

Listing for completeness so we don't accidentally "fix" these:

- **HUD, rail, panels, rec-dot** — DOM overlays. Not in canvas. If a
  user wants the UI baked into a screenshot they can use OS-level
  capture; we shouldn't fold it into our pipeline.
- **Grain frame seed** — every frame has unique noise. Saved PNG
  freezes one frame's noise; WebM captures the animated sequence.
  This is correct for both formats.
- **JSON export** — not a visual capture; ignores rendering entirely.

---

## Shortlist

If the goal is "fix the user's actual complaint":

1. **Issue 1 — size-dependent uniform refresh** (~30 LoC) — single
   biggest win. Saves at 2×/4× will visually match the live render
   instead of having drifting CA.
2. **Issue 3 — double-render to seed the afterimage** (~3 LoC) —
   makes the soft trail-blur appear in saves.
3. **Issue 2 — frame uniform sync** (~10 LoC) — kills the
   "subtle off" feeling on time-driven effects.
4. **Issue 4A — UI label clarity** (2 LoC) — sets expectations so
   users don't expect Fidenza/Filament to be 1:1 saves.
5. **Issue 4C — "Save current frame" button in capture panel** —
   gives a discoverable WYSIWYG path beside the algorithmic ones.

1–3 together restore PNG fidelity to what's on screen. 4 is about
matching user expectation against what the feature actually does.

## Verification checklist after implementation

- [ ] Open app, set CA strength to 0.4, take a 1× screenshot — diff
      against a screen-rect crop of the live canvas. Should be
      pixel-identical (within JPEG/PNG quantisation).
- [ ] Same test at 2× and 4×. CA fringes should sit on the same
      bodies, just larger image.
- [ ] Start a trail (follow a body for 10s), take a screenshot. Soft
      afterimage halo should be present, not just hard line trails.
- [ ] Toggle `params.showHalo` on, screenshot — halo present.
- [ ] Toggle vignette darker, screenshot — vignette present and
      sized correctly at 4×.
- [ ] Run for 30s, screenshot consecutively 5 times — grain seed
      should advance, no two saves identical.
