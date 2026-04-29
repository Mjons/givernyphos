# User movies — design exploration

The existing "movie mode" is film _playback_ — a chase-cam follows a
recorded film. There's also a basic WebM recorder (canvas.captureStream
under [CAPTURE_WYSIWYG_PLAN.md](CAPTURE_WYSIWYG_PLAN.md) — captures
whatever is currently on screen). What's missing: a path for **users to
author their own movies** — to deliberately construct a multi-shot
piece over time, save it, refine it, and export it as a single film.

This doc explores what that authoring layer could be. Not a decided
design — three interpretations of "build scenes over time", what each
costs, what users get out of each, and where I'd start.

---

## 1. The pitch in one paragraph

The simulation is a generative field. Cinematic mode lets the auto-director compose at it. Capture lets you keep the moment that landed. What's missing is the seam where a user can decide _"I want a 90-second piece. Open on quiet drift, push into the cluster, cut to a collision, settle on the aftermath."_ — and then build that. **User movies = composition with persistence.** Not a single recording. A piece you come back to, refine, re-shoot, finalize.

---

## 2. What we have today

- **Single-frame screenshot** — `takeScreenshot(scale)`, `exportPNG()`.
  Pixel-fidelity verified by [CAPTURE_WYSIWYG_PLAN.md](CAPTURE_WYSIWYG_PLAN.md).
- **Live WebM recorder** — `canvas.captureStream(60)` → MediaRecorder
  → WebM blob. Records the canvas as it appears. No multi-shot, no
  editing, no scene authoring.
- **Movie mode (existing)** — film _playback_. Replays a saved film
  as a chase-cam tour. Subject finder, chase-cam math, frame
  streaming all already work ([PHASE1_STEP7_HANDOFF.md §1.4](PHASE1_STEP7_HANDOFF.md#L70-L75)).
- **Camera moves** — director's library of moves (`orbit`, `counter`,
  `pan`, `dolly`, `tilt`, `fov`, `hold`) is the natural vocabulary
  for shot-building. Today only the director invokes them.
- **Bookmarks (proposed)** — [FUTURE_IDEAS.md](FUTURE_IDEAS.md) sketches
  scene+camera presets. A bookmark is a _shot starting state_.
- **Cinematic director** — already runs a state machine that
  schedules dwells, transitions, moves. Most of a movie engine is
  already there; it's just director-driven, not user-driven.

So the building blocks are mostly already on the floor. The missing
piece is the authoring layer: data model + UI + persistence.

---

## 3. The author-vs-recorder distinction

Users do two different things when "making a movie":

- **Recording** — capturing what's happening _right now_. A live take.
  Output: a clip.
- **Authoring** — arranging clips into a sequence. Pick which
  scenes, which moves, which order, which durations.
  Output: a movie.

A pure recorder is what we have today (WebM). A pure authoring tool
would let you build a movie _without ever pressing record_ —
specifying shot 1 = "milky-way, 12s, slow orbit", shot 2 = "collision,
8s, pull-back" etc., and the engine renders. Real users want the
hybrid: record takes, then arrange.

The doc focuses on **authoring with optional recording** — you can
record live takes, but the unit of work is the _movie_ (a saved,
versioned sequence of shots), not the _clip_.

---

## 4. Three interpretations

In increasing ambition.

### A. One-shot recorder, polished UX (cheapest, ships first)

Extend the existing WebM recorder with a real UI:

- A "Record" button on the rail / Capture panel.
- Record duration shown live; max duration cap (configurable).
- Stop button finalises and offers download / save-to-bookmarks.
- A few quality presets: 1080p/30, 1080p/60, 4K/30.
- Optional: "trim" UI before saving (in/out points on the timeline).

That's it. No multi-shot, no scene switching during record, no
authoring. Just a polished version of "I want what's on screen
captured, with controls." Probably 80% of users want only this.

**Effort:** ~1 day. Most code exists; this is UI and packaging.

### B. Take-and-stitch authoring (the real "user movies" feature)

A user can:

1. **Record a take** — hit record; while recording, you can pan the
   camera, change physics, trigger accents. Stop when you have a
   keeper. Take is auto-named with timestamp + scene; saved to a
   takes library.
2. **Save shots** — from a take, mark in/out points. Save as a
   _shot_ with metadata (scene, density, palette, mood, camera
   path).
3. **Arrange shots into a movie** — drag-drop / list-reorder UI.
   Each shot has a duration and an optional crossfade-to-next.
4. **Render the movie** — engine reproduces the shot sequence
   end-to-end, captures to a single WebM. Either by re-running
   each shot's setup state and sim from a deterministic seed, or
   by stitching the original take WebMs.

The data model:

```js
const movie = {
  id: "midnight-cluster",
  title: "Midnight Cluster",
  shots: [
    { takeId: "tk_42", inSec: 12, outSec: 35, fadeOutMs: 1500 },
    { takeId: "tk_47", inSec: 0, outSec: 60, fadeOutMs: 0 },
    { takeId: "tk_51", inSec: 8, outSec: 24, fadeOutMs: 800 },
  ],
  totalSec: 100, // computed
  created: "2026-04-28T10:30Z",
  modified: "2026-04-28T11:15Z",
};

const take = {
  id: "tk_42",
  webmBlob: Blob,
  durationSec: 60,
  startedAt: "2026-04-28T10:00Z",
  scene: "milky-way",
  density: "standard",
  flavour: "drift",
  // Snapshot of camera / physics at start, so re-render is possible
  startState: { cameraPos: [...], cameraTgt: [...], fov: 55, /* … */ },
  // Optional: log of every input during the take, for re-render
  inputLog: [{ t: 0.5, kind: "scene", value: "dust-storm" }, …],
};
```

Two fundamental rendering strategies, with very different
implications:

- **Take-stitching** (cheap, lossy): each take is a recorded WebM.
  The movie is decoded → trimmed → re-encoded as a single output.
  Doesn't re-render anything. Lower visual quality (re-encode is
  generation loss) but fast and works for any take. **Recommended
  for v1.**
- **Re-render** (clean, deterministic): each take has an
  `inputLog` of every user input. The renderer plays back the log
  against the same scene seed, captures fresh. Pixel-perfect, no
  generation loss, but requires deterministic playback (which
  means seeded RNG, no audio reactivity that comes from live
  input, etc.). **Defer.**

**Effort:** ~1 week. Data model + UI (timeline / shot list) +
persistence + render pipeline.

### C. Live performance + replay (most ambitious)

Treat the simulation as an instrument. The user _performs_ —
switching scenes, panning, triggering events in real time — and
every input is recorded as a timestamped log. Performance can be
replayed deterministically; new performances can be re-recorded
on top, like a music DAW.

```js
const performance = {
  id: "perf_001",
  durationSec: 240,
  inputLog: [
    { t: 0,    kind: "scene", value: "quiet-drift" },
    { t: 12.5, kind: "camera", value: { pos: [...], tgt: [...] } },
    { t: 28.0, kind: "scene", value: "milky-way" },
    { t: 45.2, kind: "accent", value: "bloom-pulse" },
    // …
  ],
  seed: 0xDEADBEEF, // for reproducibility
  density: "standard",
};
```

To re-render: load seed + density, play back inputLog at correct
timestamps, capture frames. Determinism requires:

- Seeded RNG everywhere (today partially seeded, partially not).
- No floating-point drift across runs (mostly OK with same
  hardware/driver; unreliable across).
- Audio reactivity — has to be either disabled in playback, or
  the audio source has to be re-driven from a recorded track.

The killer feature: **non-destructive editing**. You can replay,
splice, overdub a section, change the camera but keep the scene
sequence — all without re-shooting. Like Logic for visuals.

**Effort:** 2-4 weeks. Mostly the determinism cleanup; the
record/playback is straightforward once the foundation is solid.

---

## 5. Recommendation: ship A, design for B, hold C in reserve

A is small enough that it's worth doing standalone. It addresses
80% of the practical "I want to keep this moment" need, and it
ships now.

B is the real user-movies feature. It's where authoring lives. The
take-stitching variant is the smallest interesting version (cheap
re-encode, no determinism work). Even the take-stitching version
delivers persistence, multi-shot, save/edit/export — basically
everything users mean by "make a movie."

C is the dream. Defer until B has surfaced what users actually want.

---

## 6. Data model (proposed for B)

Three persisted entities:

```
takes/      → { id, blob (WebM), metadata (scene/density/state) }
shots/      → { id, takeId, in, out, transition, name, thumbnail }
movies/     → { id, title, shots: [shotId, ...], totalSec, modified }
```

Storage:

- **Takes** are large (~5-50 MB each). Store in IndexedDB, not
  localStorage.
- **Shots** are small (just metadata + reference to takeId). IndexedDB
  with `take` foreign key.
- **Movies** are tiny (just shot ID lists). localStorage is fine,
  with a single `universeSim.movies` key holding the whole list.

Auto-thumbnail generation: when a shot is created, render one frame
at the in-point as a JPEG data URL. Show in the shot list.

---

## 7. UI sketch

A new rail panel: **Movies** (`M` key already taken by movie playback;
maybe `Shift+M`).

Three tabs (or vertical sections):

### 7.1 Takes

- A list of recorded takes. Each row: thumbnail, scene name,
  duration, timestamp, [delete] button.
- Click a take → opens it in a "scrubber" view: the WebM with
  in/out point handles. Drag handles to mark a shot. "Save shot"
  button.

### 7.2 Shots

- Library of saved shots. Drag to reorder, drag to a movie, or
  build a new movie.

### 7.3 Movies

- List of movies (title, shot count, duration, thumbnail of first
  shot). Each row expands to show the ordered shot list. Reorder
  by drag. "Render" button → starts the export pipeline → saves
  WebM.

The recording controls go in the Capture panel (existing) or as a
floating widget when active. Don't mix recording into the Movies
panel — recording is _generating_, the Movies panel is _arranging_.

---

## 8. Recording controls (extends Capture panel)

While not recording:

- Big "Record" button.
- Quality preset selector (1080p/30 by default).
- Max duration cap (default 5 min, hard cap 30 min for memory).

While recording:

- Time elapsed.
- "Stop" button.
- "Mark shot" — drops a marker at the current time. After stop,
  markers become candidate in/out points in the take scrubber.
- Optionally: a small recording indicator persists across rail panels.

After stop:

- Take added to the takes library.
- Toast: "Take saved (45s)".

---

## 9. Building over time — the iterative workflow

The "build scenes over time" framing implies users come back to a
movie repeatedly. The system should support:

1. **Project autosave.** Every shot rearrangement, every shot save,
   immediately persisted. Closing the tab doesn't lose work.
2. **Take retention by default.** Once a take exists, it's not
   deleted unless the user explicitly does so. They can build new
   shots from old takes weeks later.
3. **No "session" concept.** The movie is the unit of work, and a
   movie persists across sessions automatically. Reopening the
   tool, opening a movie, the timeline is exactly as you left it.
4. **Lightweight versioning.** When the user clicks "Render", the
   current state of the movie is snapshotted alongside the
   exported WebM. If they later edit and re-render, both
   versions exist. Optional but valuable for users who treat this
   as serious work.
5. **Import / export movie definitions.** A movie is a small JSON
   blob (just shot IDs + metadata). Export → JSON file. Import →
   another tab, another machine, restores the movie _if the
   takes are present_. (Takes don't travel with the movie file
   because of size; ships separately if at all.)

This is what makes it "movies" rather than "recordings" — the
artifact persists, accumulates, and refines. A user might spend
weeks accumulating takes before assembling a 3-minute piece.

---

## 10. Camera authoring (free-form vs scripted)

Two modes for the camera during a take:

- **Free-form** — user has OrbitControls. Camera does whatever the
  user does. Intuitive, but moves are jagged unless the user is
  skilled.
- **Scripted** — user picks a director-style move (orbit, dolly,
  pan) at record start; engine performs the move smoothly during
  the take. Like the director, but on demand.

Recommend **both**, with a toggle. Free-form is the default for
the casual user; scripted gives the power user clean cinematic
moves without manual cursor control.

A third option, deferred: **keypose-driven** — user marks several
camera positions in advance, hits record, and the engine
interpolates smoothly through them. This is the high-end path.
Defer until A+B prove demand.

---

## 11. Render pipeline (the export step)

Two paths, depending on which interpretation we shipped:

### 11.1 Take-stitching (B-track)

- Decode each shot's WebM at its in/out range.
- Concatenate via MediaSource or a re-encode pass.
- Apply crossfade where requested (alpha-mix the boundary frames).
- Write final WebM blob → trigger download.

Cost: real time during decode (≈1× length of movie), generation
loss from re-encode (mitigated by high bitrate).

### 11.2 Re-render (C-track)

- For each shot's take, load its `startState` + `seed` + density.
- Run the sim from that state, applying the take's `inputLog` at
  correct timestamps.
- Capture each frame to the output stream.
- Apply scene transitions between shots.

Cost: faster than real time if the sim doesn't bottleneck (most
scenes can run >60fps even at high density). Pixel-perfect.

For v1, **stitching is good enough**. Most users won't perceive
generation loss in a casual export. Re-render is the polish path.

---

## 12. Failure modes

### Memory pressure with long takes

A 30-minute 1080p WebM at decent bitrate is ~500MB. IndexedDB can
handle it, but loading 5 takes at once into the scrubber can hurt
on weaker machines. Mitigation: limit how many decoded videos can
be open simultaneously (1, plus thumbnails for the rest).

### Density mid-record

If a user changes density during recording, the scene's body count
changes, and any in-flight WebM keeps recording — but a re-render
(C-track) can't reproduce the change cleanly across density
boundaries. Mitigation: lock density at record start; show a
warning if density change is attempted mid-record.

### Browser crashes mid-record

The user just lost their take. Mitigation: write WebM chunks to
IndexedDB every N seconds during recording (MediaRecorder's
`ondataavailable` already provides chunked output). On reload,
the partial take is recoverable.

### Audio sync

WebM captures the canvas only. If the user's recording while
audio plays from the SFX/music channels, the audio is _not_ in
the file. Mitigation (for B): also record `audioReact` data per
frame, and when rendering, re-mix the audio from the original
sources at the same timestamps. Heavier; defer.

### Determinism in re-render path

Mentioned in §4C. Today many things use `Math.random()` directly,
including scene factories. Re-render needs them seeded. This is
a real refactor — defer until C is on the table.

### Storage limits

IndexedDB quota varies by browser (often ~10-50% of disk). Heavy
users will hit this. Mitigation: clear UI to delete old takes;
warning when nearing quota.

---

## 13. Phasing

### Phase 1 — Polished single-shot recorder (ships standalone)

- Real UI in Capture panel (record, stop, quality preset, time
  display).
- Save take to IndexedDB.
- Takes library panel (basic list, delete).
- Download as WebM.
- **Success:** user can record a clean 60-second clip, save it,
  re-download it later. Closing the tab doesn't lose it.
- ~1 day.

### Phase 2 — Shots and the scrubber

- After-record scrubber with in/out points.
- Save sub-clip from a take as a "shot."
- Shots library, basic list, delete.
- **Success:** from one 5-minute take, user marks 4 keepers and
  saves them as discrete shots.
- ~2 days.

### Phase 3 — Movies and the timeline

- Movies panel (list of movies).
- Drag-drop shot ordering inside a movie.
- Render → export single WebM (stitched).
- Crossfade between shots (1s default).
- **Success:** user assembles 5 shots into a 90-second movie,
  hits render, gets a single WebM file.
- ~3 days.

### Phase 4 — Refinement

- Auto-thumbnails for shots.
- Movie versioning (snapshot on render).
- Free-form vs scripted camera toggle during recording.
- Better in/out scrubbing (frame-accurate).
- Recovery from crashed sessions (chunked IndexedDB writes).
- ~3 days.

### Phase 5 — Re-render + determinism (optional)

- inputLog recording during takes.
- Seeded RNG everywhere.
- Re-render pipeline.
- ~1-2 weeks.

### Phase 6 — Performance mode (optional)

- Live record-arm + scene control.
- Overdub sections.
- ~1-2 weeks.

---

## 14. What this is not

- **Not a video editor.** No transitions library beyond crossfade.
  No effects layer beyond what the engine already does. No audio
  editing. Users wanting those things use DaVinci or Premiere on
  the exported WebMs.
- **Not a streaming director.** The 24/7 stream uses cinematic
  mode. User movies are deliberate, finite pieces.
- **Not a replacement for the existing director.** The director
  composes generative live; user movies compose deliberate
  finite. They coexist.
- **Not a 3D scene editor.** Users can't manually place bodies,
  rewire physics, etc. The sim is what it is; users compose
  _around_ it.

---

## 15. Recommendation — what to ship first

**Phase 1 standalone**, then **see how users use it.** Many will
stop at phase 1 — they just want to keep moments. The leap to
phase 2-3 is real authoring work; it's worth letting actual usage
data drive whether to invest there.

If phase 1 lands well and users start asking _"can I record
multiple takes and pick the best ones?"_ — that's the signal to
build phase 2. If they ask _"can I assemble multiple takes into
one piece?"_ — that's phase 3.

Skip C entirely unless someone specifically asks for non-destructive
editing. It's a major engine refactor for a feature most users
won't use.

The "build scenes over time" framing is real, and the persistence
model in §9 is what makes it feel like a creative tool rather
than a screenshot button. Even at phase 1, persistence should be
in place — takes don't disappear on tab close.

---

## 16. Smallest interesting version

Phase 1 alone. ~80 LoC of UI on top of the existing WebM recorder,
plus IndexedDB persistence (~50 LoC). Reverts cleanly. Doesn't
touch the simulator, doesn't touch the director.

If the user response is _"this is great but I want to record and
review multiple takes"_ — phase 2. If _"this is great but I want
to combine takes"_ — phase 3. Each phase is a week of work and
a 10× usefulness step. The progression is honest and lets the
feature grow with real demand.
