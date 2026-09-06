# Project docs

Design notes, plans, audits, and history for the simulation. Top-level
[README.md](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) stay
at the project root.

## [active/](active/) — work in progress

Plans and audits for things being built or considered next.

- [CAPTURE_WYSIWYG_PLAN.md](active/CAPTURE_WYSIWYG_PLAN.md) — recorder fidelity (uniform sync, afterimage)
- [EVENT_HORIZON_TRANSIT.md](active/EVENT_HORIZON_TRANSIT.md) — exploration: flying through a black hole
- [EVENT_HORIZON_TRANSIT_PLAN.md](active/EVENT_HORIZON_TRANSIT_PLAN.md) — plan paired with the exploration above
- [PASSING_SHIPS.md](active/PASSING_SHIPS.md) — Project Hail Mary ship rendering + archetypes (Hail Mary, Blip-A, Beetles); spawn lives in PETROVA_LINE
- [PETROVA_LINE.md](active/PETROVA_LINE.md) — exploration: curved astrophage beam between star and planet ("migration"), with PHM ship sightings
- [PIXEL_THOUGHTS.md](active/PIXEL_THOUGHTS.md) — exploration: user types a thought, it becomes a star
- [ORACLE_AND_FLAVOURS.md](active/ORACLE_AND_FLAVOURS.md) — diagnose stuck-in-Oracle rotation; reshape Oracle as lock → release → reveal-trail
- [USER_MOVIES_PLAN.md](active/USER_MOVIES_PLAN.md) — polished recorder + saved compositions
- [PERFORMANCE_AUDIT.md](active/PERFORMANCE_AUDIT.md) — measurement framework + suspect ranking
- [TOKEN_COPY.md](active/TOKEN_COPY.md) — draft collection + per-token copy, family sentences, license line (for approval)
- [TOKEN_EXPERIENCE.md](active/TOKEN_EXPERIENCE.md) — the holder's first sixty seconds: generated tour, bar, hints, temperament + moments plan
- [INTERACTIVE_NFT.md](active/INTERACTIVE_NFT.md) — exploration: one living scene per token (hash → recipe, token build, previews, holder interaction, platform fit)
- [OPTIMIZATION_PLAN.md](active/OPTIMIZATION_PLAN.md) — 2026-09 full-path audit (sync stalls, fill rate, kernel, BH close-out, integrator) + phased plan; Petrova v2 scope
- [SHOW_DARK_MATTER_AUDIT.md](active/SHOW_DARK_MATTER_AUDIT.md) — diagnostic on the halo toggle

Build artefacts: `tools/build-token.mjs` produces the network-free token
bundle in `dist/` from `index.html` + `vendor/three/` (see
[INTERACTIVE_NFT.md](active/INTERACTIVE_NFT.md) §5). The main
`index.html` stays single-file and CDN-loaded.

## [reference/](reference/) — explainers & philosophy

Stable docs that describe how things work or how we think about the project.

- [CINEMATIC_MODES.md](reference/CINEMATIC_MODES.md) — director architecture overview
- [CINEMATIC_SLIDERS.md](reference/CINEMATIC_SLIDERS.md) — which sliders cinematic mode touches
- [GROWING_FEATURES.md](reference/GROWING_FEATURES.md) — phasing philosophy
- [FUTURE_IDEAS.md](reference/FUTURE_IDEAS.md) — parking lot for unstarted ideas
- [NOTES_SCALESPACE_REDDIT.md](reference/NOTES_SCALESPACE_REDDIT.md) — notes on the scalespace tool
- [PARTICLE_SCALING.md](reference/PARTICLE_SCALING.md) — design exploration of scaling paths

## [archive/](archive/) — shipped

Plans for features now in the code. Kept for history; do not edit.

- [BREATHING_ARCS_PLAN.md](archive/BREATHING_ARCS_PLAN.md) — cinematic arcs phase 1 + 2 (commit `e183579`)
- [DENSITY_TIERS.md](archive/DENSITY_TIERS.md) — titanic/colossal/abyssal tiers + FPS watchdog
- [PHASE1_WEBGPU.md](archive/PHASE1_WEBGPU.md) — WebGPU phase 1 (compute, staging, hand-off)
- [PHASE1_STEP7_HANDOFF.md](archive/PHASE1_STEP7_HANDOFF.md) — step 7 implementation handoff
- [SPIN_SLIDER_PLAN.md](archive/SPIN_SLIDER_PLAN.md) — spin uniform + COM-based vorticity
- [STARGAZER_INTRO_PLAN.md](archive/STARGAZER_INTRO_PLAN.md) — telescope cold open (commit `1167a43`)
