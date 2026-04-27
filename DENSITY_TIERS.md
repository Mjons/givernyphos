# High-density tiers — design exploration

Proposal for adding 128k / 256k / 500k body counts on top of today's 4
tiers, plus the safety scaffolding (warnings, auto-revert) that has to
come with them.

## Where we are today

Source: [index.html:1331-1364](index.html#L1331-L1364).

```
lite      → 64²   →  4 096 bodies
standard  → 128²  → 16 384 bodies   (default)
dense     → 181²  → 32 761 bodies
lush      → 256²  → 65 536 bodies   (current ceiling)
```

`MAX_BODIES = TEX_SIZE²` because the GPGPU n-body solver stores body
state in two square float-RGBA textures (positions, velocities). Every
factor-2 in TEX_SIZE = factor-4 in body count = factor-16 in gravity
work per frame.

## What you asked for

Three new tiers above lush:

| Key (proposed) | TEX_SIZE | Body count | Vs lush | Vs standard |
| -------------- | -------- | ---------- | ------- | ----------- |
| `titanic`      | 315      | 99 225     | 1.5×    | 6×          |
| `colossal`     | 512      | 262 144    | 4×      | 16×         |
| `abyssal`      | 720      | 518 400    | 8×      | 32×         |

(315, 512, 720 — 512 is a clean power of two, 720 lands exactly at
~500k, 315 lands cleanly at ~99k. titanic was previously 360 / 130k
and was dropped a step to keep solid 60 fps headroom on the WebGL2
path while WebGPU phase 1 lands.)

## Compute & memory budget

The gravity step is O(N²). Per-frame numbers:

| Tier         | N           | Force pairs / frame | CPU memory (pos+vel) |
| ------------ | ----------- | ------------------- | -------------------- |
| standard     | 16 384      | 268 M               | 524 KB               |
| lush         | 65 536      | 4.3 G               | 2.1 MB               |
| **titanic**  | **99 225**  | **9.8 G**           | **3.2 MB**           |
| **colossal** | **262 144** | **68.7 G**          | **8.4 MB**           |
| **abyssal**  | **518 400** | **268.7 G**         | **16.6 MB**          |

CPU memory is irrelevant — even abyssal is < 17 MB. **GPU compute is
the real ceiling.** Numbers depend heavily on the user's hardware:

- Mid-range integrated GPU (Iris Xe, M1 base): probably caps at lush.
  titanic and above will tank to <15 fps.
- RTX 3060 / 4060: titanic should hit 60 fps, colossal 30–45 fps,
  abyssal 5–15 fps.
- RTX 4080 / M3 Max: colossal at 60 fps, abyssal possibly 20–30 fps.
- Anything older (mobile, integrated, 5+ years): even lush can stutter.

There's no portable way to detect this ahead of time — `gpu.getRendererInfo()`
exists but the strings are noisy and don't reliably correlate with
float-throughput. Hence: **opt-in tier with FPS-watchdog auto-revert.**

## WebGL texture-size limits

`gl.getParameter(gl.MAX_TEXTURE_SIZE)` is the hard ceiling. Typical
values:

- Mobile / integrated: 4 096
- Mid-range: 8 192
- Desktop discrete: 16 384

We're well under all of these (720 < 4 096), so texture size is not a
gate — only compute is.

We should still call `gl.getParameter(gl.MAX_TEXTURE_SIZE)` once at
boot and disable any tier whose TEX_SIZE exceeds the actual limit.
Defensive — costs nothing.

## Warnings UX

Three options for how the warning surfaces, ranked by friction:

### Option A — soft toast on selection

User clicks `colossal` in the density panel. Toast appears for 4s:
"~262k bodies. Heavy on GPU; auto-revert if FPS drops." Selection
applies immediately.

- Pro: single-click; minimal friction.
- Con: no informed-consent moment.

### Option B — modal confirm before applying

User clicks `colossal`. Modal appears with the body count, the GPU-load
implication, and `[Try it]` / `[Cancel]`. Modal only fires for
`titanic+`; below that, change is silent.

- Pro: explicit consent; user knows what they're getting.
- Con: extra click; modal feels heavy.

### Option C — modal confirm + auto-revert watchdog

Confirm modal as in Option B. After applying, an FPS watchdog runs for
~15 seconds. If the average FPS drops below a threshold, a banner with
a 10-second countdown appears: "FPS dropped to 18 — reverting to lush
in 10 9 8… [Stay anyway]". User has 10 s to cancel; otherwise we
auto-revert.

- Pro: belt-and-braces. Catches the case where the user clicked through
  the warning, things are unplayable, and they're not fast enough to
  navigate the UI to fix it.
- Con: most code; banner UI is real work.

**Recommendation: ship Option C.** The user explicitly asked for
this — and on the 24/7 stream context, an unattended bad config would
show garbage frames until restart. A watchdog is exactly the right
shape.

## Auto-revert watchdog — concrete spec

```
trigger:        density change to a tier higher than current
sample window:  rolling 5-second mean of frame intervals
sample start:   2 seconds after density-change settles
                (let GPU buffers warm up; first 2s lies)
threshold:      mean FPS < 24 over the 5-second window
                (24 = "noticeably stuttery"; tune later)
banner:         shows when threshold breached
                "FPS dropped to <X>. Auto-reverting to <prevTier> in 10s"
                progress-bar countdown + [Stay anyway] button
revert:         after 10 s, if user hasn't clicked, switch to prev tier
                (the one we came from, not the lower neighbour)
suppress:       if the user clicked "Stay anyway", don't fire watchdog
                again for this session at this tier
```

Edge cases worth thinking about:

- **Tab backgrounded during sample window**: rAF throttles → fake low
  FPS. Skip the watchdog while `document.hidden`; reset the sample
  window when the tab returns.
- **Scene transitions**: GPU spike during a transition can dip FPS.
  Pause the watchdog while `transitionRaf` is non-null.
- **User manually steps DOWN a tier**: cancel any pending watchdog —
  they handled it themselves.

## Implementation surface

Where the changes land:

1. **`DENSITY_LEVELS`** ([index.html:1332](index.html#L1332)): add three entries.
2. **`DENSITY_ORDER`** ([index.html:1338](index.html#L1338)): append.
3. **Density panel UI** (wherever the existing rail/panel renders the
   selector) — add the three new pills, mark them with a warning glyph
   for `titanic+`.
4. **`MAX_TEXTURE_SIZE` gate at boot** — disable pills the GPU can't
   support.
5. **Confirmation modal**: trivial — reuse `#toast` overlay style;
   probably 30 LoC.
6. **FPS watchdog**: a small module that hooks into the existing
   `fpsAccum / fpsEl` path ([index.html:12463-12468](index.html#L12463-L12468))
   and tracks a 5s rolling mean. ~50 LoC.
7. **Auto-revert banner**: new DOM element + CSS, countdown timer
   driven by `requestAnimationFrame`. ~40 LoC.
8. **Body factories**: existing scenes mostly use `MAX_BODIES` and
   `Math.floor(MAX_BODIES / N)` so they scale automatically. Worth
   skimming each factory in [index.html:3000-4500](index.html#L3000-L4500)
   for hardcoded counts that won't scale gracefully (anything
   referencing literal 65535 / 256 / etc).
9. **README + about-panel** mention the new tiers and the watchdog
   so users know what's happening if they see the countdown.

## Decisions (shipped)

1. **Auto-revert threshold:** 30 fps over a 5-second rolling window.
2. **Revert target:** step down by one tier. Lets people incrementally
   find their ceiling rather than always falling back to the same place.
3. **"Stay anyway" persistence:** session-only — fresh tab gets the
   warning again.
4. **UI grouping:** new tiers live under a separate "⚠ Experimental"
   sub-section in the density panel.
5. **Naming:** name + count (`titanic 99k`, `colossal 262k`,
   `abyssal 518k`) — matches the existing `lite / standard / dense /
lush` pattern.

## Shortlist (where I'd start)

If the goal is just "ship it":

1. Add the three tiers + `MAX_TEXTURE_SIZE` gate (1 hour).
2. Confirmation modal (1 hour).
3. FPS watchdog with auto-revert banner (2 hours).
4. Sweep body factories for scaling bugs (1 hour).

Total: half a day's work. Watchdog is the load-bearing piece —
without it, a 24/7 stream that lands on `abyssal` on a slow GPU
becomes unwatchable until restart.
