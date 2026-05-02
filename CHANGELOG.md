# Changelog

Notable changes and — at the top — a **bug ledger** of regressions
that bit us once and shouldn't bite us again.

---

## Bug ledger — don't redo

Each entry: the bug, the failure mode, the fix, and the rule. Read
this before touching the relevant area.

### Audio `abort` event listeners cascade

**Bug:** A music-playlist "loop guarantee" added a listener for the
HTMLMediaElement `abort` event that called `next()` to skip broken
tracks. Pressing play caused the playlist to whip through every
track at ~250ms each, never actually playing audio.

**Failure mode:** The `abort` event fires every time `audio.src` is
replaced — that includes our own `load(idx)` calls, which set the
src on every track change. So:

1. `load(track A)` sets `audio.src = "A.mp3"`. Plays.
2. Track ends → `next()` → `load(B)` sets `audio.src = "B.mp3"`.
3. Browser fires `abort` for the now-cancelled "A.mp3" load.
4. Our handler treats the abort as a broken track → `next()` again.
5. `load(C)` aborts "B" → handler skips to D → loops forever.

`error` events can also fire alongside `abort` with `code === 1`
(`MEDIA_ERR_ABORTED`) during normal src changes, so naive `error`
handlers also cascade.

**Fix:** [ee6ac0e](https://github.com/Mjons/givernyphos/commit/ee6ac0e)

- Don't listen to `abort`.
- On `error`, ignore `audio.error.code === 1`. Only act on
  real failures (`MEDIA_ERR_NETWORK`=2, `MEDIA_ERR_DECODE`=3,
  `MEDIA_ERR_SRC_NOT_SUPPORTED`=4).

**Rule:**

> **Never bind `abort` on an HTMLMediaElement.** It is a normal
> lifecycle event for src changes, not a failure signal.
> When binding `error`, always check `audio.error.code` and skip
> code 1 (`MEDIA_ERR_ABORTED`).

### Adding a new `KIND_*` requires updating WGSL + WebGPU buffer sizes

**Bug:** Bumping `NUM_KINDS` from 7 → 8 (to add `KIND_ASTROPHAGE`)
worked on the WebGL path, but on WebGPU the `K[8*8]=64` matrix
silently truncated to 49 entries because the WGSL struct hardcoded
`K: array<f32, 49>` and the params buffer was sized at 320 bytes
(only enough for `K[49]`). Typed array writes past the end of an
`ArrayBuffer` are silent no-ops in JS, so the truncation was
invisible until astrophage fell outside the kept K-matrix region.

**Fix:** [96fbb0c](https://github.com/Mjons/givernyphos/commit/96fbb0c)

- WGSL struct `K: array<f32, NUM_KINDS²>` (currently 64).
- `PARAMS_BYTES` = 28 fixed floats × 4 + `NUM_KINDS²` × 4 + 16 headroom.
- `_wgpuParamsScratch = new ArrayBuffer(PARAMS_BYTES)`.
- `writeBuffer` size argument matches.

**Rule:**

> **Bumping `NUM_KINDS` requires four edits, not one.** The JS
> constant ([index.html:1563](index.html#L1563)), the WGSL constant
> in `WGSL_VEL_SHADER` (line ~1996), the WGSL struct's K array
> length, and `PARAMS_BYTES` + scratch buffer + writeBuffer size all
> live in different places and all silently mis-match if you change
> only one. Grep for `NUM_KINDS` and audit every hit.

---

## Unreleased

_(things in flight; not yet shipped)_

- WGSL astrophage early-return branch — the WebGL kind-7 branch is
  not mirrored on the WebGPU compute path, so the petrova-line scene
  is WebGL-only. TODO marker in the WGSL kernel.
- PHM Hail Mary / Blip-A / Beetle archetypes — designed in
  [PASSING_SHIPS.md](docs/active/PASSING_SHIPS.md), not yet built
  beyond the static `?scene=ship-test` silhouette.

---

## 2026-04-29

- **Music: fix runaway skip cascade** — see bug ledger entry above.
  ([ee6ac0e](https://github.com/Mjons/givernyphos/commit/ee6ac0e))
- **Music: loop guarantee** — `error` handler skips broken tracks,
  7-second watchdog resumes playback if paused without user intent,
  `state.userPaused` distinguishes user-pause from system-pause.
  ([916d55f](https://github.com/Mjons/givernyphos/commit/916d55f))
- **Petrova scene: browser entry + cover thumbnail** — `petrova-line`
  added to `SCENE_ORDER`, custom `scene_cards/petrova-line.webp`
  (1024×378, 16 KB) wired to `SCENE_COVERS`.
  ([98de70f](https://github.com/Mjons/givernyphos/commit/98de70f))

## 2026-04-28

- **Petrova steps 2-3: scenePetrovaLine + respawn lifecycle** —
  star + planet + N astrophage in a launch disc near the star;
  position-shader respawn snaps arrived bodies back to the disc;
  velocity-shader matches with arrival-zeroes-velocity. TINT_PETROVA
  for red shades. Scene scales to fill the active density tier.
  ([2f693f2](https://github.com/Mjons/givernyphos/commit/2f693f2))
- **Petrova step 1: `KIND_ASTROPHAGE` primitive plumbing** —
  velocity-shader kind-7 early-return branch with three-body forces
  (gravity to star + gravity to planet + thrust toward planet).
  `NUM_KINDS` 7→8, K matrix 49→64 entries, WGSL struct + PARAMS_BYTES
  bumped to match. WebGPU astrophage branch deferred.
  ([96fbb0c](https://github.com/Mjons/givernyphos/commit/96fbb0c))
- **Docs reorg + new design docs** — moved into
  `docs/{active,reference,archive}/`. New active docs: PETROVA_LINE,
  PASSING_SHIPS, EVENT_SCENES, ANDROMEDA_MERGER, ORACLE_AND_FLAVOURS,
  EVENT_HORIZON_TRANSIT(\_PLAN), PIXEL_THOUGHTS, USER_MOVIES_PLAN,
  CAPTURE_WYSIWYG_PLAN, PERFORMANCE_AUDIT, SHOW_DARK_MATTER_AUDIT.
  ([501aa56](https://github.com/Mjons/givernyphos/commit/501aa56))

---

## How to use this file

When you fix a bug that came from a non-obvious gotcha — especially
one that took >30 minutes to diagnose, or that hit a user — add a
**Bug ledger** entry at the top of this file before committing the
fix. Future-you will thank present-you.

Format:

- **Title:** the rule, in active voice. ("Don't bind `abort` on
  audio elements.")
- **Bug:** what happened, in plain language.
- **Failure mode:** the mechanism, in enough detail that someone
  who didn't see the bug can reason about it.
- **Fix:** link to the commit.
- **Rule:** the durable takeaway, blockquoted, that someone editing
  the affected code should read.

Routine feature work and tuning iterations belong in the
chronological section below the ledger, not in the ledger itself.
The ledger is for traps.
