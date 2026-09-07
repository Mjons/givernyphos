# site/ — the collection site

The cinematic, scroll-driven site that holds the hundred. Static files,
no build; opens from `file://` for review and is served next to the app
(`../index.html`, `../collection.html`, `../ssi_tracks/`). The contract
between the three parts is `docs/active/SITE_PLAN.md`.

| file                                | what                                              |
| ----------------------------------- | ------------------------------------------------- |
| `index.html`, `site.css`, `site.js` | the shell (agent A)                               |
| `audio.js`, `audio.css`             | the soundtrack player, `window.PhosAudio` (B)     |
| `content.js`, `assets/`             | everything the site says and shows (C, this file) |

## `content.js`

A plain script (no modules, no fetch) that sets `window.PHOS_CONTENT`
in exactly the shape of SITE_PLAN.md §2: `appBase`, `site`, `chapters`
(seven, in order: enter, piece, families, hundred, mint, music,
credits), `families` (seventeen, in plan order), `tokens` (all 100, in
id order), `mint`, `tracks` (46) and `credits`. Loads first, before
`audio.js` and `site.js`.

The families' `ids` are the only table in the file; `tokens` and each
family's `count` / `tier` (8–9 common, 4–6 uncommon, 2 rare) are
derived from it at load. The ids are the identity table
(`docs/active/token-metadata-v1.json`, recipe v1, frozen);
`python3 tools/build-site-assets.py --emit-data` prints the same table
from the archive if it ever has to be checked.

### Where each line comes from

| piece                                  | source                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `site.oneLine`, `site.tagline`         | `docs/active/TOKEN_COPY.md` (the one line; "Never the same twice.")                                             |
| `site.live`, `site.x`, `credits.links` | `README.md`                                                                                                     |
| family `name`                          | the Family trait in `docs/active/token-metadata-v1.json`                                                        |
| family `sentence`                      | the family-sentence table in `TOKEN_COPY.md`; collision's names the scenarios the six tokens actually carry     |
| `mint.question / detail / rule`        | `press/MINT_POST.md` — the thread's 6/ and 7/, the long post's last two paragraphs                              |
| `mint.facts`                           | the facts line at the top of `MINT_POST.md` (Ethereum, 100 tokens, self-hosted ERC-721, no music, density)      |
| `tracks`                               | the `TRACKS` array in `../index.html` (title and file; `file` is relative to `appBase + "ssi_tracks/"`)         |
| `credits.license`                      | the license and attribution line in `TOKEN_COPY.md`                                                             |
| `credits.tech`                         | `MINT_POST.md` 4/–5/, `docs/active/RECOVERY_PLAN.md`, the CHANGELOG "Unreleased" bullets (time control, lens)   |
| chapter `kicker` / `title` / `body`    | written for the site in the voice of `MINT_POST.md`; the credits chapter carries `README.md`'s three principles |
| chapter `music`                        | a first mapping from the titles the films use; B owns the final chapter → track map in `audio.js`               |

Facts the copy keeps to: 100 tokens, Ethereum, a self-hosted ERC-721,
no music in the token (the soundtrack is the site's and a separate
CC-BY release), a lighter sky on phones, seventeen families. No fps, no
Petrova, no Hail Mary.

Two interpretations worth knowing: the families chapter says "eight
common, seven uncommon, two rare" — that is the plan's tier rule
applied to the counts (collision, with six, is uncommon); the mint post
draft says "ten / six / two", which does not add up to seventeen. And
the enter poster is the whirlpool family hero (#70) per the plan, while
the live hero frame is #63 — swap `POSTERS` in the build tool to
`("whirlpool", 63)`-style if the still should match the live id.

## `assets/`

Built from the rendered previews by `tools/build-site-assets.py`
(Python 3 + Pillow, nothing else). Inputs:
`dist/metadata/previews/<id4>.png` (100 stills at 1600×900 from
`tools/build-metadata.py`), `dist/metadata/summary.csv` (the `lum`
column), `docs/active/token-metadata-v1.json` (ids per family).

```
python3 tools/build-site-assets.py          # rebuilds everything, prints sizes and the total
python3 tools/build-site-assets.py --emit-data
```

| path                             | size     | what                                                        |
| -------------------------------- | -------- | ----------------------------------------------------------- |
| `families/<scene>.jpg`           | 1600×900 | family hero, q80                                            |
| `families/<scene>-thumb.jpg`     | 640×360  | q80                                                         |
| `tokens/<id4>.jpg`               | 400×225  | all 100, q75                                                |
| `posters/enter.jpg`, `piece.jpg` | 1600×900 | the whirlpool and collision heroes (frames for live scenes) |
| `og.jpg`                         | 1200×630 | text-free centre crop of the Milky Way hero (#34)           |
| `favicon.svg`                    | —        | a filled dot and a thin ring, `#8ab4ff` on transparent      |

Sizes on 2026-09-07: families 5.0 MB (heroes 178–405 KB, thumbs
5–56 KB), tokens 0.84 MB, posters 0.5 MB, og 123 KB — **6.48 MB total**
of the 12 MB budget. The tool exits 1 if a rebuild goes over it, and
lists any file under `assets/` it did not write.

### Representative ids

The rule: the brightest preview of the family by `lum`, unless another
id reads as the family more clearly at a glance (all 100 were looked at
on contact sheets). The two overrides live in `PICKS` in the tool.

| family            | id  | note                                                                                                    |
| ----------------- | --- | ------------------------------------------------------------------------------------------------------- |
| Quiet Drift       | 41  | brightest                                                                                               |
| Dust Storm        | 4   | brightest; the eight attractors count clearly                                                           |
| Coma Cluster      | 14  | brightest; two bright knots and the spread of the cluster                                               |
| Lattice           | 78  | **override** — #1 is brighter but is the crystal after it gives way, a blur; #78 is the crystal         |
| Orrery            | 43  | brightest (all eight read the same at this size: one sun)                                               |
| Milky Way         | 34  | brightest; the barred spiral from above, also the og card                                               |
| Sombrero          | 24  | brightest; edge-on with the bulge                                                                       |
| Horsehead         | 45  | brightest                                                                                               |
| Collision         | 60  | brightest; two galaxies approaching with a tail (grazing flyby)                                         |
| Whirlpool         | 70  | brightest; the spiral with its companion (the live hero, #63, is the dimmest of the four)               |
| Cartwheel         | 54  | brightest; the ring reads                                                                               |
| Antennae          | 98  | brightest, and the only one of the four already torn into arms                                          |
| Stephan's Quintet | 72  | brightest                                                                                               |
| Bullet Cluster    | 26  | brightest; the two clusters with the trailing stream                                                    |
| Virgo · M87       | 53  | **override** — #99 (0.144 vs 0.139) is off-centre with a blown corner; #53 is centred and shows the jet |
| Sagittarius       | 69  | brightest                                                                                               |
| Event Horizon     | 40  | brightest; photon ring and shadow                                                                       |

## Checking `content.js`

Headless Windows Chrome from WSL, the recipe in `tools/README-m9.md`: a
throwaway page outside `site/` that loads
`file:///L:/projects_claudecode/givernyphos/site/content.js`, driven
by `tools/m9-cdp.mjs` under the Windows node with
`--eval "JSON.stringify({f: PHOS_CONTENT.families.length, t: PHOS_CONTENT.tokens.length, tr: PHOS_CONTENT.tracks.length, ch: PHOS_CONTENT.chapters.map(c=>c.key)})"`
— expect `17 / 100 / 46` and the seven keys, zero console errors, and
every `hero`, `thumb`, `poster` and `ogImage` path present on disk.
