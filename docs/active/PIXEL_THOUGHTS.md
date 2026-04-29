# Pixel Thoughts — design exploration

A scratchpad for an idea inspired by [pixelthoughts.co](https://www.pixelthoughts.co/):
the user types a thought (a worry, a regret, a wish, a name) into a small
input. The text shrinks slowly over ~60 seconds, drifting outward, until
it becomes one indistinguishable star in the field. Then it's gone.

The closest the project ever comes to making the cosmos _personal_ — a
single object on screen that the user authored, that the sim then
absorbs. A small ritual of release, set against the indifferent universe
the rest of the app cultivates.

This doc is exploratory. The original has a strong, simple shape (input
→ shrink → star); the question is whether that shape can live inside
this sim without breaking its tone, and what we'd give up or gain by
adapting it. Three interpretations, the mechanic in detail, where it
plugs into the director, privacy, and a shortlist for v1. Not decided.

---

## 1. The pitch in one paragraph

The simulation is otherwise a place where _nothing_ on screen came from
the viewer. Every body, every accent, every camera move is generative.
A pixel-thoughts moment inverts that for one minute: the viewer types
something they want to let go of, the words appear as glowing text in
front of the field, and over ~60 seconds the text shrinks, fades, and
finally settles into the simulation as a single new star. After that
star is born it behaves like every other body — drifting, lensed,
indistinguishable. The viewer cannot find their thought again. _The
universe took it._

If the rest of the project is "weather", and a passing ship is
"wildlife", this is _"a small private rite."_

---

## 2. What pixel thoughts gets right (and what we'd inherit)

The original is ~60 seconds of one continuous animation:

- **One input box, one line of copy** (_"What's troubling you?"_).
  Tiny. Doesn't try to be a journal app.
- **You hit submit; the text begins shrinking immediately.** No "are
  you sure", no settings, no review.
- **No persistence whatsoever.** The thought never goes to a server.
  It never even leaves the local DOM.
- **No cancel button** during the shrink. Once you've released it,
  it's released — even though you could just refresh the tab. The
  affordance reinforces the metaphor.
- **A single guided breath cue in the middle.** The breathing
  matches our existing breathing baseline (see commit e183579,
  cinematic arcs phase 1+2) — uncanny how aligned the metaphor is.
- **Ends in silence.** No "saved!" toast, no "share your thought"
  prompt, no upsell. The page just becomes a starfield again.

Everything that makes it work is _what they didn't add_. Any version
we ship has to inherit that restraint or we destroy the feature.

---

## 3. What we have today that this can lean on

- **The starfield itself** — the existing twinkle starfield around
  [index.html:3596](index.html#L3596) is the visual destination. A
  thought becomes a star when it joins the same shader pass.
- **Body system with kinds** — the same `kind`-flagged-body pattern
  used for [PASSING_SHIPS.md §2](PASSING_SHIPS.md). A "thought-star"
  is a new `kind` the gravity solver leaves alone for a moment, then
  releases into the field as a normal body. ~one new branch in the
  velocity uniform.
- **Breathing baseline + amplitude-aware post-FX** — the 3s sine
  scale already used by characters and by the cinematic arcs work
  is exactly the right cadence for the mid-shrink breath cue. We
  inherit the amplitude.
- **DWELL embellishment slot in the director** — same scheduler shape
  as ships ([PASSING_SHIPS.md §6](PASSING_SHIPS.md)). A thought-release
  is _user-triggered_, not director-triggered, but it still needs to
  reserve the DWELL window so a transition doesn't clobber it.
- **Lens / chromatic aberration / bloom** — the text rendering can
  reuse these passes if rendered as an emissive sprite or as
  signed-distance-field text into the trail buffer. No new post-fx.
- **Capture pipeline** — a thought-release session is intrinsically a
  60-second movie. If we wire it to [CAPTURE_WYSIWYG_PLAN.md](CAPTURE_WYSIWYG_PLAN.md),
  a user could keep the recording even though the thought itself is gone.
  (Whether we _should_ offer that is §10 — it leaks the metaphor.)

So the new surface is: a tiny text input, a 60-second director-aware
shrink animation, a one-shot "promote to star" handoff to the body
system, and a privacy posture. Nothing else changes.

---

## 4. Three interpretations (pick one — they read very differently)

### A. Faithful port — modal overlay above the sim

A small input panel (centered, ~360 px wide, glassmorphic) appears on
the user's request. The user types, hits enter, and the panel's _own_
DOM element transform-scales to 0 over ~60s while drifting upward into
the camera's distance. At zero scale, a single new star is added to
the simulation at the on-screen location where the panel vanished.

**Pros:** ~150 LoC. Visually closest to pixel thoughts, so users who
know the original recognise the gesture instantly. The text remains
crisply readable for the first ~30s of the shrink (CSS scaling). Easy
to make accessible (real `<input>`, real focus, real screen-reader
support).
**Cons:** the DOM panel _looks_ different from the sim — one is HTML,
one is a WebGL framebuffer. The seam between panel and sim is visible
during the shrink. The handoff to a star is a hard cut, not a
dissolve.

### B. In-sim text — words become particles

The text never lives in the DOM. The user types into a tiny DOM input
that's invisible (positioned off-screen, accessibility-only); each
keystroke is mirrored into an SDF text-rendering pass that paints the
words directly into the framebuffer at world-space coordinates.

When the user submits, the text begins a 60-second journey: scale
shrinks, alpha fades, position drifts away from the camera along the
camera's forward axis. As the text reaches sub-pixel scale, the SDF
pass fades out and a new body of `kind = thoughtstar` is spawned at
the text's last position. The new body has high emissivity and
gradually relaxes into the normal star palette over a few seconds.

The metaphor is _literal_: your words become matter, then matter
becomes light, then light becomes one of many.

**Pros:** ~400 LoC, of which ~200 is the SDF text pass. No seam
between panel and sim — the text lives in the framebuffer alongside
everything else, gets the same lensing and bloom, ends as a body that
is _physically_ continuous with the field. The most cinematically
honest interpretation.
**Cons:** SDF text in WebGL is real work. Font choice, kerning,
multi-line wrapping if the user types a paragraph. Accessibility: the
visible text isn't real DOM text, so we have to mirror the input's
content into an `aria-live` region for screen readers.

### C. Inverse / Oracle — the universe says something to _you_

A different feature with the same emotional shape. Instead of the user
typing, the director _waits_ for a long stillness (no scene change for
~5 minutes, low body activity, user not interacting). At a moment of
maximum quiet, a single line of text fades in over the field — not a
fortune, not a quote, but a brief generative line drawn from a curated
seedlist (e.g. _"Nothing here is yours to keep."_, _"This is a long
way from where you started."_, _"You can stop watching whenever you
want."_). Held for 8 seconds. Fades to a star.

This isn't a port of pixel thoughts. It's the same _felt move_ — text
on a starfield, held briefly, released — but the agency is reversed:
the sim is speaking to the viewer, not the other way around.

**Pros:** ~200 LoC. No input UI, no privacy questions, no typing
friction. Fits the project's "indifferent universe occasionally
breaking its silence" register, which is the same register
[PASSING_SHIPS.md](PASSING_SHIPS.md) lives in.
**Cons:** _it isn't pixel thoughts._ It's a cousin, not a port. Some
viewers want the rite of release and won't get it from this. The
seedlist is also load-bearing — one bad line and the whole feature
reads as twee.

My instinct: **B for the rite, C alongside it as a passive cousin.**
A is a fallback if the SDF text in B reads worse than DOM. Both B
and C can ship together — they don't compete for screen real estate
because C only fires during long stillnesses, and the user only
invokes B deliberately.

---

## 5. The shrink — the load-bearing 60 seconds (interp B)

The whole feature pivots on this animation feeling _right_. Detail
per beat:

```
 SUBMIT (0s)  →  SETTLE (0–6s)  →  DRIFT (6–55s)  →  PROMOTE (55–60s)
 user hits     text comes to     scale + alpha       text gone, new
 enter         rest at 1.0       slowly fall         star is born
               scale, anchored   along forward       in its place
               at frame center   axis
```

### 5.1 SETTLE (0–6s)

The text appears at the user's cursor focus and gently translates to
frame-center, easing in. Scale 1.0, alpha 1.0. The director freezes
all camera moves; we do not transition. A breath cue fades in:
amplitude on the existing breathing baseline doubles for one inhale,
holds for two seconds, returns. (The cue is mechanical, not visible
as such — the existing arcs already breathe; we just push the
amplitude.)

### 5.2 DRIFT (6–55s)

This is the meditation. Three things happen smoothly together:

- **Scale** — exponential decay. `scale(t) = exp(-3.5 × (t-6) / 49)`.
  Reads as "fast at first, then a long tail at small sizes."
  Visually matches pixel thoughts.
- **Alpha** — held at 1.0 until t=40, then linearly fades to 0 over
  the remaining 15s. The text is _legible for most of the journey_
  even at small scale. We want the user to be able to read their
  own thought one last time at t=35, when it's already small.
- **Position** — drifts along camera-forward axis at constant world
  speed, ~0.3 units/s. Combined with the scale shrink, the on-screen
  effect is _falling away_. (The actual world-space offset matters
  for the promote step; see §5.3.)
- **No interactivity.** Click, scroll, keypress all do nothing during
  drift. The whole point is that release is irreversible. (`Esc` is
  the one exception — see §6 on cancel.)

### 5.3 PROMOTE (55–60s)

At t=55 the text is sub-pixel. The SDF pass stops drawing. At t=55
the body system spawns a new body of `kind = thoughtstar` at the
text's final world-space position, with:

- High initial emissivity (10×) for one second, then relaxing to
  normal star emissivity over four more seconds.
- Velocity inherited from the text's drift velocity (so it keeps
  falling away gently for a beat).
- Gravity solver _enabled_ from spawn — the new star feels the
  field. It will be perturbed by whatever's nearby. After a few
  seconds it's indistinguishable from any other body.

At t=60 we release the director hold. Normal scheduling resumes.
The user's thought is now a star somewhere in the field, and they
have no way to know which.

### 5.4 The breathing cue

Pixel thoughts has one mid-shrink breath. We have the existing
breathing baseline. The cue is: at t=20 (the deepest part of the
shrink), the breathing amplitude swells to 1.5× over 4 seconds and
returns. The viewer does not see "a breath UI"; they see the whole
field gently breathe with their thought. That's the cleanest
adaptation — no overlaid UI, the cue is _the field itself reacting
to the moment_.

---

## 6. Cancel, escape, edge cases

### 6.1 Cancel during typing

Easy. The input has a small × button and `Esc` clears it. No state
written. The whole feature is opt-in until SUBMIT.

### 6.2 Cancel during the 60s shrink

This is a question of metaphor, not implementation. Three options:

- **No cancel.** Once you've released, you've released. Faithful to
  the original and to the metaphor. Small risk: a user types
  something they regret and is forced to watch it for 60s.
- **`Esc` ends the animation early but does not "return" the
  thought.** Star spawns immediately. Compromise; preserves
  irreversibility but lets the user opt out of the wait.
- **`Esc` cancels and returns to the input pre-filled.** Pragmatic;
  destroys the metaphor. Don't ship this.

I'd ship the _middle_ option for v1 (immediate promote on `Esc`)
and consider falling back to "no cancel" if user feedback shows
nobody actually presses `Esc`.

### 6.3 The user types a paragraph

The original handles a sentence or two; long entries truncate. We
can either (a) cap input at ~140 chars and show a counter, or (b)
let it grow to multi-line and lay out with the SDF pass. (a) is
faithful to the original and ~5 LoC; (b) is more work and less
faithful. Cap it.

### 6.4 The user enters offensive text

It only ever appears on _their own screen_, never persisted, never
shared. We do not need to filter. (If we add a "share my recording"
hook in the capture pipeline, that changes — see §10.)

### 6.5 The user closes the tab mid-shrink

The thought is released. Even though there's no animation to show
it, the symbolic act has already happened. Do nothing on unload.

### 6.6 The user invokes mid-transition

If the director is currently in `TRANSITION` state, we politely
defer: the input opens, but SUBMIT waits until the transition
completes before SETTLE begins. The user sees their text appear and
hold, then the sim arrives, then the rite proceeds.

### 6.7 The user invokes during a passing ship

Defer the same way. Ships are quiet; we don't want to step on the
sighting. The input opens; the rite begins after the ship exits.
(Worst case: ~15s wait, which is fine.)

---

## 7. The trigger — how does the user invoke this?

The whole feature lives or dies on _how_ a user finds it. Three options,
in increasing intentionality:

### 7.1 Always-visible button

A small icon on the rail (a tiny pen, or a single "·" representing a
star). Discoverable, never demanding. The downside: the rite becomes a
button, and pixel thoughts is explicitly _not_ a button — it's a
ritual you discover and then return to.

### 7.2 Hidden gesture

Long-press anywhere on the canvas (~2s), or a specific key chord.
Mythic, but undiscoverable; users won't find it without prompting.

### 7.3 Once-per-session prompt at a quiet moment

After a long stillness (~3 minutes, no interaction), a single small
line fades into the corner: _"is anything weighing on you?"_. Click
to begin, ignore to dismiss. Once dismissed, it doesn't return for
that session. This is the most _felt_ option but the most
manipulative — we're choosing the moment for the user.

I'd ship **a small icon (7.1) plus a `?thought=1` URL param** as
v1. Add 7.3 as an opt-in director flag (`prompts: true`) only if the
icon doesn't get used.

---

## 8. Privacy — the ethical floor

The user is typing _personal_ text. Two non-negotiables:

- **Nothing leaves the device, ever.** No analytics on the text
  (telemetry can record _that_ a thought happened, never _what_).
  No localStorage write. No history. The string lives in a single
  closure for ~60s and is then garbage-collected.
- **The capture pipeline must not record the typed text by default.**
  See §10 — this is the easiest place to leak it accidentally.

Both are code-level invariants that need a comment in the
implementation. (We can also add a short on-screen line below the
input: _"Nothing you type leaves your device."_ Faithful to pixel
thoughts, which says exactly that. Eight words; reassures users who
might otherwise hesitate.)

---

## 9. Where this lives in the director

A new user-triggered embellishment, alongside the schedulers in
[PASSING_SHIPS.md §6](PASSING_SHIPS.md). Different shape from a ship —
the user requests it, and the director must accommodate.

### 9.1 State machine

```
DWELL → THOUGHT_PENDING (input open, user typing)
      → THOUGHT_ACTIVE (the 60s rite)
      → DWELL (rite complete; normal scheduling resumes)
```

While `THOUGHT_PENDING`, the director continues normal scheduling
(transitions, ships, accents). The user can still see the cosmos
behind their input.

While `THOUGHT_ACTIVE`, the director:

- Holds the current scene (no transitions for the duration).
- Holds the current camera move (no orbit changes, no FOV pulls).
  The frame stays still so the rite has a stable backdrop.
- Suppresses ship spawns, accent spawns, palette shifts.
- Continues breathing baseline, lens, post-FX, and gravity. The sim
  is alive; only the _director_ is quiet.

### 9.2 Director awareness

The cinematic director must know a rite is in progress so that
queued events (a transition that was about to fire, a ship that was
about to spawn) are deferred rather than dropped. Same defer-don't-drop
pattern as [EVENT_HORIZON_TRANSIT_PLAN.md](EVENT_HORIZON_TRANSIT_PLAN.md)
uses for density rebuilds.

### 9.3 Scene veto

Some scenes are bad backdrops for a slow text-shrink:

- **`event-horizon`** — the disk is too busy. The text contrast
  fights the lensing. Disallowed.
- **collision scenes mid-event** — disallowed.
- **`coma`, dust-heavy** — same problem as ships; the text gets
  lost. Allowed but warns the user (a tiny line: _"the cosmos is
  loud right now — this might be hard to read"_).
- **All other scenes** — allowed at full quality.

If the user invokes during a vetoed scene, we hold the input open
and wait for a scene change before SETTLE. (Or offer a one-click
"go to a quieter sky" button that initiates a transition.)

---

## 10. Capture and the metaphor problem

The capture pipeline ([CAPTURE_WYSIWYG_PLAN.md](CAPTURE_WYSIWYG_PLAN.md))
records the canvas. If thought-release renders into the canvas, then
recordings will include the user's text.

That has two implications:

- **A user could deliberately record their rite.** Some will want
  this. _"I want to keep the moment I let go of X."_ A real and
  legitimate use.
- **A user could accidentally share their thought.** Their recording
  goes to a friend, the friend can read the words. Even though our
  app didn't transmit anything, the user did.

The ethically defensible posture:

- **Capture is _not_ active by default during a rite.** If a recording
  is in progress when SUBMIT fires, we offer a one-time toggle:
  _"Include the words in this recording?"_ — defaulting to off.
- **A separate "save this rite" affordance** the user can opt into
  before SUBMIT. It records only the 60-second rite and saves a WebM
  locally. The user owns the bytes; we never see them.
- **Never auto-include in a "share to..." flow.** If we ever build
  one ([USER_MOVIES_PLAN.md](USER_MOVIES_PLAN.md)), thought-rites
  must be excluded from any cloud-upload path by default.

This is the bit I'd want signed off in writing before code. It's
easy to violate accidentally.

---

## 11. Audio

Mostly silent, like pixel thoughts. One layered cue:

- **No sound on SUBMIT.** The text appearing is enough.
- **A single low pad** that swells in over SETTLE, holds through
  DRIFT at -28 dBFS, fades over the last 5s of PROMOTE. Tonal,
  drone-like, no rhythm. Synthesised from the existing WebAudio
  graph the [STARGAZER_INTRO_PLAN.md §4](STARGAZER_INTRO_PLAN.md)
  pattern uses.
- **No sound on PROMOTE.** The new star is born silent. The pad
  has already faded, so the rite ends in the regular sim ambience.

If the existing director already has music playing, the pad ducks
the music to -6 dB during DRIFT. (Reuses the duck path from cinematic
accents.)

---

## 12. Risks

### 12.1 The tone clash

Pixel thoughts is a self-help tool: explicit about its therapeutic
intent. This project is meditative-ambient but not therapeutic. A
literal "type your worry" prompt risks reading as an unwelcome
self-care nudge in what's otherwise a generative-art sim.

Mitigations:

- The trigger is opt-in (§7.1) and the affordance is small. Users
  who want it find it; users who don't never see it.
- The wording is neutral, not therapeutic. _"What's on your mind?"_
  is too clinical; _"Type something to release"_ is preachy. The
  best phrasing might just be _" · "_ — a placeholder dot, no
  prompt at all. Discoverable through use, not language.
- Interpretation C (the inverse oracle) is the lower-risk version
  that delivers a similar emotional payload without the rite.

### 12.2 SDF text rendering complexity

Interp B's text-in-the-framebuffer is the prettiest version and the
hardest. Real risks: kerning artefacts at low scale, font licensing,
multi-line layout cost. Mitigations:

- **Use a single curated font baked at build time.** No runtime
  font loading, no glyph atlases bigger than necessary. ~120 chars
  of ASCII is enough — we cap input at 140 chars (§6.3) so no
  exotic glyphs.
- **Single-line only for v1.** If the user enters a paragraph, we
  display it as one line that scrolls horizontally during DRIFT.
  Multi-line is v1.1.
- **Fallback to interp A.** If SDF doesn't read at small scale, the
  DOM-overlay version is honest and shippable.

### 12.3 The "social" failure mode

A worry: someone screenshots their thought ("look what I let go of
today") and shares it on social. Suddenly the feature is read as a
gimmick, not a rite. The project's tone shifts.

There's no engineering fix for this. It's a marketing question. I
think we accept it: pixel thoughts itself is widely shared and the
rite still works for the users who want it to. We don't fight the
share; we just don't _engineer_ for it.

### 12.4 Accessibility

Reduced motion users need a different rite — a 60s shrink animation
is a lot of motion. Mitigation:

- `prefers-reduced-motion: reduce` swaps DRIFT for an instant
  dissolve. Text appears, holds for 8s, fades, star spawns. Same
  metaphor, no shrink.
- Screen reader users need the text in an `aria-live` region during
  SETTLE so they can confirm what was submitted, and an
  announcement at PROMOTE: _"released"_.

### 12.5 Interaction with `?intro=1`

The stargazer intro ([STARGAZER_INTRO_PLAN.md](STARGAZER_INTRO_PLAN.md))
is itself a 12-second cinematic. If a user invokes a thought-rite
during the intro, we defer until the intro completes. Easy.

---

## 13. Open questions

- **Interp B vs C for v1.** Doc instinct is "both, B as the rite,
  C as the cousin." Worth confirming we want the rite at all before
  building the SDF pass.
- **The trigger (§7).** Icon vs hidden gesture vs once-per-session
  prompt. Pick one to ship; the others can layer in.
- **Cancel during DRIFT (§6.2).** Three options, doc favours the
  middle (`Esc` = immediate promote). Worth a one-day in-browser
  feel test before committing.
- **Capture posture (§10).** The default-off-with-explicit-opt-in
  posture is the safe one. Confirm before writing the toggle.
- **Whether to add the "nothing you type leaves your device" line
  (§8).** Faithful to original and reassuring; might also read as
  drawing attention to a concern users didn't have.
- **Phrasing of the placeholder.** Empty dot vs neutral prompt vs
  therapeutic prompt. This is one tweet's worth of copy that
  decides 30% of the feature's tone.
- **Should the new star be `findable`?** A user could theoretically
  go look for "their" star later. Almost certainly not — the
  metaphor is _release_, not bookmark. But there's a haunted version
  where the star quietly persists across sessions and the user can
  return to find it dimmer each visit. Probably overdesigned. Worth
  one paragraph of consideration before discarding.
- **Does this share session-state with cinematic mode?** If the
  director is mid-arc when the user invokes, we hold; but should the
  rite count as "an arc beat" for purposes of arc scheduling? I think
  no — the rite is a user-triggered interlude, not a scheduled beat.
- **Telemetry.** Log `{ ritesStarted, ritesCompleted, ritesEscaped }`
  per session. _Never_ log content, length, or timing of keystrokes.
  Just whether rites are happening.

---

## 14. Shortlist (where I'd start)

If the goal is _"ship a thought-rite this week"_:

1. **Pick interp A (DOM overlay) for v1.** Defer the SDF text pass.
   The DOM version captures 80% of the feeling for 20% of the work,
   and we'll learn whether anyone reaches for the feature at all
   before investing in the prettier render path. ~150 LoC.
2. **A small icon trigger** on the rail — just a "·". No copy, no
   tooltip, no onboarding. Discovery through use. ~30 LoC.
3. **The 60-second shrink animation** as a CSS transform on the
   panel + a one-shot star spawn at the panel's final on-screen
   position. ~80 LoC.
4. **Director hold** during `THOUGHT_ACTIVE` — no transitions, no
   ships, no scene scrubs. Reuses the defer-don't-drop pattern from
   passing ships. ~40 LoC.
5. **Privacy invariant** — explicit no-persist, no-telemetry-of-
   content. Comment block at the top of the module. ~5 LoC + one
   review.
6. **Reduced-motion variant** — instant fade-and-spawn for users who
   ask for it. ~20 LoC.

**Total: ~325 LoC, ~2 days.** Ship the DOM version; let it bake on
the stream for two weeks; if the rite gets used (telemetry §13), and
if users complain about the seam between DOM and sim, build interp B
on top. If nobody invokes it, revert and call it learned.

A v1.1 list, only after v1 has lived for a while:

- SDF text rendering (interp B) — replaces the DOM panel, removes the
  seam.
- Inverse oracle (interp C) — independent feature, same emotional
  shape, fires during long stillness.
- Once-per-session prompt (§7.3) — only if the icon trigger isn't
  found.
- Multi-line input — only if users complain about the 140-char cap.
- A "save this rite" capture path (§10) — only if users ask for it
  unprompted.

---

## 15. What I'd want to confirm before writing code

- **That we want the rite at all.** This is a tone shift more than a
  feature. A small one, but real. If the project is meant to stay
  strictly in the "no UI, no narrative" register, interp C alone is
  the right answer and interp A/B should be dropped.
- **That the icon trigger (§7.1) is the right discovery surface** —
  vs. waiting for a quiet moment to prompt, vs. only the URL param
  for v1.
- **The privacy posture (§8, §10)** is non-negotiable. Confirm the
  no-persist, no-telemetry-of-content, capture-default-off rules
  before we write a line.
- **The phrasing of the placeholder.** Empty vs neutral vs prompted.
  This is a one-line decision that shapes how the feature reads.

If those land, step 1 is reversible and self-contained — start with
the DOM panel, get a single static "thought shrinks to dot" working
without the body-system handoff, then wire the star spawn in step 3.
