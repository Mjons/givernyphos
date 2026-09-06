---
status: plan for review
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

Working title **Rewind**. Alternatives: _The Second Time_, _Tide_.
Length 4:20, cut to one track, _The Pair_ (260 s — the title was too
good to pass up: two galaxies).

---

## 1. Why this and not another tour

- **It's ours.** No rendered film can rewind a galaxy merger; a
  simulation can. The engine has `params.reverse`, `params.speed`
  (0–8×) and `paused` today; the films have never touched them.
- **One event, three readings.** Structure instead of variety: the
  viewer learns the collision the first time, sees its anatomy frozen
  the second, and feels it the third.
- **The rewind is honest.** Forward-Euler physics run backwards
  doesn't retrace exactly — the tidal tails fold back _almost_ into
  the discs, and the second collision is not the first. The film's
  last card can say so. "It never quite comes back" is the idea.

## 2. Beat sheet

Scene: `collision`, scenario **Head-on (slow merger)** (the cleanest
"pull apart" on rewind; Antennae prograde is the alternative if the
tails matter more than the separation). Fixed seed so the cut can be
tuned. All times in seconds of film; physics speed is signed (negative
= reversed).

| at  | beat           | scene / shot (new in **bold**)                                                                     | look                                         | physics    |
| --- | -------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------- |
| 0   | title          | REWIND / _a collision, three times_                                                                |                                              |            |
| 0   | approach       | slow-reveal 16 s, tight on galaxy A → wide on both                                                 | ice · speed · trail 0.3 · doppler 0.3        | 1×         |
| 16  | fall           | orbit-ascend 18 s, 70°                                                                             |                                              | 1×         |
| 34  | protagonist    | track-streamer 16 s, subject fastest, **lockSubject**                                              | trail 0.5                                    | 1×         |
| 50  | **freeze**     | **`freeze: true`** on orbit-descend 24 s with **`roll` 0→18°**                                     | trail 0 (crisp), grain 0.02                  | 0 (paused) |
| 74  | **tide turns** | hold-still 8 s + **`time` ramp +1 → −1.5 over 8 s**                                                |                                              | 1 → −1.5   |
| 82  | rewind         | drift-wide 26 s then orbit-ascend 24 s                                                             | **mono** palette · grain 0.12 · vignette 0.7 | −1.5×      |
| 132 | apart          | ascend-out 14 s — the two discs separate below                                                     | mono                                         | −1.5×      |
| 146 | title          | AGAIN (**lower-third style**)                                                                      |                                              |            |
| 146 | forward        | slow-reveal 10 s + **`time` ramp −1.5 → +1.5 over 6 s**                                            | ice returns · trail 0.4                      | −1.5 → 1.5 |
| 156 | **the ride**   | **`follow` program 40 s** on the locked star: real follow-cam, star trail, its little solar system | trail 0.6                                    | 1.5×       |
| 196 | into the cores | vertigo 10 s on the merging cores, **`lensFollow: heaviest`** lens 0.6                             | doppler 0.5                                  | 1.5×       |
| 206 | plunge         | crash-zoom 4 s                                                                                     | lens 0.9                                     | 1.5×       |
| 210 | **jump**       | fade-to-black travel 4 s wrapping a **`prewarm` 1500 steps**                                       |                                              | jump       |
| 214 | time-lapse     | orbit-ascend 30 s, **`time` 6×**                                                                   | ember · mass · trail 0.9 (long exposure)     | 6×         |
| 244 | rest           | ascend-out 16 s, **`time` ramp 6 → 1 over 10 s**; music fade 16 s                                  | ember                                        | 6 → 1      |
| 258 | card           | _it never quite comes back_ · REWIND                                                               |                                              |            |
| 260 | end            |                                                                                                    |                                              |            |

Three readings of one event: **witness** (0–50), **anatomy** (50–146),
**inside** (146–210), then the epilogue in fast time.

## 3. New engine capability (all inside the movie system)

| feature                             | what it does                                                                                                                                                                                                                   | est.    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `time` event                        | `{ kind: "time", speed: ±n, ramp: s }` — eases signed physics speed to the target; crossing zero flips `params.reverse`. `stopMovie` restores speed 1×, forward.                                                               | ~40 LoC |
| `freeze` shot flag                  | Pauses physics for the shot's duration (bullet time); camera programs run as usual.                                                                                                                                            | ~10 LoC |
| `roll` shot param                   | Ramped camera roll (degrees) applied through `camera.up` before `lookAt`; reset at shot end. Works on orbit / hold / drift programs.                                                                                           | ~15 LoC |
| `follow` shot program               | Attaches the real follow-cam to the shot's subject (same finder / lock rules as track-streamer), records the star trail, spawns the solar-system decoration, ticks `updateFollowCam` from the movie loop, releases at the end. | ~35 LoC |
| `lensFollow` shot flag              | Lens centre tracks the heaviest (or chosen) body each frame; strength from `look.lens`.                                                                                                                                        | ~20 LoC |
| `prewarm` event                     | `{ kind: "prewarm", steps }` — synchronous pre-roll (existing kickstart machinery) so a travel can cut to "minutes later".                                                                                                     | ~10 LoC |
| `seed` / `scenario` on scene events | `doSceneSwap(key, { seed, scenario })` so a film is reproducible and tunable shot by shot.                                                                                                                                     | ~10 LoC |
| title `style: "lower"`              | Lower-third variant of the title card (smaller, bottom-left) for chapter cards mid-shot.                                                                                                                                       | ~15 LoC |

About 150 lines plus the film itself (~130 lines of events). Nothing
outside the movie section and the title CSS.

## 4. How it gets reviewed before you watch it

The headless GPU harness can screenshot the film at chosen timestamps
(virtual time), so the first review is a contact strip: 0:02 title,
0:40 protagonist, 1:00 freeze mid-orbit, 1:40 rewind in mono, 2:40 the
ride, 3:26 plunge, 3:50 time-lapse, 4:18 card. You see eight frames
before spending four minutes. Then the real viewing, with the real
music.

Play it: Movie panel → _Rewind_, or `?film=rewind` if we add a URL
flag (worth adding; none exists today).

## 5. Open questions

- **Scenario:** Head-on (clean separation on rewind) or Antennae
  prograde (longer tails, messier rewind)?
- **The rewind's look:** mono with grain (old-film) as planned, or
  ember (time reversed = heat)?
- **Length:** 4:20 on _The Pair_. _Before the Cloth_ (294 s) would allow
  a longer freeze and ride; _Chapel Stone_ (204 s) a tighter cut.
- **The last card's line.**

## 6. Alternatives considered

- _Grown_ — Whirlpool from a featureless disc to arms in four minutes,
  with a star ride along an arm. Beautiful, but it's a tour with one
  scene; no new physics.
- _Three Wells_ — Sagittarius, M87, Event Horizon and a black-hole dive
  to Birth. Already half of _First Light_.
