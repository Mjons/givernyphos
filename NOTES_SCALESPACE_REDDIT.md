# Notes from Scale Space WebGPU release post

A Reddit post by `solidwhetstone` / `setz` announcing a WebGPU rewrite of
their particle tool "Scale Space" — direct parallel to our Phase 1 work.
Recording here only what's useful or surprising for our project; the
sales-copy bits are skipped.

## 1. The 1M-on-a-4070ti claim — reality check

> 1M+ particles ... running really smoothly on a 4070ti.

Headline number, but it does **not** mean we should expect 1M bodies on
a 4090 with Phase 1's tiled all-pairs path. The math says clearly we
won't, and understanding why is more useful than the headline.

### 1.1 What our shader actually costs per interaction

Counting the inner loop in [index.html:1610-1622](index.html#L1610-L1622):

| Op                           | FLOPs   |
| ---------------------------- | ------- |
| `kindB` extract + clamp      | ~3      |
| `d = posB.xyz - pA`          | 3       |
| `dot(d, d) + eps2`           | 6       |
| `r2 * r2 * r2`               | 2       |
| `inverseSqrt`                | ~5      |
| `G * posB.w * K`             | 2       |
| `d * invR3 * (G·m·K)` (vec3) | 6       |
| `acc += ...`                 | 3       |
| **Total per interaction**    | **~30** |

(`K` matrix lookup is a shared-memory hit, not counted as FLOPs;
`posB.w <= 0` cull is a branch, not counted.)

### 1.2 4090 compute budget

- RTX 4090 peak FP32: **82.6 TFLOPS**.
- Tiled N-body kernels on Ampere/Ada extract roughly 70-80% of peak —
  Nyland's reference kernel hits 85% on H100. Our shader has more
  branches and a per-interaction matrix lookup, so derate to ~70%.
- Effective sustained: **~60 TFLOPS** = 6 × 10¹³ FLOPs/s.

### 1.3 Implied ceiling for our O(N²) shader on a 4090

```
N²_max(fps) = effective_FLOPS / (FLOPs_per_interaction × fps)
            = 6e13 / (30 × fps)
            = 2e12 / fps  interactions/frame
```

| Target fps | Max interactions / frame | Max N (= √interactions) |
| ---------- | ------------------------ | ----------------------- |
| 60         | 33 × 10⁹                 | ~183k                   |
| 30         | 67 × 10⁹                 | ~258k                   |
| 15         | 133 × 10⁹                | ~365k                   |
| 12         | 167 × 10⁹                | ~408k                   |
| 6          | 333 × 10⁹                | ~577k                   |

### 1.4 Cross-check against [PHASE1_WEBGPU.md §7](PHASE1_WEBGPU.md#L572) targets

| Tier     | Bodies | Target  | Compute ceiling | Verdict                       |
| -------- | ------ | ------- | --------------- | ----------------------------- |
| titanic  | 130k   | ≥55 fps | 60 fps @ 183k   | Comfortable                   |
| colossal | 262k   | ≥28 fps | 30 fps @ 258k   | Right at the edge             |
| abyssal  | 518k   | ≥12 fps | ~7-8 fps @ 518k | **Optimistic — won't hit it** |

The previous version of this note suggested the 4090 might "blow past"
abyssal; that was wrong. Phase 1's tiled-N² is bandwidth-bound today and
becomes compute-bound after the rewrite — abyssal is right on the
compute boundary, and 1M is **~30× past it** in compute terms.

For 1M bodies @ 60 fps with our shader, we'd need:

```
1M² × 30 FLOPs × 60 fps = 1.8 × 10¹⁵ FLOPs/s = 1.8 PFLOPS
```

That's **22× the 4090's peak**, ~30× our sustained estimate. No
amount of WebGPU/tiling magic gets there at O(N²) — it's a complexity
wall, not an implementation gap.

## 2. So how is setz doing 1M on a 4070 Ti?

A 4070 Ti has roughly half the FP32 of a 4090 (~40 TFLOPS peak). For
them to run 1M smoothly there, their algorithm has to be _fundamentally
different from ours_ — at least one of:

1. **Barnes-Hut octree (O(N log N))** — at 1M·log₂(1M)·~50 FLOPs ≈
   1 GFLOP/frame. 60 fps trivially. Compute stops being the bottleneck;
   tree build and traversal locality become the dominant work.
2. **Spatial hash + cutoff radius (O(N·neighbours))** — viable for
   short-range forces, but breaks long-range gravity (our
   filaments/clusters depend on it). Already analysed and rejected in
   [PARTICLE_SCALING.md §C](PARTICLE_SCALING.md#L146-L170).
3. **No gravity, just flocking/local rules** — many "particle"
   creative-coding tools fall here. Boids + spatial hash hits 1M easily.
   The Reddit post says "particle simulation" but never says "gravity".
4. **PIC/SPH-style grid methods (O(N + grid))** — common in plasma /
   fluid sims, totally different physics from N-body gravity.

We don't know which. The phrase "particle simulation" + the visual style
of Scale Space (their itch page is a creative tool, not an N-body sim)
makes (3) the most likely guess. (1) is plausible. (2) and (4) are
possible.

**Bottom line:** the 1M number is real on their hardware, but it's not
apples-to-apples with our 7-kind, all-pairs, time-reversible gravity sim.

## 3. The honest path to 1M for us

The existing plan in [PARTICLE_SCALING.md](PARTICLE_SCALING.md#L114-L144)
already names this clearly:

> phase 3 — Barnes-Hut on WebGPU
> ~1–2 weeks of work
> unlocks tiers up to 1M / 2M / 4M bodies if we want them

That's correct. Phase 1's tiled all-pairs gets us **comfortable up to
~250-300k on a 4090** (titanic + colossal smooth, abyssal marginal),
which is the user-visible win the plan promised. Phase 3 (Barnes-Hut)
is the only path past ~500k.

Implications for what to do _now_:

- **Don't add a `cosmic` ~1M tier in Phase 1.** It would just be a
  slideshow tier. The earlier suggestion in this doc was wrong — retract.
- **Don't soften the abyssal target either.** 12 fps at 518k is
  optimistic but worth attempting; if step-10 testing shows we land at
  6-8 fps instead, that's the moment to either lower the target or open
  the Phase 3 conversation.
- **Phase 3 is the answer to "match setz's headline".** If matching
  that number is a goal, prioritise the Barnes-Hut work after Phase 1
  ships. The 1-2 week estimate in PARTICLE_SCALING.md looks credible —
  the Burtscher/Pingali parallel-octree paper is the canonical reference
  and translates to WebGPU storage-buffer atomics with some surgery.
- **Note for the bandwidth audit in [PHASE1_WEBGPU.md §1.6](PHASE1_WEBGPU.md#L86-L100):**
  the doc currently frames Phase 1's gain as "16× bandwidth reduction
  from tiling, becoming compute-bound at 36 TFLOPS". That framing is
  right but the 36 TFLOPS figure is the 4090's _base-clock_ number; boost
  is 82 TFLOPS. The §1.6 math should be updated when we revisit it —
  doesn't change the conclusion (compute ceiling is real, just farther
  out).

## 4. Other observations from the post

### 4.1 CPU fallback strategy

> I plan to have a CPU fallback for older machines that can't run it on the GPU.

We currently fall back to WebGL2 GPGPU when WebGPU is missing
([PHASE1_WEBGPU.md §2.5](PHASE1_WEBGPU.md#L228-L243)) but assume any
browser that runs the page at all has WebGL2. setz is going one step
further with a true CPU path.

Not worth it for us — a 7-kind interaction matrix in JS at even 5k
bodies is brutal (~250M JS-side ops/frame, on a single thread, no SIMD)
— but worth naming as an explicit non-goal so nobody asks later. Current
WebGL2 fallback already handles "no WebGPU"; "no GPU at all" can stay
unsupported.

### 4.2 Cross-platform delivery

setz frames Mac + Linux as a major reason to be excited. We already
have this for free as a browser app — worth remembering when writing
release notes since it's a real differentiator vs native particle tools.

### 4.3 File size as marketing

> The entire program now has a smaller filesize than any single image in the above gallery.

`index.html` is a single-file artifact (locked in
[PHASE1_WEBGPU.md §8.1](PHASE1_WEBGPU.md#L590-L592)). "Download the page,
run it offline, smaller than a screenshot" is genuinely unusual and a
story worth surfacing in any release note.

### 4.4 Feature inspiration: bookmark/return-to-location

> A big one is bookmarking and returning to locations!

Not in our app today. A "save current camera + scene + density + mood
as a returnable bookmark" feature would be cheap to add and orthogonal
to WebGPU work. Park as a candidate after Phase 1 ships.

### 4.5 Release-comms playbook

setz's announcement framing is worth noting for whenever we ship a
WebGPU release update:

- Lead with the headline number
- Be honest about browser requirements ("up to date browser" — no
  hand-waving)
- Tease a video preview rather than dropping it cold
- Be explicit about feature regressions rather than pretending parity

## 5. What's _not_ useful here

- Pricing model (theirs is commercial, ours isn't necessarily)
- Their specific Unreal → web migration story (we were already web)
- The Reddit thread itself beyond the OP (just thanks-yous)

---

## TL;DR

1. **Phase 1 (tiled O(N²)) ceiling on a 4090: ~250-300k bodies smooth,
   ~400-450k playable, ~518k marginal.** The 1M number is unreachable
   with our shader's current physics — by ~30× in compute, not bandwidth.
2. **setz almost certainly isn't running our physics.** Most likely
   they're either Barnes-Hut, local-only flocking, or a grid method.
   The headline is real for _their_ sim, not directly portable to ours.
3. **The path to 1M for us is Phase 3 (Barnes-Hut), already in
   [PARTICLE_SCALING.md](PARTICLE_SCALING.md#L114-L144).** ~1-2 weeks
   of focused work, unlocks 1M+. If matching the headline is a goal,
   that's the conversation to have once Phase 1 ships.
4. **Retract the earlier suggestion** to add a `cosmic` ~1M tier in
   Phase 1 — it would be a slideshow at our shader's complexity.
5. **Don't soften abyssal targets pre-emptively.** Test on real
   hardware after Phase 1 step 10; decide then.
