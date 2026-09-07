---
status: built 2026-09-06; reviewed on real-time contact strips (tools/film-strip.mjs); ready to watch — `?film=rewind`
last-updated: 2026-09-06
---

# Rewind — a collision, three times

A new film for movie mode. The six films we have (First Light,
Passage, Homecoming, Odyssey, Web, Pilgrim) tour scenes with the camera
while time runs forward at 1×. This one keeps to a single event and
does what only a live physics engine can: **it freezes the collision at
closest approach and circles it, runs it backwards until the galaxies
come apart, then plays it again from inside, riding one star through
the merger, and finishes in time-lapse on the remnant.**

Length 4:22, cut to one track, _The Pair_ (two galaxies).

Watch it: `file:///L:/projects_claudecode/givernyphos/index.html?intro=0&film=rewind`
(or Movie panel → _Rewind_). If the browser blocks the music because the
page started without a click, start it from the Movie panel instead.

---

## 1. Why this and not another tour

- **It's ours.** No rendered film can rewind a galaxy merger; a
  simulation can. The engine has `params.reverse`, `params.speed`
  (0–8×) and `paused` today; the films had never touched them.
- **One event, three readings.** Structure instead of variety: the
  viewer learns the collision the first time, sees its anatomy frozen
  the second, and feels it the third.
- **The rewind is honest.** Forward-Euler physics run backwards
  doesn't retrace exactly — the tidal tails fold back _almost_ into
  the discs, and the second collision is not the first. The last card
  says so: "it never quite comes back".

## 2. Beat sheet (as built)

Scene: `collision`, scenario **Head-on (slow merger)** with
`initialSep: 280` (the scenario's 500 needed a 2800-step pre-roll to
reach closest approach by 0:50). Seed `0x2ea1d7`. Physics speed is
signed (negative = reversed); "sim s" is elapsed simulation time in
1×-seconds, with the film starting at 0. The nuclei pass through each
other at about sim 40 s.

| at  | beat           | shot                                                                    | look                              | physics  | sim s at end |
| --- | -------------- | ----------------------------------------------------------------------- | --------------------------------- | -------- | ------------ |
| 0   | settle         | `prewarm` 400 steps, `wait` (clock held, music starts after)            |                                   |          | 5            |
| 0   | title          | REWIND / _a collision, three times_                                     |                                   |          |              |
| 0   | approach       | slow-reveal 16 s, tight on the pair → wide                              | ice · speed · trail 0.3           | 1×       | 21           |
| 16  | fall           | orbit-ascend 18 s                                                       |                                   | 1×       | 39           |
| 34  | protagonist    | track-streamer 16 s, subject **bound** (disc star, ring 60), locked     | trail 0.5                         | 1×       | 55           |
| 50  | freeze         | orbit-descend 24 s, `freeze`, `roll` 18°, radius 700, pivot origin      | trail 0 · grain 0.02              | 0        | 55           |
| 74  | tide turns     | hold-still 8 s + `time` ramp +1 → −1 over 8 s                           |                                   | 1 → −1   | 55           |
| 82  | rewind         | drift-wide 26 s, orbit-ascend 24 s (radius 900)                         | mono · grain 0.08 · vignette 0.7  | −1×      | 5            |
| 132 | apart          | ascend-out 14 s                                                         | mono                              | −1×      | −9           |
| 146 | title          | AGAIN (lower third)                                                     |                                   |          |              |
| 146 | forward        | slow-reveal 10 s + `time` ramp −1 → +1.5 over 6 s                       | ice · trail 0.4                   | −1 → 1.5 | −2           |
| 156 | the ride       | `follow` 40 s on the locked star, no solar system                       | trail 0.5                         | 1.5×     | 58           |
| 196 | into the cores | vertigo 10 s, pivot **heaviest**, radius 420, `lensFollow` heaviest 0.6 | doppler 0.5                       | 1.5×     | 73           |
| 206 | plunge         | crash-zoom 4 s, lens 0.9                                                |                                   | 1.5×     | 79           |
| 210 | jump           | fade-to-black 3 s (`clearTrail`), `time` 3× under the black             |                                   | 3×       | 88           |
| 213 | time-lapse     | fade-in 3 s, then orbit-ascend 28 s, pivot heaviest, fov 50, radius 800 | ember · mass · trail 0.9 · lens 0 | 3×       | 181          |
| 244 | rest           | ascend-out 16 s, `time` ramp 3 → 1 over 10 s; music fade 16 s           | ember                             | 3 → 1    | 207          |
| 256 | card           | REWIND / _it never quite comes back_                                    |                                   |          |              |
| 262 | end            |                                                                         |                                   |          |              |

Three readings of one event: **witness** (0–50), **anatomy** (50–146),
**inside** (146–210), then the epilogue in fast time.

## 3. Engine capability added (all inside the movie system)

| feature                              | what it does                                                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time` event                         | `{ kind: "time", speed: ±n, ramp: s }` — eases signed physics speed; crossing zero flips `params.reverse`. `stopMovie` restores the baseline.                                                                               |
| `ramp` event                         | Eases exposure / bloom / grain / vignette / trail / fov over `dur`.                                                                                                                                                         |
| `prewarm` event                      | `{ steps, boost, wait }` — pre-roll through the amortized kickstart. `boost` raises the per-frame step budget; `wait: true` holds the film clock and later same-timestamp events until it lands. Never a synchronous burst. |
| `freeze` shot flag                   | Pauses physics for the shot (bullet time); camera programs run as usual.                                                                                                                                                    |
| `roll` shot param                    | Ramped camera roll (degrees) through `camera.up`, reset at shot end.                                                                                                                                                        |
| `follow` shot program                | The real follow-cam on the shot's subject (same finder / lock rules as track-streamer), ticked from the movie loop; `camera.solarSystem: false` skips the decoration. Silent (no toast, no lock chime).                     |
| `lensFollow` shot flag               | Lens centre tracks the heaviest (or chosen) body each frame; strength from `look.lens`.                                                                                                                                     |
| `subject: "bound"` finder            | A disc star: the alive body with speed ≥ `minSpeed` whose distance from the heaviest body is closest to `ring`. `"fastest"` picks an escapee — the first cut rode a star 2500 units out into black.                         |
| `camera.tgt` / `camera.fov` on shots | Re-centre the pivot ([x, y, z] or a finder name) and pin the field of view before the start pose is sampled. A follow or track shot leaves the pivot on its star; a vertigo leaves the FOV at 105°.                         |
| `camera.offset` on track-streamer    | Chase distance (default 0.18 × the previous radius — 162 after a 900-radius orbit, which framed the star far from the disc).                                                                                                |
| `clearTrail` on travels              | Drops the followed star's trail and the afterimage under a cut.                                                                                                                                                             |
| `seed` / `scenario` / `collision`    | `doSceneSwap(key, { seed, scenario, collision: { initialSep … }, camera })` — reproducible, tunable per film.                                                                                                               |
| title `style: "lower"`               | Lower-third variant of the title card.                                                                                                                                                                                      |
| `?film=<key>`                        | Starts a film at boot (intro skipped).                                                                                                                                                                                      |
| film clock clamp                     | `movie.elapsed` advances at most 0.25 s per frame — a tab switch or GPU stall no longer skips to the end card.                                                                                                              |
| track shots move `controls.target`   | OrbitControls' per-frame re-aim used to undo the track-streamer's `lookAt`.                                                                                                                                                 |

## 4. How it was reviewed

**Virtual time does not run this page's physics.** The first strips
(`--virtual-time-budget`) rendered about one frame per 2–5 s of film,
so the whole film saw ~100 physics steps: the "merger" in those frames
was the 2800-step pre-roll, and the rewind, ride and time-lapse were
never real. `tools/film-strip.mjs` plays the film in real time in
headless Chrome (60 fps on the 4090) and screenshots it when the page's
film clock (`__perfSnapshot().film`) reaches each stamp:

```
python3 <scratchpad>/render-film-rt.py rewind 2 40 62 100 165 200 226 258
```

(the wrapper refreshes `dist/sheet/index.html`, launches Chrome with a
DevTools port, runs the driver under the Windows node and composes the
strip). What the real-time strips found and fixed: the "fastest" subject
was an escapee (→ `bound`); a synchronous 1500-step `prewarm` mid-film
froze the loop and jumped the clock to the end card (→ amortized +
clamp); the vertigo pivoted on the ridden star instead of the cores
(→ `camera.tgt`); the time-lapse inherited the vertigo's 105° FOV
(→ `camera.fov`); 6× time ejected the nuclei from the remnant (→ 3×);
the ride's star trail lingered into the epilogue (→ `clearTrail`).

## 5. Decisions taken (were open questions)

- **Scenario:** Head-on — the cleanest "pull apart" on rewind.
- **The rewind's look:** mono with grain 0.08 and a heavy vignette.
- **Length:** 4:22 on _The Pair_.
- **The last card's line:** _it never quite comes back_.

## 6. Alternatives considered

- _Grown_ — Whirlpool from a featureless disc to arms in four minutes,
  with a star ride along an arm. Beautiful, but it's a tour with one
  scene; no new physics.
- _Three Wells_ — Sagittarius, M87, Event Horizon and a black-hole dive
  to Birth. Already half of _First Light_.
