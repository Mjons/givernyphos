---
status: building (slice 1 landed 2026-09-05)
last-updated: 2026-09-05
---

# Token experience — what a holder actually gets

[INTERACTIVE_NFT.md](INTERACTIVE_NFT.md) covers packaging and the
recipe. This doc is the holder-facing side: the first sixty seconds,
what the buttons do, what makes one token feel different from the
next, and the order to build it in. Phase A shipped a locked scene
with a bar of plumbing buttons; the honest verdict was "very simple."
This is the plan to fix that.

Principle from the NFT doc still holds: **interaction is a lens, never
a mutation.** Everything below is ephemeral; Return rebuilds the
token from its seed.

---

## 1. The first sixty seconds: the tour

Every token opens with a generated film built from its recipe, played
by the existing movie system (`startMovie`, shot programs, the
`#film-title` card). No scene event — the token's scene is already
loaded — so the seed is never re-rolled.

```
 0 s   title card: FAMILY NAME / palette · channel · #hash6
 0 s   slow-reveal   16 s   tight on the core → the authored pose
16 s   orbit         14 s   ascend or descend, seeded
30 s   track         12 s   chase the fastest body (dynamic families)
       vertigo        8 s   dolly-zoom on the well (gravity-well families)
       hold + drift  12 s   (calm families)
42 s   push-in        8 s   settle back toward the scene
50 s   end → director takes over in cinematic mode
```

Three templates, picked by family:

| template     | families                                                                       | signature shot |
| ------------ | ------------------------------------------------------------------------------ | -------------- |
| calm         | quiet-drift, dust-storm, coma, lattice, orrery, sombrero, horsehead, milky-way | hold + drift   |
| dynamic      | collision, whirlpool, cartwheel, antennae, stephans-quintet, bullet-cluster    | track-streamer |
| gravity-well | event-horizon, sagittarius, virgo-m87, birth                                   | vertigo        |

Seeded from `hash:tour`: orbit direction, orbit angle, reveal
tightness, hold length. Any click, key or wheel skips the tour and
hands over. Replayable from the bar.

## 2. The bar (slice 1)

| button    | does                                                                     |
| --------- | ------------------------------------------------------------------------ |
| Tour      | replay the opening film                                                  |
| Cinematic | toggle the director; when off, the hint line explains the free camera    |
| Follow    | attach the chase camera to the fastest body (toggle; Esc releases)       |
| Lens      | cycle the palette — visibly different, still the same physics            |
| Moment    | roll the dice: a small velocity kick to every body, the universe answers |
| Return    | rebuild the token from its seed, camera back to the authored pose        |
| Traits    | the attribute list + seed                                                |
| Capture   | save a 2× PNG                                                            |
| ⛶         | fullscreen                                                               |

A one-line hint under the bar changes with state: during the tour
"click anywhere to skip"; cinematic on "watching — drag or scroll to
take over · R returns"; free camera "drag to orbit · scroll to zoom ·
click a star to follow". Bar and HUD fade after 5 s idle and come
back on any input, so exhibition mode is just "don't touch it."

## 3. What makes tokens feel different (beyond the recipe)

- **Temperament** — the director flavour as a trait: drift (slow,
  contemplative), pulse (restless, snappy moves), long-shadow
  (hold-and-stare). Cheap: one weighted draw, `director.flavour` set
  at boot. Reads immediately in how the camera behaves.
- **Signature shot** — the tour template's middle shot is already
  family-driven; expose it as a trait line ("Signature: vertigo").
- **Moments** — rare, seeded, timed events inside a session: a lens
  flash on the heaviest body, a long-exposure minute, a spin reversal.
  The director's accents and pulses exist; a token-mode scheduler
  with a per-token cadence is ~60 LoC.
- **Named subject** — the tour's tracked body becomes "the token's
  star": Follow defaults to it, Traits names its index.

## 4. Later

- **Mobile**: tap-to-toggle the bar, pinch is already OrbitControls,
  a portrait-friendly title card.
- **Sound**: the sfx bundle is in the build; the director's audio
  cues on moves could return as an opt-in "sound" button. Music stays
  out by decision.
- **Share a view**: copy a share link of the current camera + palette
  (the encoder exists) — holders trade viewpoints, not tokens.
- **Gallery mode**: `?gallery=1` — no bar, no HUD, tour every N
  minutes, for a TV.

## 4b. What the first contact sheet taught (2026-09-05)

Ten hashes rendered headless on the GPU at lush and standard
(`screenshots/token-sheet-2026-09-05.png`, top lush / bottom standard):

- **Sprite sizes were absolute pixels.** A 1200×750 canvas turned every
  black-hole scene into a white frame; the same token at 2560×1440
  matched its scene card. Fixed globally: sizes scale with the
  drawing-buffer height against a 1440 px reference. Iframes and 2×
  captures now keep the composition.
- **Brightness ∝ body count.** Lush is ~4× brighter than standard on
  dense scenes. Token mode applies `√(65536/N)` gain so a laptop and a
  4090 see the same picture; Quiet Drift's diffuse core still runs
  brighter at lush than the gain predicts (note, not fixed).
- **A drawn channel can kill a family.** `density` on a diffuse scene
  and `kind` on single-kind stars both map to the darkest palette stop.
  Channel is authored now; the trait line still reports it.
- **Pre-roll is per family.** Rings, tails and arms need 500–2400
  substeps before the still says anything; Birth's beauty is the first
  120 and it is body-count-sensitive either way, so it left the pool.
- **The camera nudge must not move in.** Closer than authored on a
  bright core blows the frame; gravity-well scenes are composed around
  the shadow and get yaw only.
- Edge streaks from the chromatic-aberration pass at bright borders are
  pre-existing (visible on the authored cards too); worth a clamp later.

## 5. Order

1. **Slice 1 (landed):** tour generator + three templates, skip-on-
   input, handover to the director, the bar above, hint line, idle
   fade.
2. **Identity layer (landed 2026-09-05):** Temperament trait
   (drift 50 % · long-shadow 30 % · pulse 20 %, sets `director.flavour`,
   rotation off); Signature trait (drift / chase / vertigo from the tour
   template); Moments scheduler (first 2.5–5 min in, then every 4–9
   min: a 40 s long exposure, an 18 s lens on the heaviest body, or a
   30 s spin — deferred while a film plays or the holder drives,
   restored to the recipe after, named in the hint line); the token's
   star (the body the tour tracked) is Follow's first choice and a
   Traits row. Recipe draw order changed (no mint yet, so still v1).
3. Mobile pass; gallery mode.
