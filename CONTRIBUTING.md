# Contributing

**Add a scene.** That's the contribution funnel.

A scene is the smallest meaningful unit of this project. New palettes,
new post-processing, new interaction matrices, new music — all of those
are nice, but a new _scene_ is the thing that other people will see and
share. So that's what we ask for.

## How

1. Read **`CLAUDE.md`** — section "Add a scene" walks through the
   factory function, the registry entry, and the keys it needs (`make`,
   `camera`, `palette`, `channel`, `post`, `physics`, `K`, `flock`,
   `radiation`, `tint`).
2. Append your factory + registry entry to `index.html`. Add the key to
   `SCENE_ORDER` so it shows up in the browser and on the hotkey
   overlay.
3. Test locally — `open index.html`, hit `s` until your scene is on
   screen. Watch it for at least 60 seconds in cinematic pacing. If
   the field collapses to a black hole or freezes into a static blob,
   tune the physics or the K matrix and try again.
4. Take one screenshot, 2560×1440, no UI overlay. Save to
   `screenshots/<your-scene>.webp`.
5. Open a PR. Title: "Scene: \<your scene name\>". Body: one
   paragraph on the visual idea, one screenshot.

## What gets merged

- Scenes that look like _something_ — a recognisable visual idea, not
  random parameter sweeps. Title it. If you can't title it, it's not
  done.
- Scenes that hold up for 60+ seconds without going degenerate.
- Scenes whose physics presets stay inside the shipped invariants
  (softened Newtonian, symplectic Euler, K matrix in `[-2, 4]`).

## What doesn't get merged

- Refactors of `index.html`'s structure. The single-file invariant is
  load-bearing — see `CLAUDE.md`.
- Build tools, bundlers, package managers. Plain JS only.
- TypeScript. Plain JS only.
- Anything that needs `npm install` to run.
- New dependencies. Three.js is the only one. Don't add a second.
- "Refactor" PRs that move code around without changing behaviour. The
  file is short enough to live with.

## Other contributions

- **Bugs** — issue with reproduction steps. Include browser, OS, and
  the scene that triggered it.
- **Performance reports** — `?fps` overlay, your GPU, scene name,
  observed framerate.
- **Music** — original tracks under CC-BY are welcome via PR to
  `ssi_tracks/`. Include track title and your handle for credit.

## Code of conduct

Be kind or be banned. Same rule that applies in the Twitch chat.

## Questions

Open an issue. Tag it `question`. Don't email — public Q&A is more
useful than private answers.
