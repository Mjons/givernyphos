---
status: building (Phase A landed 2026-09-05)
last-updated: 2026-09-05
---

# Interactive NFT — one living scene per token

> **Decisions, 2026-09-05:** Ethereum · 100 tokens · generative series
> (§2.1) with ephemeral holder interaction (§6) · **Petrova out** (§8.1)
> · **music out** (§5.1 b) · density is a **device concern, not a trait**
> (§5.5). Platform on Ethereum still open (fx(hash) vs Highlight vs
> self-hosted, §7); the code hooks all three.
>
> **Phase A is in the tree (uncommitted, unverified in a browser):**
> `vendor/three/` (r160 minified build + the six addons' import
> closure), `tools/build-token.mjs` (copies `index.html` → `dist/token/`,
> rewrites the importmap to the vendored files, strips the Google Fonts
> links, zips), and token mode in `index.html` section 13c: early
> `?token=` / `$fx` / `hl` parse, `deriveTokenRecipe(hash)` with the
> §4 draw order and weights (recipe v1), seeded starfield, scene lock
> via `sceneHoldsTransition`, hotkey gate, Return-to-token / Features /
> Cinematic / Fullscreen bar, `preview=1` (WebGL, `standard`, director
> off, synchronous pre-roll, frozen grain, paused at step K, ready
> signal to `$fx.preview()` / `hl.token.capturePreview()` /
> `token-ready` event), features to `$fx.features()` /
> `hl.token.setTraits()`. Try:
> `http://localhost:8000/index.html?token=0xdeadbeef` and
> `…&preview=1`. Build: `node tools/build-token.mjs`.
>
> The holder-facing side (opening tour, bar, hints, temperament,
> moments) lives in [TOKEN_EXPERIENCE.md](TOKEN_EXPERIENCE.md); its
> slice 1 landed the same day.
>
> **Identity decision (later the same day): self-hosted ERC-721, token
> id is the identity.** `?id=N` (1..100) derives everything from
> `TOKEN_ID_SALT:id`; the family comes from `TOKEN_PLAN`, a table of
> exactly 100 families built from the weights (largest-remainder
> rounding, seeded shuffle, `TOKEN_PLAN_OVERRIDES` to pin ids). So the
> collection's family counts are exact, every seed is unique, and the
> contract's `animation_url` is just `…/index.html?id=N`. The platform
> hash hooks remain for testing. `__tokenPlan()` prints the table.
> The 100-token gate (`render-plan.py`) renders every id and flags
> black / blown / errored stills.

A scratchpad for packaging the simulator as a collectible: every token
is its own scene — its own galaxy, palette, physics recipe and music —
that the holder can open, watch in cinematic mode, orbit, zoom, follow
a star through, and never see the same way twice. The page is the
artwork; the token is the seed.

This doc is exploratory. It covers the four shapes a "unique scene per
token" can take, what the engine already gives us for free, the recipe
a hash turns into, how the page has to be packaged to live inside an
NFT platform's iframe, what a holder is allowed to touch, platform fit,
risks, and a shortlist. Not decided.

---

## 1. The pitch in one paragraph

Generative art on-chain is usually a still or a short loop rendered
from a hash. This engine gives something rarer: a **live physical
system** seeded by the hash. Two holders of the same token, or the same
holder on two evenings, get different performances of the same galaxy —
the initial conditions are the token's identity, the evolution is
chaos, and the viewer can put the camera anywhere. "Never the same
twice" stops being a slogan and becomes the literal physics. The
soundtrack is original and already licensed for exactly this. The
whole thing is one HTML file with no server, which is what an NFT
`animation_url` wants to be.

---

## 2. Four shapes for "each token is its own scene"

### 2.1 Generative series (hash → recipe)

One collection, N tokens. The platform hands the page a hash; a fixed
draw order turns it into a scene family, variant knobs, palette,
channel, post profile, camera pose, music track and rare flags (§4).
This is how fx(hash), Highlight and Art Blocks work, and it is what
the engine's seeded scene factories were built for.

**Pros:** scales to hundreds or thousands with no authoring per token;
rarity falls out of the weights; the tooling exists.
**Cons:** the long tail must be curated — every recipe has to pass the
60-second "doesn't collapse into a blob" rule from CONTRIBUTING.md
without a human looking at it first. §9 has the automated check.

### 2.2 Curated 1/1s

Each token is a hand-tuned scene: the nineteen registered scenes,
the collision scenarios, the Petrova variants, plus new ones authored
for the drop, each with the artist's chosen seed, camera and track.
Ten to forty tokens.

**Pros:** every piece is looked at; the captions and names carry
weight; no dud risk.
**Cons:** doesn't scale; the "your galaxy is unique" story is weaker
when a scene family has one token.

### 2.3 Parametric mint (minter picks inside bounds)

fx(params)-style: the physics come from the hash, but the minter
chooses palette, channel and camera pose from a bounded set before the
mint locks. The holder "explores" before owning.

**Pros:** the exploration becomes part of acquiring the piece; fewer
regrets about palette.
**Cons:** platform-specific; needs a mint-time UI; rarity is muddier.

### 2.4 Living token (on-chain re-seed)

A `reroll(tokenId)` contract function bumps a nonce mixed into the
seed; the holder can reset the universe (rate-limited or burn-to-
reroll). Or, without a contract call, the page mixes the day number
into the seed so every day is a new galaxy.

**Pros:** genuinely dynamic; a reason to come back.
**Cons:** collectors value a stable identity, and the physics already
supplies daily novelty for free. Day-mixing throws that identity away.
Owner re-seed is a v2 idea, not a v1 one.

### 2.5 Recommendation

**Generative series (2.1) with a small curated set of artist proofs
(2.2) and holder exploration that is ephemeral (§6).** The hash is the
identity; interaction never mutates it; "Return to token" is one click
away. Parametric minting (2.3) is worth a look only if the chosen
platform supports it natively. Re-seeding (2.4) waits for v2.

---

## 3. What we already have

Most of the token plumbing exists because of share links and the
director.

- **Seeded scene factories.** `applyScene(key, { seed })` seeds a
  mulberry32 PRNG before `sc.make()`, so the same key + seed rebuilds
  the same initial bodies. `?seed=` and `?scene=` already do this from
  the URL. Petrova's variant pick, the collision scenario pick and every
  body position draw from it.
- **Share state.** `collectShareState()` → `{ v, scene, seed, cam[7],
… }`, deflate-compressed into `?s=`, and `applyShareState()` restores
  it. **A token recipe is a share state whose fields were drawn from a
  hash instead of typed by a user.** The encoder is the serialization
  format; the URL is the `animation_url`.
- **Export.** `exportJSON()` (the `j` key) dumps scene, params, camera,
  seed — the same shape.
- **Capture.** `takeScreenshot(scale)` renders at an arbitrary size
  from the live frame; `maybeCaptureThumbnail` renders a 256×256
  off-screen. The preview pipeline (§5.4) is a flag on top of these.
- **Kickstart.** Scenes can request a pre-roll so structure exists on
  frame one (amortized now; the preview path needs it synchronous).
- **Cinematic director.** The token's default experience — the thing
  the Twitch stream already proves works for hours — is cinematic mode
  on the token's own scene, with moves, moods and pulses but no scene
  changes.
- **Density tiers + watchdog + render scale.** Exactly the levers a
  page needs to survive an iframe on a phone.
- **Music.** Eleven original tracks by the author, CC-BY. No licensing
  work.

Nothing architectural is missing. The work is a token mode, a recipe
function, a packaging step, and a preview path.

---

## 4. The recipe: hash → scene

### 4.1 Derivation

```js
// Fixed draw order. Adding a trait later changes every token that
// follows it in the order, so the order is versioned (recipe.v).
function deriveRecipe(hash /* 0x… from the platform */) {
  const r = mulberry32(fold32(hash)); // reuse the scene PRNG
  const pick = (table) => weightedPick(table, r());
  const recipe = { v: 1, hash };
  recipe.scene = pick(FAMILY_WEIGHTS); // §4.2
  recipe.seed = (r() * 0xffffffff) >>> 0; // body-builder seed
  recipe.variant = pickVariant(recipe.scene, r); // collision scenario, petrova system, …
  recipe.palette = pick(PALETTE_WEIGHTS[recipe.scene]);
  recipe.channel = pick(CHANNEL_WEIGHTS[recipe.scene]);
  recipe.post = perturbPost(SCENES[recipe.scene].post, r); // ±15 % bloom/trail/grain
  recipe.physics = perturbPhysics(SCENES[recipe.scene].physics, r); // spin, doppler, K nudge
  recipe.cam = pickCamera(recipe.scene, r); // one of 3–5 authored poses per family
  recipe.track = pick(TRACK_WEIGHTS);
  recipe.rare = { lens: r() < 0.06, ships: false /* §8.1 */ };
  recipe.density = "lush"; // authored tier; §5.5 clamps per device
  return recipe;
}
```

`fold32` hashes the platform's 256-bit hash down to 32 bits (or use
the platform's own PRNG, `fxrand`, as `r`). Everything downstream —
`applyShareState`, `applyScene`, the tick hooks — is untouched.

### 4.2 Families and weights (sketch)

Weights are a first guess; the contact sheet in §9 tunes them.

| tier      | families                                                                                              | weight each |
| --------- | ----------------------------------------------------------------------------------------------------- | ----------- |
| common    | quiet-drift, dust-storm, coma, lattice, orrery, milky-way, sombrero, horsehead                        | 8           |
| uncommon  | collision (×4 scenarios), whirlpool, cartwheel, antennae, stephans-quintet, bullet-cluster, virgo-m87 | 4           |
| rare      | sagittarius, birth, event-horizon                                                                     | 2           |
| legendary | petrova-line (three systems) — **only if the IP question in §8.1 resolves**                           | 0.5         |

Overlays that read as traits without a new family: `spin` ≠ 0
(vorticity), `doppler` > 0, `lens` on (gravitational lensing on the
heaviest body), high-trail post profile ("long exposure"), `kind`
channel ("false colour").

### 4.3 What is and isn't deterministic

- **Deterministic:** initial bodies, palette, physics params, camera
  pose, post profile, track, traits. Given the recipe these rebuild
  bit-for-bit on any machine.
- **Not deterministic, and the point:** the evolution. Frame N is
  reached by N fixed-dt steps (the sim is step-driven, not wall-clock),
  but GPU float rounding differs per vendor and the system is chaotic,
  so two machines diverge after seconds. The director's moves, drift
  phases and mood timers use `Math.random()` — also intentionally
  un-seeded.
- **Consequence for previews:** the thumbnail is "the token at step K"
  for a small K (§5.4), not "what you will see at minute three".
  Describe it that way in the metadata.
- **Audit needed:** `Math.random()` appears ~90 times. Any call on the
  scene-build path (starfield placement is one; check `makeElliptical`
  helpers, collision scenario defaults, deco sprites) must move to the
  seeded `rng()` in token mode or the initial frame won't reproduce.

### 4.4 Metadata

```json
{
  "name": "Giverny Phos #0412 — Whirlpool · aurora",
  "description": "A grand-design spiral grown live from a cold disc and a passing companion. Seed 0x9a3f…; every viewing is a different performance.",
  "image": "ipfs://…/0412.png",
  "animation_url": "ipfs://…/index.html?token=0x…",
  "attributes": [
    { "trait_type": "Family", "value": "Whirlpool" },
    { "trait_type": "Palette", "value": "aurora" },
    { "trait_type": "Channel", "value": "density" },
    { "trait_type": "Soundtrack", "value": "Eddy" },
    { "trait_type": "Spin", "value": "prograde" },
    { "trait_type": "Lens", "value": "off" },
    { "trait_type": "Bodies", "value": "65k" }
  ]
}
```

Platforms that inject the hash (fx(hash), Highlight) don't need the
`?token=` query; self-hosted contracts do.

---

## 5. Packaging: the token build

### 5.1 One bundle, no network

The page today pulls three.js from unpkg and two font families from
Google Fonts. Inside a platform sandbox both are blocked or forbidden
(and both are single points of failure for a piece meant to last
years). The token build must:

- **Vendor three.js** (`three.module.min.js` ≈ 0.65 MB + the six addons
  ≈ 0.1 MB) next to `index.html` and point the importmap at `./vendor/`.
  This is OPTIMIZATION_PLAN.md F13, no longer optional.
- **Inline or drop the fonts.** Two woff2 subsets are ~60 KB as data
  URIs; or token mode uses the system stack. The HUD is small enough
  that the system stack is fine.
- **Keep `sfx/`** (0.7 MB, gated on user gesture).
- **Music:** the eleven tracks are 129 MB as shipped. Options: (a) one
  track per token, re-encoded at ~96 kbps Opus/AAC ≈ 3–4 MB inside the
  bundle; (b) no music, holders play their own; (c) a separate pinned
  audio CID fetched at runtime — only on platforms that allow external
  fetches (fx(hash) does not). (a) is the one that keeps the piece
  whole.

Budget: ~0.8 MB HTML + ~0.75 MB three + 0.7 MB sfx + one track ≈ 6 MB.
Well inside the bundle caps I know of (tens of MB); verify the chosen
platform's current limit.

The repo's single-file invariant stays for the main app. The token
bundle is a _derived artefact_: a ~30-line script under `tools/` that
copies `index.html`, rewrites the importmap, strips the font `<link>`
and zips with `vendor/`, `sfx/` and the chosen track. No bundler, no
transform of the app code.

### 5.2 Token mode (`?token=` or platform hook present)

- Skip the stargazer intro. No scene browser, no `s` / `1–8` scene
  hotkeys, no movie mode, no hand tracking, no recorder UI. One scene.
- Cinematic director on, restricted to the token's scene (already how
  `SCENES[x].cinematic` gates work; add a `lockScene` flag the picker
  respects).
- Minimal HUD: title/caption, a hotkey hint, **Return to token** (re-
  applies the recipe: bodies, camera, palette), **Features** (the
  attribute list), music play/pause.
- `localStorage` wrapped in try/catch everywhere (mostly already is —
  sandboxed iframes throw).
- Autoplay: audio starts on the first click/key, as now.
- Fullscreen button (iframes need `allow="fullscreen"` from the host;
  most platforms grant it).

### 5.3 Two entry points

```
index.html?token=<hash>                  → live, interactive
index.html?token=<hash>&preview=1        → deterministic still for capture
```

Platform hooks map onto these: fx(hash) exposes `$fx.hash` and calls
`$fx.preview()`; Highlight injects its hash object and waits for a
ready signal; self-hosted contracts put the token id in the URL and
the page folds it.

### 5.4 Preview capture

1. Force WebGL2 (`?nogpu` semantics) so every capture machine takes
   the same code path. Force `standard` density unless the capture
   farm is known to have a GPU.
2. Build the recipe, `applyShareState`, director **off**, camera = the
   recipe's pose, post = the recipe's profile.
3. Pre-roll **synchronously** K substeps at the scene's dt (K = the
   scene's kickstart count, or 180 for scenes without one) so
   structure exists. Small K keeps GPU drift visually negligible.
4. Render one frame at 1200×1200 via the `takeScreenshot` path (no
   trails: the afterimage buffer needs history), then signal ready
   (`$fx.preview()` or the platform's equivalent). The platform
   screenshots the iframe.
5. Same path generates our own contact sheets headlessly (§9).

### 5.5 Device tiers

The recipe stores the **authored** density (`lush` for most families).
The page clamps by device: `lite` when the UA is mobile or there is no
WebGL2 float-render support, `standard` on integrated GPUs, authored
tier otherwise, with the FPS watchdog and the render-scale lever
(OPTIMIZATION_PLAN.md F7) as the runtime safety net. WebGPU and
Barnes-Hut are bonuses when present, never required. The HUD says when
it downgraded ("showing 16k of 65k bodies") so nobody thinks the piece
is broken.

### 5.6 Determinism checklist (token build gate)

- [x] Same id → identical first frame, two independent renders on the
      same machine (2026-09-06, id 7, lush preview: max pixel diff 0).
      Two-machine check still owed.
- [x] No network requests after load — the built bundle loads only its
      vendored files (server log, 2026-09-05).
- [x] No `Math.random()` on the scene-build path in token mode
      (audit 2026-09-06): the starfield is seeded from the hash; the
      remaining calls are the fallback seed (token mode always passes
      one), the music shuffle, camera-drift phases (off in previews,
      cosmetic live) and director picks.
- [ ] Recipe `v` bumped whenever the draw order or a weight table
      changes after the first mint.
- [ ] `index.html` from the bundle works from `file://` (some viewers
      open the folder directly).

---

## 6. What a holder can do

The rule: **interaction is a lens, never a mutation.** Anything the
holder does is ephemeral and one click returns to the token.

| allowed, ephemeral                                                | locked                              |
| ----------------------------------------------------------------- | ----------------------------------- |
| orbit / smooth zoom / pan                                         | scene family, seed, variant         |
| click a star to follow it; `f`; Esc                               | switching scenes                    |
| cinematic on/off; pace `,` / `.`                                  | the recipe's physics preset         |
| cycle palette `c` (a lens on the same physics)                    | permanent palette change (v2, §2.4) |
| roll the dice `r` (perturbation — the universe is chaotic anyway) | anything that writes on-chain       |
| pause / reverse / step                                            |                                     |
| export a PNG `e` — holders make their own captures                |                                     |
| save viewpoints (local, keyed by token)                           |                                     |

"Return to token" re-applies the recipe: bodies rebuilt from the seed,
camera to the pose, palette and post restored. Cheap (it's
`applyShareState`).

Exhibition mode — cinematic, HUD hidden, on a TV — is the Twitch
stream with one scene. It's the mode most holders will actually use.

---

## 7. Platform fit

| platform                      | hash / traits                               | bundle                                     | fit                                                                                                                       |
| ----------------------------- | ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| fx(hash) (Tezos / ETH / Base) | `$fx.hash`, `$fx.features()`, params option | zip upload, no external requests           | **Best fit for 2.1/2.3.** Generative-first audience, preview hook, params for §2.3.                                       |
| Highlight (EVM incl. Base)    | injected hash, traits object                | zip upload                                 | Good fit; cheaper mints; check bundle cap and preview timing.                                                             |
| Art Blocks / Engine           | `tokenData.hash`, on-chain script           | script size-limited, fixed dependency list | Poor fit as-is: the app is far too large for on-chain script storage and pins three r160. A rewrite, not a packaging job. |
| Zora / Manifold / Objkt       | none injected                               | HTML on IPFS                               | Fine for 1/1s (2.2): the recipe is baked into the URL per token. No preview hook — pre-render our own stills.             |
| Self-hosted ERC-721 + Arweave | token id in URL                             | anything                                   | Most control; most work (contract, metadata, mint page). `tokenURI` → `animation_url` = `ar://…/index.html?token=<id>`.   |

Three.js itself has been stored on-chain by other projects (EthFS /
scripty); worth checking which versions exist if a fully on-chain
variant ever matters. Not needed for v1.

---

## 8. Risks

### 8.1 IP: the Petrova Line

PETROVA_LINE.md §8.6 already flags it: the scene is an unmistakable
_Project Hail Mary_ homage, and the Hail Mary ship is a named craft
from a copyrighted novel. Fine as a personal project; **not fine inside
a sold collection.** Options: exclude the family from the token
weights (default), or genericize it (a "photophage migration" with no
ship sightings) and accept it still reads as a reference. Every other
family is an astronomical object or an abstract — clear.

### 8.2 The preview doesn't match the live piece

Chaos plus GPU rounding means minute three never matches the still.
Mitigation is framing, not engineering: the metadata says "the token
at its first moments; every viewing is a performance", and the still is
taken at step K, which does reproduce closely.

### 8.3 Phones

The particle renderer is fill-bound; a 65k-body scene on a 2022 phone
is a slideshow. §5.5's clamps plus render scale handle it, but the
piece on a phone is a smaller galaxy. Say so; don't hide it.

### 8.4 Duds in the long tail

A recipe that collapses to a blob or a black frame is a refund
request. §9's automated degeneracy check runs every candidate recipe
before weights are locked; families that can't pass reliably get
lower weight or authored-only camera/physics ranges.

### 8.5 Longevity

IPFS/Arweave pinning for the bundle; no CDN, no fonts, no server. The
browser API surface used (WebGL2, float render targets, module
scripts, `CompressionStream`) is stable. WebGPU is a bonus path, so
its churn can't break a token.

### 8.6 Size limits and audio

If the platform cap is tighter than expected, the track is the first
thing to drop or shrink. The piece still works silent.

### 8.7 Repo invariants

CONTRIBUTING.md forbids build tools for the app. The token bundle is
produced by a copy-and-zip script, not a transform of `index.html`.
Keep it that way so the main file stays the product.

---

## 9. Contact sheet + degeneracy check (before any mint)

A headless script (Playwright + Chrome, `--use-gl=angle`) that:

1. Generates 500 hashes, derives recipes, tallies trait frequencies
   against the intended rarity.
2. For each recipe: loads `?token=…&preview=1`, captures the still,
   then runs 600 more substeps and reads `computeStats()` — kinetic
   energy, temperature, clumpiness, live count.
3. Flags recipes where clumpiness collapses below a family threshold
   (blob), live count falls (bodies flung out of frame), or the still
   is >95 % black.
4. Writes a contact sheet HTML for eyeballing.

Weights and per-family physics ranges get tuned until the flag rate is
under 1 %, then `recipe.v` locks.

---

## 10. Open questions

- **Platform and chain.** fx(hash) on Base, or Highlight, or self-
  hosted? Decides hook details, bundle cap, and whether §2.3 is on the
  table.
- **Edition size.** 100 curated-ish or 1,000 generative? Changes how
  much §9 tuning matters.
- **Petrova in or out** (§8.1). Default out.
- **Music in the bundle** (§5.1 a/b/c). Default: one track per token.
- **Density as identity.** Is "Bodies: 65k" a trait, or is density
  purely a device concern? Default: authored tier is a trait, device
  clamps are display-only.
- **Ephemeral vs on-chain palette.** Default ephemeral; owner re-seed
  and palette locks are §2.4 v2 material.
- **Artist proofs.** A handful of 1/1s from the existing scene cards
  (the screenshots in `scene_cards/` are already the look) alongside
  the series?

---

## 11. Shortlist (where I'd start)

**Phase A — token build (~2 days).** Vendor three.js and fonts; the
`tools/` copy-and-zip script; `tokenMode` (intro off, scene lock,
minimal HUD, Return-to-token, Features panel); `?token=` parsing plus
one platform hook behind a flag; device-tier clamp; the §4.3
`Math.random` audit on the build path. Deliverable: a bundle that opens
from `file://` with no network and shows one locked scene.

**Phase B — recipe, traits, previews (~2 days).** `deriveRecipe`,
weight tables, `perturbPost/Physics`, authored camera poses per family
(3–5 each), `preview=1` with synchronous pre-roll, metadata attribute
export, the §9 contact-sheet script and a first tuning pass.

**Phase C — platform integration (~1–2 days).** Hash injection and
preview signal for the chosen platform, test mint on a testnet, check
the iframe on desktop Chrome/Safari/Firefox and iOS/Android.

**Phase D — drop content.** Family list and captions, artist proofs,
the description copy that explains "never the same twice", and the
attribution line for the soundtrack.

Phase A is useful on its own even if no drop happens: a self-contained,
network-free build of the app is the same artefact an offline
exhibition or a gallery kiosk wants.
