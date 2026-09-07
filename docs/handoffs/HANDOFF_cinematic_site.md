# Handoff: build a cinematic, music-accompanied site for aeroponicslab.com

Paste everything below this line into a fresh Claude Code session opened
in the Aeroponics Lab repository. It is the method that built the Giverny
Phos collection site (a scroll-driven page with a live hero, seven
chapters, a soundtrack that crossfades as you move, three agents in
parallel, verified headless). Adapt the subject; keep the method.

---

## Mission

Build a cinematic, scroll-driven website for Aeroponics Lab at
`site/` in this repository: a single page that opens with a gate, puts
the lab's most alive thing on screen as the hero, tells the story in a
handful of full-viewport chapters, and carries a soundtrack that changes
with the chapter. Static files only, no build step, no framework, no
dependencies beyond Google Fonts. Every path relative, so the page opens
from a folder (`file://`) for review and deploys anywhere by copying the
folder. The bar is editorial work, not a template: the hero is a
thesis, typography carries the personality, one deliberate motion
moment, restraint everywhere else.

Do the work in this order: discovery, contract, three agents in
parallel, integration, verification, commit. Nobody commits until the
integrator has screenshots with zero console errors.

## 0. Discovery (you, before any code — 20 minutes, not more)

Inventory what exists and write it down in `docs/SITE_PLAN.md` §0:

- The current site and repo: pages, deploy target (Vercel, Netlify, a
  folder), brand marks, fonts already in use, palette if any.
- Assets: photos, videos, time-lapses, diagrams, sensor data, CSVs,
  anything that moves. List sizes and licences.
- Copy: the mission statement, product or experiment descriptions, the
  founder's voice from existing posts. Pull sentences, do not invent
  facts. If a number is not in the repo, it does not go on the page.
- Music: what the owner has the right to play. Only tracks they own or
  have licensed. If nothing exists, the audio agent builds the layer
  against a placeholder folder and the site ships with "Enter silent"
  as the default until tracks arrive.
- **The live hero.** The galaxy site's hero was the simulation itself
  running in a frame. Find the lab's equivalent — the thing that is
  alive: a looping time-lapse of roots in mist, a live sensor panel if
  there is an API or a public CSV, a webcam still that refreshes, or a
  generative mist rendered on a canvas. Choose one and name it in the
  plan. A static photo is the fallback, never the plan.

If a choice would change the whole shape of the site (which hero, which
chapters), ask the owner one message with at most three questions.
Otherwise decide and note the decision.

## 1. The contract (`docs/SITE_PLAN.md`) — write it before spawning anyone

Three agents will build three disjoint sets of files against two
interfaces. The contract is what lets them run in parallel; write it
completely, with example values, before you launch them.

### Files and owners

| owner       | files                                                                               |
| ----------- | ----------------------------------------------------------------------------------- |
| A · shell   | `site/index.html`, `site/site.css`, `site/site.js`                                  |
| B · audio   | `site/audio.js`, `site/audio.css`, `site/audio-test.html`                           |
| C · content | `site/content.js`, `site/assets/**`, `tools/build-site-assets.py`, `site/README.md` |

Load order in `index.html`: `content.js`, `audio.js`, `site.js` — plain
`<script>` tags, **no ES modules** (Chrome refuses module imports from
`file://`, and review happens from a folder).

### Content contract — `window.SITE_CONTENT` (C provides, A consumes)

Define the exact shape with real example values. For a lab the
galaxy's "families" become the lab's units — experiments, systems,
crops, or products — and "the hundred" becomes the gallery. Template:

```js
window.SITE_CONTENT = {
  base: "../",                                    // prefix for anything outside site/
  site: { title, subtitle, oneLine, tagline, author, social, canonical, ogImage: "assets/og.jpg" },
  chapters: [
    { key: "enter",   kicker, title, body: [..], music: "<track title>",
      scene: { kind: "live" | "video" | "canvas" | "poster", url | src, poster: "assets/posters/enter.jpg" } },
    { key: "why",     kicker, title, body: [..], music },   // the argument: what this lab does that others don't
    { key: "systems", kicker, title, body: [..], music },   // the units, as a filmstrip
    { key: "gallery", kicker, title, body: [..], music },   // the grid
    { key: "ask",     kicker, title, body: [..], music },   // the one thing you want the visitor to do
    { key: "music",   kicker, title, body: [..], music },   // optional
    { key: "credits", kicker, title, body: [..], music },
  ],
  units: [ { key, name, count?, tier?, sentence, hero: "assets/units/<key>.jpg", thumb: "…-thumb.jpg", link } ],
  gallery: [ { id, caption, thumb, link } ],
  ask: { question, detail, rule, cta, link, facts: [..] },
  tracks: [ { title, file } ],                    // relative to base + "<music folder>/"
  credits: { author, license, tech: [..], links: [ { label, href } ] },
};
```

Rules for C: copy comes from named sources in the repo (cite the file
per chapter in `site/README.md`); the voice is the owner's, plain and
specific, no hype words; every image is built by
`tools/build-site-assets.py` from originals at fixed sizes (hero
1600×900 q80, thumb 640×360, gallery 400×225 q75, posters 1600×900, OG
1200×630, favicon SVG) and the whole `site/assets` stays under 12 MB.

### Audio contract — `window.SiteAudio` (B provides, A consumes)

```js
SiteAudio.init({ base, chapters: SiteAudio.defaultChapters, volume: 0.6 });
SiteAudio.enter(); // from a user gesture: unlock, fade in 2 s, resolves to state(); never rejects
SiteAudio.setChapter(key); // 300 ms debounce, then 2.5 s equal-power crossfade if the track differs
SiteAudio.setMuted(bool); // persists "<site>.muted" in localStorage — use this for "Enter silent"
SiteAudio.toggleMute(); // → muted
SiteAudio.next(); // next track in the chapter's list
SiteAudio.duck(on); // about -12 dB while a frame is fullscreen or a video with its own sound plays
SiteAudio.playTrack(title); // per-track buttons; counts as a gesture
SiteAudio.state(); // { entered, muted, playing, ducked, chapter, track: { title, file }, reason }
SiteAudio.on("track" | "state", fn);
SiteAudio.defaultChapters; // the chapter → track(s) map, B's decision, exported so A passes it back to init
```

Rules for B (learned the hard way): two `<audio>` elements crossfading
via `volume`; fades based on elapsed time so a background tab does not
break them; **never** listen to the media `abort` event (it fires on
every `src` change and cascades); on `error` ignore `code === 1`; a
failing track skips forward once and then stops with a `reason`, never
loops on failure; a hidden tab keeps playing; a small fixed player pill
(track title, mute, next) that fades with `body.idle`; touch-sized
under 640 px. Chrome's muted-autoplay exemption is video-only, so a
muted `<audio>` still needs the gesture — the gate is not optional.

### The shell brief (A)

- **Gate.** Full-viewport overlay with the masthead, the one line, and
  two buttons: "Enter with sound" and a quieter "Enter silent". Make the
  masthead sit at the same grid position in the gate and in the hero,
  so Enter dissolves the ground and the hero arrives under a title that
  never moves. That is the one motion moment.
- **Hero.** The live thing from discovery, full bleed under the
  masthead, loaded only after Enter. If it is an iframe: set
  `allow="fullscreen *"` **and** `allowfullscreen` (a `file://` frame
  has an opaque origin; the plain `allow="fullscreen"` form silently
  disables fullscreen inside it). Never two live frames alive at once;
  unmount when the chapter leaves the viewport. On touch devices and
  `prefers-reduced-motion`, show the poster with an "Open live" link.
- **Chapters.** Full-viewport sections rendered from
  `SITE_CONTENT.chapters`; reveals on IntersectionObserver; a thin rail
  naming the chapters; entering a chapter calls
  `SiteAudio.setChapter(key)`. Keys: ↓/J, ↑/K, M; `body.idle` after
  5 s without input.
- **Units** as a horizontal filmstrip with no card chrome (hero image,
  name, sentence, a link). **Gallery** as a dense contact sheet.
  **The ask** with the question as the largest line on the page.
  **Music** as a list with per-track play through `SiteAudio.playTrack`.
  **Credits** as a definition list.
- Fonts from Google only; declare fallbacks. Single theme painted
  explicitly (dark or light — decide from the subject; a lab in mist
  and root-white may want a light page, which would be the rarer, more
  memorable choice). Responsive to 390 px. No libraries.
- Avoid the generic look: centered everything, rounded cards with
  accent rails, purple gradients, Inter-as-personality, emoji markers.

### Design plan (write it in the contract, then follow it)

- **Palette:** 4–6 named hex values drawn from the subject's world —
  mist, root, leaf, the greenhouse at night, the lab's steel. Neutrals
  with a bias toward the accent, never flat grey.
- **Type:** a display face with character for chapter titles, a
  complementary body face, a mono face for data (sensor values, dates,
  units) — say which three.
- **Layout:** one sentence. For the galaxy site it was "titles in the
  app's small-caps tracking, chapters as title cards with a hairline
  that draws in, nothing slides".

## 2. Spawn the three agents in one message, in parallel

Use the Agent tool three times in the same message (general-purpose,
fresh context each). Each prompt must contain: the repo path and
branch; "read docs/SITE_PLAN.md first — it is the contract"; the exact
files they own and the instruction to touch nothing else; the note that
the other two agents are writing their files right now, so code against
the contract and guard for missing globals (`SITE_CONTENT` absent →
visible notice; `SiteAudio` absent → the gate still works silently);
the verification recipe (below) with their own profile directory; "do
not commit"; and the report format: what you built, what you verified
with which screenshots, what you interpreted.

When one agent finishes with a detail the others need (the audio agent
exported `setMuted` and `defaultChapters`, for instance), forward it to
the still-running agent with SendMessage rather than fixing it yourself
afterwards.

## 3. Integration (you)

1. Open `site/index.html` headless (recipe below): gate at 1600×900
   and 390×844.
2. Click Enter, wait for the hero, screenshot. Then scroll to every
   chapter and screenshot each, reading `SiteAudio.state().track` to
   confirm the chapter → track handoffs fire and the live frame mounts
   only where it should.
3. Fix what the agents flagged in their reports (there will be two or
   three small things at the seams — a link the other side does not
   parse, a mode the embedded page needs).
4. Commit `site/`, the tools and the plan with a message that says what
   was built and what was verified. Add the site to whatever board or
   README the project keeps.

## 4. Verification recipe (headless Chrome over DevTools)

Real time, not virtual time. Launch Chrome with
`--headless=new --remote-debugging-port=<port> --window-size=WxH` and a
fresh `--user-data-dir` per run; drive it with a small CDP script
(connect to `/json/list`, `Page.navigate`, poll `Runtime.evaluate`,
`Page.captureScreenshot`, `Browser.close`). If the project already has
a driver, use it. Two things that cost an hour each on the galaxy site:

- **Order of operations.** A driver that evaluates _after_ its wait
  screenshots the gate no matter what you click. Poll an expression
  that clicks once and returns true when the target state is reached
  (`window.__site.current() === "ask"`), then settle 2–5 s, then shoot.
- **Audio cannot be proven audible headless**, and synthetic `click()`
  does not count as a gesture. Assert `SiteAudio.state()` transitions;
  use `Input.dispatchMouseEvent` for a real activation, or
  `--autoplay-policy=no-user-gesture-required` for the code paths.

Zero console errors on every run is the gate. Also run once with
`--force-prefers-reduced-motion` (poster mode, no live frame).

## 5. Pitfalls ledger (do not rediscover)

- `file://` blocks ES-module imports and `fetch` of local files: plain
  scripts, data inlined as a script.
- Iframes from `file://`: `allow="fullscreen *"` plus `allowfullscreen`.
- One heavy live frame at a time; posters on touch.
- Muted `<audio>` autoplay is still blocked; the gate is the design.
- Never listen to the media `abort` event; ignore `error.code === 1`.
- Keep `site/assets` small (JPEG heroes ~300 KB, thumbs ~30 KB) and
  the whole site under ~10 MB so it opens from a folder instantly.
- Google Fonts is the only outside request. Say so in the credits.

## 6. Report back to the owner

One message: the local path to open, what each chapter holds, what the
music does, what was verified and how, what remains theirs (music
licences, the live feed's credentials, the deploy).
