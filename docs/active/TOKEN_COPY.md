---
status: draft for approval
last-updated: 2026-09-06
---

# Token copy — collection and per-token text

Drafts for the contract metadata and the marketplace page. Board item
p6-copy. Nothing here is final until you say so; the per-token template
is what `tools/build-metadata.mjs` will fill in.

## Collection

**Name:** Giverny Phos

**One line:** A hundred living galaxies. Each token is a seed; every
viewing is a performance.

**Description (marketplace / contract):**

> Giverny Phos is a gravitational simulation painted as a pointillist
> sky. Each of the hundred tokens is its own universe — a spiral, a
> collision, a ring galaxy, a black hole's disc — grown live in your
> browser from tens of thousands of bodies pulling on one another.
> Nothing is pre-rendered. Open a token and it plays its opening film,
> then hands the camera to a director that keeps watching, or to you:
> orbit, zoom, follow a single star through the field, change the light,
> nudge the whole system and watch it answer. Because the physics is
> chaotic, no two viewings are the same, on any two machines or any two
> evenings. The token is the initial conditions; the evolution is
> yours.
>
> Every token runs from a single self-contained page with no server and
> no network requests, so it will open the same way in ten years.

**What the preview image is (short, for the description's last line):**

> The still image is the token at its first moments. The live piece is
> what it becomes.

**Taglines to choose from:**

- Never the same twice.
- Where celestial mechanics meet impressionist art. _(the project's
  existing line)_
- A garden of light, still growing.

## Per-token template

**Name:** `Giverny Phos #{id} — {Family}` (e.g. _Giverny Phos #63 —
Whirlpool_)

**Description:**

> {Family sentence}. Temperament: {temperament}; its signature shot is a
> {signature}. Seed `{seed hex}`. The still is the token at its first
> moments; the live piece is what it becomes.

**Family sentences** (one per family, from the scene captions and how
the scene actually behaves):

| family                 | sentence                                                                         |
| ---------------------- | -------------------------------------------------------------------------------- |
| Quiet Drift            | A cold, diffuse field settling into threads under its own weight                 |
| Dust Storm             | Eight heavy attractors and a sky of dust learning where to fall                  |
| Coma Cluster           | A cluster of galaxies, each a knot of light, circling a common centre            |
| Lattice                | A crystal of stars, perfectly ordered, and the moment order gives way            |
| Orrery                 | A sun and its planets in clean, patient orbits                                   |
| Milky Way              | A barred spiral with its dust lanes, seen from above the disc                    |
| Sombrero               | An edge-on galaxy with a bright bulge and a dark lane across it                  |
| Horsehead              | A dense stellar nursery, light pressing through dust                             |
| Collision · {scenario} | Two galaxies on a {scenario, lowercase} course — tidal tails, a bridge, a merger |
| Whirlpool              | A grand-design spiral grown live from a cold disc and a passing companion        |
| Cartwheel              | A compact intruder punching through a disc; a ring wave expanding outward        |
| Antennae               | Two spirals torn into long tidal arms as they fall together                      |
| Stephan's Quintet      | A compact group of galaxies interacting all at once                              |
| Bullet Cluster         | Two galaxy clusters passing through each other, gas and halos parting ways       |
| Virgo · M87            | A giant elliptical around a supermassive black hole, with its jet                |
| Sagittarius            | The Galactic Centre: stars swinging close around the black hole                  |
| Event Horizon          | An accretion disc, a photon ring, and the shadow at the centre                   |

**Attributes** (from `tokenTraits`): Token, Family, Temperament,
Signature, Variant, Palette, Channel, Exposure, Spin, Doppler.

## License and attribution line

> Code © the author, MIT; three.js © 2010–2023 three.js authors, MIT.
> The piece runs without music; the project's soundtrack is a separate
> CC-BY release.

## Open questions for you

- Keep the project's existing tagline or lead with "Never the same
  twice"?
- Should the per-token description name the seed, or keep it in the
  Traits panel only?
- "Giverny Phos #63 — Whirlpool" versus "Whirlpool #63 of 100" as the
  token name pattern.
