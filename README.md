<div align="center">

<img src="press/hero.gif" alt="Giverny Phos cinematic mode — three scenes and a transition" width="100%" />

# giverny phos

**Where celestial mechanics meet impressionist art.**

[**Open the live page →**](https://givernyphos.app)

</div>

---

A generative galaxy simulator that turns the cold physics of the cosmos
into living, breathing painting — every star a brushstroke, with its
own soundtrack. **One HTML file. No install. Works in your browser.**

> _The universe is not just a calculation; it is a garden of light
> waiting to be painted._

## Three principles

- **The Phosphene Effect** — capturing the fleeting, dreamlike quality
  of light that exists between observation and imagination.
- **Pointillist Space** — the galaxy as a collection of luminous points,
  where dots converge to create complex, high-fidelity textures.
- **Curated Chaos** — advanced simulation generates the beauty
  automatically, turning the entropy of space into a gallery of
  infinite, exportable art.

## Run it

Two ways, both 10 seconds.

**Hosted:** [givernyphos.app](https://givernyphos.app). Same `index.html`
that lives in this repo, served from GitHub Pages.

**Local:**

```bash
git clone https://github.com/givernyphos/givernyphos
cd givernyphos
open index.html      # macOS
start index.html     # Windows
xdg-open index.html  # Linux
```

There is no build step. There is no `npm install`. The single HTML file
is the product.

**Requirements:** any browser with WebGL2 (Chrome, Edge, Safari 16+,
Firefox). A discrete GPU helps but is not required — 4096 bodies runs
fine on integrated graphics.

## Watch it forever

A 24/7 Twitch stream of cinematic mode runs at
[twitch.tv/givernyphos](https://twitch.tv/givernyphos) with the original
soundtrack. Same browser page. Same physics. Different every second.

## What's inside

- **~3000 lines of plain JavaScript**, no framework, no bundler.
- **Three.js r160** for scene graph, WebGL2 renderer, GPGPU compute,
  bloom and post.
- **Symplectic Euler integrator** — preserves phase-space volume so
  long-running cinematic sessions stay stable.
- **GPU N-body** — softened Newtonian gravity on 4096 bodies, all
  forces computed in a fragment shader.
- **Eight scenes**: galaxy collisions, accretion, filament, halo,
  flock, cluster, dust, and the cinematic director that drifts between
  them.
- **Ten original tracks** in `ssi_tracks/`. CC-BY. Use them.

## Controls

| key       | action                                 |
| --------- | -------------------------------------- |
| `space`   | pause / resume                         |
| `c`       | cycle palette                          |
| `s`       | cycle scene                            |
| `r`       | roll the dice (emergence perturbation) |
| `1`–`8`   | jump to scene by number                |
| `,` / `.` | slower / faster cinematic pacing       |
| `?`       | full hotkey overlay                    |
| `e`       | export current frame as PNG            |
| `j`       | export scene state as JSON             |

Mouse: orbit, pan, scroll-zoom. Click any body to follow it.

## Scenes

Each scene ships with its own physics preset, palette, post-processing
profile, and interaction matrix. The cinematic director picks one,
holds it long enough to breathe, then transitions.

| #   | scene        | what it does                              |
| --- | ------------ | ----------------------------------------- |
| 1   | Filament     | dust gathers along gravitational threads  |
| 2   | Halo         | a single galaxy with a slow halo orbit    |
| 3   | Two Galaxies | mass-on-mass collision, classic           |
| 4   | Accretion    | a black hole eats; jets emerge naturally  |
| 5   | Flock        | rule-based flocking on stellar particles  |
| 6   | Cluster      | tight gravitational binding, stable orbit |
| 7   | Dust         | low-mass field, near-equilibrium drift    |
| 8   | Cinematic    | the director — picks and transitions      |

## Add a scene

The most useful PR you can submit. See [CONTRIBUTING.md](CONTRIBUTING.md).
The contribution funnel is scenes; if you make a good one, it ships.

## Music

`ssi_tracks/` — ten ambient pieces written for this project. All
released CC-BY. Use them in your own work, credit
[@unrealape](https://x.com/unrealape).

## Sister project

[Boltzsidian](boltzsidian/) — same particle universe, but every star
is one of your markdown notes. Local-first. On the `boltzsidian`
branch.

## License

[MIT](LICENSE). Take it, fork it, ship it. If you make something
cool, post it with `#givernyphos` and we'll find each other.

## Made by

[@unrealape](https://x.com/unrealape) on X.
[github.com/givernyphos](https://github.com/givernyphos).
