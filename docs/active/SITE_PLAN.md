---
status: contract for the collection site build, 2026-09-07 — three agents in parallel, then integration
last-updated: 2026-09-07
---

# The collection site — `site/`

A cinematic, scroll-driven site that holds the hundred: the live
simulation as the hero, the story of the piece, the seventeen families,
the hundred tokens, the mint's question, and the soundtrack playing
throughout. Static files, no build, no dependencies beyond Google Fonts.
It lives in `site/` and is served next to the app (`../index.html`,
`../collection.html`, `../ssi_tracks/`), so every link is relative.

Three agents own three disjoint sets of files and build against the
contracts below; the coordinator integrates and runs the screenshots.
Nobody commits.

## 1. Files and owners

| owner       | files                                                                               |
| ----------- | ----------------------------------------------------------------------------------- |
| A · shell   | `site/index.html`, `site/site.css`, `site/site.js`                                  |
| B · audio   | `site/audio.js`, `site/audio.css`, `site/audio-test.html`                           |
| C · content | `site/content.js`, `site/assets/**`, `tools/build-site-assets.py`, `site/README.md` |

Load order in `site/index.html` (A writes this): `content.js`, then
`audio.js`, then `site.js`. Plain `<script>` tags — **no ES modules**
(Chrome blocks module imports from `file://`, and the site must open
from a folder for review).

## 2. Contract: `window.PHOS_CONTENT` (C provides, A consumes)

```js
window.PHOS_CONTENT = {
  appBase: "../",                       // prefix for index.html, collection.html, ssi_tracks/
  site: {
    title: "Giverny Phos",
    subtitle: "The Hundred",
    oneLine: "A hundred living galaxies. Each token is a seed; every viewing is a performance.",
    tagline: "Never the same twice.",
    author: "@unrealape",
    x: "https://x.com/unrealape",
    live: "https://six-windows-tym8.vercel.app/work/giverny-phos",
    ogImage: "assets/og.jpg",
  },
  chapters: [
    // in order; `key` is what the shell hands to PhosAudio.setChapter
    { key: "enter",    title: "…", kicker: "…", body: ["…"], music: "The Pair",
      scene: { kind: "live", url: "index.html?id=63&gallery=1&intro=0", poster: "assets/posters/enter.jpg" } },
    { key: "piece",    title: "Not a rendering", kicker: "…", body: ["…","…"], music: "…",
      scene: { kind: "live", url: "index.html?film=rewind&intro=0", poster: "assets/posters/piece.jpg" } },
    { key: "families", title: "Seventeen families", kicker: "…", body: ["…"], music: "…" },
    { key: "hundred",  title: "The hundred", kicker: "…", body: ["…"], music: "…" },
    { key: "mint",     title: "The question", kicker: "…", body: ["…"], music: "…" },
    { key: "music",    title: "The soundtrack", kicker: "…", body: ["…"], music: "…" },
    { key: "credits",  title: "…", kicker: "…", body: ["…"], music: "…" },
  ],
  families: [
    // seventeen, in plan order (quiet-drift … event-horizon)
    { scene: "whirlpool", name: "Whirlpool", count: 4, tier: "uncommon",
      sentence: "A grand-design spiral grown live from a cold disc and a passing companion",
      ids: [15, 63, …], hero: "assets/families/whirlpool.jpg", thumb: "assets/families/whirlpool-thumb.jpg" },
  ],
  tokens: [ { id: 1, family: "Lattice", scene: "lattice", thumb: "assets/tokens/0001.jpg" }, … ], // all 100
  mint: {
    question: "Tell me the last time the sky stopped you.",
    detail: "Where you were, what you saw, what it did to you. Two sentences is plenty.",
    rule: "Every comment that answers gets a reply and a place on the list, in order of arrival. When it reaches 100, it drops.",
    cta: "Answer on X", link: "https://x.com/unrealape",
    facts: ["Ethereum", "100 tokens, one hundred seeds, no more", "no music in the token — the soundtrack is this site's"],
  },
  tracks: [ { title: "The Pair", file: "The Pair.mp3" }, … ],   // all 46, relative to appBase + "ssi_tracks/"
  credits: { author: "…", license: "…", tech: ["WebGPU compute", "Barnes–Hut tree", "…"], links: [{label, href}] },
};
```

Copy sources: `press/MINT_POST.md` (the pitch and the ask),
`docs/active/TOKEN_COPY.md` (family sentences, collection description),
`README.md` (the three principles), `docs/active/token-metadata-v1.json`
(ids per family), `dist/metadata/summary.csv` (per-id luminance — pick
bright, representative ids for family heroes).

Assets (C builds with `tools/build-site-assets.py` from
`dist/metadata/previews/*.png`, committed under `site/assets/`):
`families/<scene>.jpg` 1600×900 q80, `families/<scene>-thumb.jpg`
640×360, `tokens/<id4>.jpg` 400×225 q75 (all 100), `posters/<key>.jpg`
1600×900 (frames for chapters that carry a live scene, used on touch
devices and before Enter), `og.jpg` 1200×630, `favicon.svg`. Keep the
whole `site/assets/` under 12 MB.

## 3. Contract: `window.PhosAudio` (B provides, A consumes)

```js
PhosAudio.init({ base: "../ssi_tracks/", chapters: { enter: "The Pair", piece: "Slow Weather", … }, volume: 0.6 });
PhosAudio.enter()            // from a user gesture: unlock, start the current chapter's track (fade-in 2 s). Promise.
PhosAudio.setChapter(key)    // crossfade 2.5 s to that chapter's track if different; before enter() only records it
PhosAudio.toggleMute()       // → muted (boolean); persists in localStorage "phos.site.muted"
PhosAudio.next()             // next track for the current chapter (each chapter may list several)
PhosAudio.duck(on)           // -12 dB while a live frame is fullscreen or a film with its own music plays
PhosAudio.state()            // { entered, muted, playing, chapter, track: { title, file } }
PhosAudio.on("track" | "state", fn)
```

Rules from the bug ledger (CHANGELOG.md): never listen to the media
`abort` event; on `error` ignore `code === 1`; a track that fails skips
forward once and never loops on failure. Two `<audio>` elements
crossfading, gain via `volume` (no AudioContext needed, but allowed).
The player UI (`audio.css`): a small fixed pill, bottom-left — track
title in small caps, mute, next — that fades with the shell's idle
state (`body.idle`). Mapping of chapters to tracks is B's call from the
titles the films already use: The Pair, Bough Bend, Slow Weather,
Inwards, Lamplighter, Cathedral, Small, Drift, Filament, The Sisters,
Long Shadow, Threshold Again, The Edge of Day, The Sustain, Long Exhale.

## 4. The shell (A)

- **Gate.** Before anything plays: a full-viewport overlay — title in
  the app's small-caps tracking, the one line, "Enter with sound" and a
  quieter "Enter silent". Enter calls `PhosAudio.enter()` (or
  `toggleMute` first), then reveals the hero. Only after Enter does the
  first live frame load (the simulation is heavy; never two live frames
  at once — unload a chapter's frame when it leaves the viewport).
- **Hero.** The live simulation in gallery mode (`chapters[0].scene`)
  full-bleed under the title; on touch devices or `prefers-reduced-
motion`, the poster with an "Open live" link instead.
- **Chapters.** Full-viewport panels, scroll-driven reveals
  (IntersectionObserver), a thin progress rail on the right naming the
  chapters; entering a chapter calls `PhosAudio.setChapter(key)`.
- **Families.** A horizontal filmstrip of the seventeen (hero image,
  name, count, tier, sentence); click opens the family's first id live
  (`appBase + "index.html?id=" + ids[0]`) in a new tab, with a second
  link to the collection viewer filtered by family (`collection.html`).
- **The hundred.** All 100 thumbs as a slow marquee or a dense grid,
  linking to `collection.html#id=N`.
- **Mint.** The question, the rule, the facts, the CTA.
- **Music.** The track list with per-track play (through PhosAudio).
- **Credits.** Author, license, the tech in one line each.
- Typography: display "Cormorant Garamond" (300 / 400 italic) for
  chapter titles, "Inter" body, "IBM Plex Mono" for data; the app's
  small-caps wide-tracked labels. Palette: ground `#07090f`, ink
  `#e6eaf5`, muted `#8b93ad`, line `#1c2338`, accent `#8ab4ff`.
  Single dark theme, painted explicitly. Responsive to 390 px.
  `prefers-reduced-motion` respected. No libraries.
- Title `<title>Giverny Phos · The Hundred</title>`, Open Graph tags from
  `site.ogImage`.

## 5. Verification (each agent, before reporting)

Headless Windows Chrome from WSL — recipe in `tools/README-m9.md`,
driver `tools/m9-cdp.mjs` (run with the Windows node,
`/mnt/c/Program Files/nodejs/node.exe`, screenshot + console). Open
`file:///L:/projects_claudecode/givernyphos/site/index.html` (or your
test page), check zero console errors, screenshot at 1600×900 and
390×844. Audio cannot be heard headless: assert `PhosAudio.state()`
transitions instead. Live iframes from `file://` need
`allow="fullscreen *"` (ledger).

## 6. Integration (coordinator)

Wire the three, screenshot desktop and phone at the gate, hero, families,
mint; check the console; confirm the chapter → track mapping fires;
commit `site/` and the tools; add the site to the launch board (p6-page)
and the docs index.
