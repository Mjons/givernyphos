# Growing features vs building them whole

A recurring tension in this project's planning docs:

> Ship phase 1, see how users use it, decide whether to invest in
> phase 2.

vs.

> If I can build the whole thing in a few days, why not just do it?

Both intuitions are right, in different conditions. This doc walks
the trade-off honestly — when phasing wins, when build-it-all wins,
where the "quick to implement" caveat dissolves the question, and
where it doesn't. Examples from this project's own history.

---

## 1. The question, restated

The user's instinct: _"I can build the whole movie editor in a week.
Why ship phase 1 alone and wait for demand to justify phase 2-3?
Just build it."_

That instinct has a real grain of truth. There are conditions where
phasing is wasted ceremony — extra integration overhead and lost
calendar time for no benefit. There are also conditions where it's
the only sane path. Knowing which is which is the actual skill.

---

## 2. The case for phasing

### 2.1 You don't build what users don't want

Most predictions about user behaviour are wrong. Even when you're
the user. Even when "users want this" is obvious. Especially then.

Phase 1 of a feature gives you a forcing function: _will I actually
reach for this?_ If you build phase 1, watch yourself for two
weeks, and never invoke it — you have evidence. If you'd built
phases 1-5, you'd be 5× the maintenance commitment for the same
information.

The cinematic-mode work in this codebase has 14+ "ideas to do"
in [CINEMATIC_MODES.md](CINEMATIC_MODES.md). If we'd built all 14
in one stretch, ~50% would have been wrong calls — but we wouldn't
know which. By shipping a few at a time, the wrong ones are
discoverable cheaply.

### 2.2 Each phase reduces unknowns for the next

Phases compound. Phase 1 of arcs (data structure + scene filter)
told us something concrete: a 60-second within-arc dissolve looks
fine, no GPU strain, no flicker. That made phase 2 (envelopes)
much more confident — we knew the foundation held.

If we'd built phase 2 inside phase 1, we'd be debugging both at
once if anything went wrong. With phasing, phase 1 is a known-good
substrate. Bisects narrow.

### 2.3 You can revert cleanly

Phase 1 is a single commit. If it lands wrong, `git revert` and
the codebase is exactly where it was. Phase 5 piled on top of
phase 1 ships _all of it together_ — partial revert is harder,
and the partial-failure modes are harder to reason about.

The hand-tracking work (now reverted) is a perfect counter-example.
We built phases 1-3 before validating that phase 1's GPU plumbing
even worked. When the diagnostic ladder couldn't isolate the bug,
the only safe revert was _all_ of phases 1-3. Six commits-worth of
work backed out at once. Had we phased aggressively — phase 1
alone, watch for one day, _then_ phase 2 — we'd have caught the
bug at the smallest possible footprint.

### 2.4 You preserve optionality

Every line of unwritten code is a free option. You can change your
mind about phase 5 freely until you've written it. Once written,
the option has been exercised, and now you're maintaining it.

This is real-options theory applied to feature development.
Optionality has dollar value. Not committing to phase 5 until
phase 4 lands is _worth something_ — it's not pure delay.

### 2.5 User feedback shapes architecture

Every phase you build before the user touches anything is built on
assumptions. Some are right; some aren't. The wrong ones bake
themselves into the architecture in ways that are hard to undo.

Specific example, hypothetical: you build a movies feature with
phases 1-5 all at once. The data model treats "movies" as the
top-level entity. Two months in, users tell you they actually
think of _takes_ as the top-level thing — they want a takes
library that occasionally produces movies, not the other way
around. Now your architecture is backwards, and unwinding it
costs more than it would have to phase the feature in the first
place.

---

## 3. The case for building it all at once

### 3.1 Some features have zero value half-built

A movie editor without persistence is useless. A search box without
a results panel is useless. A login screen without a "stay logged
in" toggle is annoying enough that you might as well not ship it.

Some features are atomic — phasing them just delays the moment
where users can do anything useful. In those cases, "phase 1 alone"
is worse than nothing because it raises expectations and disappoints.

### 3.2 Integration cost is paid per-phase

Every time you touch the same file, you pay an integration tax —
re-reading context, re-validating assumptions, possibly merging
with new changes that landed in between. If a feature has 5 phases
and each phase costs 1 day of context-building, you've spent 5
days of context tax on what could have been 1.5 days of building
it all together.

This is the economic case against over-phasing: at low feature
complexity, phasing's overhead exceeds its benefits.

### 3.3 The architecture for phase 5 informs phase 1

If you're confident the feature will reach phase 5, designing for
phase 5 from the start saves rework. Phase 1's data model that
"only needs to support a single shot" might genuinely block the
phase 3 multi-shot timeline if the data structure was wrong.
Building all at once lets you design once.

The trick is: this only works if your prediction about phase 5 is
correct. If it isn't, you've architected for a future that doesn't
arrive, and the cost of that misdesign exceeds the savings.

### 3.4 Momentum is real

Shipping phase 1 and stopping requires re-igniting context to
ship phase 2. If the gap is months, you're nearly starting fresh.
A continuous build keeps everything warm — file structure,
mental model, motivation. The "I'll come back to phase 2 next
week" plan is, in practice, often "I'll come back to phase 2
never."

This is a real cost, and it's why some teams ship features whole
even when phasing would be theoretically cleaner: the
theoretical clean phasing assumes a level of return-to-context
discipline that doesn't survive contact with shifting priorities.

### 3.5 Sometimes "demand" doesn't materialize cheaply

The phasing argument leans on a feedback loop: ship → observe →
decide. But observing is hard. Logged usage, surveys, asking
users — all noisy and slow. By the time you have signal, weeks
have passed. Building phase 5 on day 1 is expensive but at least
it's _done_; waiting for demand on phase 5 means it might never
ship even when it should have.

---

## 4. The "quick to implement" caveat

The user's instinct says: _"if it's quick to build, just build it
all."_ Where does this hold?

### When it actually holds:

- **The feature is genuinely small.** A "save current view" button.
  An in-app help tooltip. A keyboard shortcut. Anything where the
  whole feature is two to four hours of work, no architecture
  decisions, no ongoing maintenance.
- **You are the user.** When the developer is also the consumer,
  the demand signal is immediate — you know after 5 minutes of
  using it whether it works. Phasing's "wait for users" loop has
  zero benefit because you _are_ the user.
- **The feature is reversible.** If the whole thing took 4 hours
  and you can revert it in 5 minutes, the cost of being wrong is
  ~4 hours. Phasing doesn't save much against that ceiling.
- **The architecture isn't load-bearing for anything else.**
  Standalone feature, doesn't impose constraints on anything
  else, easy to delete later if it doesn't pan out.

### Where it dissolves:

- **"Quick to implement" usually means quick to _build_, not quick
  to _validate_.** A 2-day build that ships into a 24/7 stream
  has a 2-week observation period before you know if it works.
  The implementation is 2 days; the _commitment_ is 2-week+.
- **Maintenance cost dominates.** A 2-day feature you keep
  forever costs ~5 minutes of attention per month for years. Over
  3 years that's hours. Building 3 features at 2 days each that
  you don't actually need = years of compound maintenance for
  zero value.
- **Small implementation cost can hide large coupling cost.** A
  cheap-to-add feature might wire itself into 8 places. Each of
  those is a constraint on future changes. Phasing protects you
  from accumulating constraint via features that don't earn their
  weight.
- **You're the wrong predictor.** If you're not yet sure what the
  feature should do — even if you can imagine 5 phases — the
  speed of building isn't the bottleneck. The bottleneck is
  knowing what to build. Building 5 phases when you should have
  built 2 is faster _per phase_ but slower _to the right answer_.

---

## 5. What "demand" actually means

The phasing-with-demand argument leans on a clean feedback loop. In
practice, "demand" comes in five flavours, each with different
signal quality:

### 5.1 Direct user request

_"I want X."_ High-quality signal but rare. Users tend to ask for
the next 10% improvement on the current feature, not for a feature
that doesn't exist yet. (Henry Ford's apocryphal "faster horses"
problem.)

### 5.2 Observed friction

The user works around a missing feature in awkward ways — manual
copy-paste, exporting to another tool, building their own
workaround. This is gold. They didn't ask, but they're showing you
what's missing. Observable in usage logs, support tickets, chat
patterns.

### 5.3 Self-friction (you're the user)

Same as above, but you're the one feeling it. _"Ugh, I keep doing
this manually."_ Highest signal-to-noise ratio because you can't
self-deceive about your own friction.

### 5.4 Imagined demand

_"Users will probably want this."_ Hard to validate cheaply. Often
turns out wrong because the imagining-self has incomplete model of
the using-self. Most failed feature investments live here.

### 5.5 Anxiety demand

_"What if a competitor has this and we don't?"_ — or — _"What if
someone asks for this and I haven't built it?"_ These look like
real demand but are often anxiety projected onto the future. Real
demand sustains itself; anxiety demand evaporates when the imagined
threat doesn't appear.

The phasing argument assumes you're acting on signals 1-3. If
you're actually acting on 4-5, phasing is a smokescreen for
"I should not be building this at all."

---

## 6. Examples from this project

### 6.1 Hand tracking — phasing too late

Built phases 1-3 (capture → cursor → brush+pull → fingertip
gravity → COM pull) over a few hours each, never validated that
phase 1's GPU uniform plumbing actually engaged the shader. When
diagnostics finally bisected to "uniforms not reaching kernel,"
the only safe move was wholesale revert. ~6 commits and a day's
work undone.

**What phasing should have looked like:** phase 1 = cursor +
landmarks, console-log values. _Verify visually that landmarks
flow._ Phase 2 = wire one force, verify it visibly moves the
cluster. _Stop, validate._ Phase 3 = remaining forces.

We did phase 1 correctly (verified visually), then bundled phases
2-3 without checking phase 2's GPU side. Lesson: the _unit_ of
phasing has to be small enough to be visibly verifiable. "I added
the brush _and_ the pull" is too coupled to bisect when neither
shows up.

### 6.2 Cinematic arcs — phasing working as designed

[BREATHING_ARCS_PLAN.md](BREATHING_ARCS_PLAN.md) lays out 4 phases.
Shipped phase 1 alone. Watched a session. Confirmed scene order
felt coherent and 60s dissolves looked fine. _Then_ shipped phase 2. Now waiting on phase 2 observation before deciding on phase 3.

Total time across both phases: ~1.5 hours of build + ~30 minutes
of observation between them. Not much overhead from phasing. And
phase 3 (camera continuity) is on hold based on the realization
that it overlaps with movie mode — a redirect that wouldn't have
been possible if we'd built it.

### 6.3 WebGPU port — phasing because the task is huge

[PHASE1_WEBGPU.md](PHASE1_WEBGPU.md) and the step 7 handoff doc
phase a multi-month engine port into 9+ commits. No "build it all"
option exists — the surface is too large, the failure modes too
varied. Phasing is mandatory.

### 6.4 Bookmarks (deferred)

In [FUTURE_IDEAS.md](FUTURE_IDEAS.md). Estimated half a day. The
"build it all" instinct says: just do it. The phasing instinct
says: do you actually want this, or are you imagining it?

The doc has been there for weeks unbuilt. That's a signal: the
demand isn't real enough to drive even a half-day investment.
Worth less than the alternative things that have been getting
built. Phasing — in the form of "wait until you actually want it"
— is correctly preventing wasted work.

---

## 7. Hybrid strategies

The dichotomy isn't really phase-everything vs build-everything.
There are middle paths.

### 7.1 Architect for the long tail, ship the head

Design the data model, function signatures, and integration points
_as if_ you were going to build all 5 phases. Implement only phase

1. The architecture supports phase 5 if you choose to build it,
   but the code shipped is just phase 1.

This captures most of "build it all"'s benefit (no painful refactor
when phase 2 lands) without paying for phases 2-5's actual
implementation. Cost is mostly cognitive — designing once. Risk:
you might still be wrong about the future shape.

Used in this project: USER_MOVIES_PLAN's data model section
specifies takes/shots/movies as separate entities even if phase
1 only builds the takes table. Phase 2 doesn't refactor takes;
it just adds shots.

### 7.2 Build a vertical slice, not a horizontal layer

Instead of "build the whole data layer first, then UI, then
export," build the smallest end-to-end feature: record one take,
save it, see it in a list, download it. That's a vertical slice.
It exercises every layer at thin scale.

This is phase 1 _correctly defined_. The wrong version of phase 1
is "build the storage layer for all phases." That's horizontal
slicing — looks like phasing, actually builds without validating.

### 7.3 Build it all behind a feature flag

If you're confident the feature is right but uncertain it'll land
well, build all of it, ship it behind a flag, and gate exposure.
You get the build-all-at-once architecture, plus the option to
dial it down or back out cheaply.

Caveat: feature flags accumulate. Each flag is a constraint on
testing and a code-path explosion. Use sparingly.

### 7.4 Time-box and stop on signal

Set a budget — _"I'll build for 2 days, then stop and observe
regardless of how far I got."_ This is the "build it all" approach
with a forced phasing checkpoint. Catches the case where you
underestimated complexity (you'd have phased anyway) and lets you
ship more in cases where you didn't.

---

## 8. Anti-patterns

### Anti-patterns of phasing

- **The "phase 2 will land later" lie.** You shipped phase 1 with
  the implicit promise of phase 2 within weeks. Months later,
  phase 2 is still TODO. Now phase 1 is half-baked permanently.
- **Phase as procrastination.** Splitting work into "phases" to
  avoid making a hard decision. If phase 2 requires the _same_
  decision as phase 1, you haven't actually decoupled them.
- **Phase 1 that doesn't validate anything.** "I'll just build the
  data layer first" — that's not phase 1, that's just building
  half the feature with no observable signal.
- **Sunk-cost momentum.** Each shipped phase makes you more
  invested. By phase 3 you might keep going for the wrong reasons
  even if signal says stop. Discipline against this requires
  honest self-assessment at each phase boundary.

### Anti-patterns of building it all

- **Speculative generality.** Building flexibility for phase 5
  scenarios that never materialize. Code becomes harder to
  understand for no current benefit.
- **Architectural lock-in.** Phase 1 + phase 5 ship together,
  baked into a coupled architecture. Changing your mind about
  phase 4 means refactoring phases 1-5.
- **The "complete feature" trap.** Spending a month on something
  before any user touches it. Three months in, it ships, and 60%
  of it isn't what users wanted.
- **Compulsion finishing.** "I started, so I'll complete it" —
  even when the right call is to stop at 60% because the remaining
  40% has no demand. Sunk cost dressed up as commitment.

---

## 9. A decision rubric

Six questions, take ~30 seconds:

1. **Can I observe this feature work in <1 day after shipping?**
   - Yes → phase aggressively. Each phase is its own validation.
   - No → either phase very large units, or build whole.
2. **Do I know what users want, with high confidence?**
   - Yes → build whole.
   - No → phase. The early phases will teach you.
3. **Is the architecture coupled to future phases?**
   - Tight coupling → consider building whole, or do the §7.1
     "architect for tail, ship head" hybrid.
   - Loose coupling → phase confidently.
4. **What's the maintenance cost of half-built?**
   - Zero — half-feature works, just less polished → phase.
   - High — feature is useless until complete → build whole or
     don't ship at all yet.
5. **Is this a 24/7 production thing or a tool?**
   - Production → phase, observe, validate. Failure modes are
     real and visible.
   - Solo tool, you're the user → demand signal is immediate;
     phasing's wait-for-feedback loop adds nothing. Build whole.
6. **What does "quickly" actually mean?**
   - <4 hours total, no maintenance → just build it.
   - <2 days but ongoing maintenance → think harder. The build
     is fast; the _commitment_ is forever.
   - > 2 days → phase or it'll bloat.

---

## 10. The honest take

The "build it all when you can do it quickly" instinct is right
maybe 30% of the time:

- Features under 4 hours, no architecture impact: build whole.
- Solo-developer tools with you-as-user: build whole, you're the
  signal.
- Features where phase 1 is genuinely useless: build whole or
  don't start.

The other 70% benefit from phasing, and the benefit isn't _time_
— it's _information_. Phase 1 tells you whether you should have
built phases 2-5 at all. That information is worth far more than
the integration overhead phasing costs.

The trap with phasing is the "phase 2 later" promise that never
materializes. The trap with build-it-all is the "I built it all
and 60% of it was wrong" outcome. Both are real. Both kill
projects.

The user's instinct in the original framing — _"why not just build
it all?"_ — is most often correct when the feature is **small,
reversible, and validated by the developer themselves.** It is
most often wrong when the feature is **large, coupled to other
systems, or requires real-user feedback to validate.**

For user movies: phase 1 alone is right because you'll know within
a week of using it whether you want phase 2-3. The build-it-all
estimate of "1 week" is true for build time but ignores the
2-month commitment to maintenance, polish, bug-fixing, and the
opportunity cost of not building something else.

For something like the spin slider: build it whole. It's small,
it's contained, it's validatable in 5 minutes of testing. Phasing
would be ceremony.

---

## 11. The meta-rule

> **Phase by units of validation, not by units of code.**

The right phase boundary isn't "split the code in half" — it's
"split where you can see something change." If you can't observe
the difference between phase 1 and phase 2, phasing was a fiction.
Either combine them or find a phase 1 that's actually visible.

This is the rule the hand-tracking work violated (phase 1's GPU
plumbing wasn't observable visually until phase 2 added a force
term — so the phase boundary was wrong) and the cinematic arcs
work followed correctly (phase 1 was observably "scenes feel less
jumpy"; phase 2 was observably "bloom drifts across the arc"; both
visible without the other).

If you can't articulate what observation will tell you phase 1
worked — you don't have phase 1; you have a half-feature.
