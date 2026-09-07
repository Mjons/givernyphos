/* site/audio.js — window.PhosAudio
 *
 * The soundtrack of the collection site: two <audio> elements crossfading
 * on the `volume` property, one chapter → tracks mapping, a small fixed
 * pill bottom-left. Plain script, no fetch, no modules — the site is
 * opened from file:// for review.
 *
 * Contract: docs/active/SITE_PLAN.md §3.
 *   PhosAudio.init({ base, chapters, volume })
 *   PhosAudio.enter()            // from a user gesture → Promise<state>
 *   PhosAudio.setChapter(key)    // 2.5 s crossfade if the track differs
 *   PhosAudio.toggleMute()       // → muted; persists "phos.site.muted"
 *   PhosAudio.next()             // next track of the chapter (wraps)
 *   PhosAudio.duck(on)           // about -12 dB
 *   PhosAudio.state()            // { entered, muted, playing, chapter, track }
 *   PhosAudio.on("track"|"state", fn) → unsubscribe
 *   PhosAudio.playTrack(title)   // soundtrack chapter's per-track buttons
 *   PhosAudio.defaultChapters, PhosAudio.catalogue, PhosAudio.setMuted(v)
 *
 * Rules from the bug ledger (CHANGELOG.md, "Audio abort event listeners
 * cascade"): never listen to the media `abort` event; on `error` ignore
 * error.code === 1 (MEDIA_ERR_ABORTED); a failing track skips forward
 * once and never loops on failure.
 */
(function (global) {
  "use strict";

  // ------------------------------------------------------------------
  // Catalogue — the 46 SSI tracks (title → file under `base`). Copied
  // from the app's TRACKS array (index.html §6b) minus the folder prefix.
  // ------------------------------------------------------------------
  const CATALOGUE = [
    { title: "Adjoining Room", file: "Adjoining Room.mp3" },
    { title: "After the Bowl", file: "After the Bowl.mp3" },
    { title: "Almost Hum", file: "Almost Hum.mp3" },
    { title: "Before the Cloth", file: "Before the Cloth.mp3" },
    { title: "Between the Stars", file: "Between the Stars.mp3" },
    { title: "Bough Bend", file: "Bough-Bend.mp3" },
    { title: "Cathedral, Small", file: "Cathedral, Small.mp3" },
    { title: "Chapel Stone", file: "Chapel Stone.mp3" },
    { title: "Day's Rim", file: "Day's Rim.mp3" },
    { title: "Drift", file: "Drift.mp3" },
    { title: "Eddy", file: "Eddy.mp3" },
    { title: "Filament", file: "Filament.mp3" },
    { title: "First Kindling", file: "First Kindling.mp3" },
    { title: "Gathered", file: "Gathered.mp3" },
    { title: "Hairline", file: "Hairline.mp3" },
    { title: "Held In", file: "Held In.mp3" },
    { title: "Interior", file: "Interior.mp3" },
    { title: "Inwards", file: "Inwards.mp3" },
    { title: "Lamplighter", file: "Lamplighter.mp3" },
    { title: "Lid Closing", file: "Lid Closing.mp3" },
    { title: "Lid Settling", file: "Lid Settling.mp3" },
    { title: "Limb Yield", file: "Limb Yield.mp3" },
    { title: "Long Exhale", file: "Long Exhale.mp3" },
    { title: "Long Shadow", file: "Long Shadow.mp3" },
    { title: "Longer Shadow", file: "Longer Shadow.mp3" },
    { title: "Muffled Tick", file: "Muffled Tick.mp3" },
    { title: "One Line", file: "One Line.mp3" },
    { title: "Past the Threshold", file: "Past the Threshold.mp3" },
    { title: "Quiet Drone", file: "Quiet Drone.mp3" },
    { title: "Quiet Front", file: "Quiet Front.mp3" },
    { title: "Slow Weather", file: "Slow Weather.mp3" },
    { title: "Small Fault", file: "Small Fault.mp3" },
    { title: "The Edge of Day", file: "The Edge of Day.mp3" },
    { title: "The Hold", file: "The Hold.mp3" },
    { title: "The Lip", file: "The Lip.mp3" },
    { title: "The Pair", file: "The Pair.mp3" },
    { title: "The Rim", file: "The Rim.mp3" },
    { title: "The Sisters", file: "The Sisters.mp3" },
    { title: "The Sustain", file: "The Sustain.mp3" },
    { title: "Thread", file: "Thread.mp3" },
    { title: "Threshold Again", file: "Threshold Again.mp3" },
    { title: "Tinder", file: "Tinder.mp3" },
    { title: "Two Rooms", file: "Two Rooms.mp3" },
    { title: "Wick", file: "Wick.mp3" },
    { title: "Wrapped Tick", file: "Wrapped Tick.mp3" },
    { title: "Written Behind the Stars", file: "Written Behind the Stars.mp3" },
  ];

  // ------------------------------------------------------------------
  // Chapter → tracks. Chosen from the titles the films already use, so
  // the site sounds like the films do:
  //   Rewind (a collision, three times)      The Pair
  //   First Light (an introduction)          Bough Bend
  //   Passage (a traveller)                  Slow Weather
  //   Odyssey (four movements)               Inwards · Slow Weather · The Sisters · Lamplighter
  //   Web (the architecture of mass)         Long Shadow · Cathedral, Small · Threshold Again · The Sustain
  //   Pilgrim (one star's journey)           Drift · Filament · Long Exhale · The Edge of Day
  // Chapters play their list in order and loop within the chapter. A
  // chapter with no mapping keeps whatever is playing.
  // ------------------------------------------------------------------
  const DEFAULT_CHAPTERS = {
    // the gate and the hero: the collection's signature film opens with it
    enter: ["The Pair"],
    // "not a rendering" — a traveller, then the introduction
    piece: ["Slow Weather", "Bough Bend"],
    // seventeen families: the Web suite, "the architecture of mass"
    families: [
      "Long Shadow",
      "Cathedral, Small",
      "Threshold Again",
      "The Sustain",
    ],
    // the hundred: the Pilgrim suite, "one star's journey", minus its close
    hundred: ["Drift", "Filament", "Long Exhale"],
    // the question turns inward
    mint: ["Inwards"],
    // the soundtrack chapter: Odyssey's last two movements (per-track
    // buttons override through playTrack)
    music: ["The Sisters", "Lamplighter"],
    // the close of the last film
    credits: ["The Edge of Day"],
  };

  const FADE_IN_MS = 2000; // enter()
  const XFADE_MS = 2500; // setChapter()
  const STEP_MS = 1200; // next(), playTrack(), track → track within a chapter
  const DUCK_MS = 400;
  const UNDUCK_MS = 900;
  const DUCK_GAIN = 0.25; // -12 dB
  const CHAPTER_DEBOUNCE_MS = 300; // a fast scroll through chapters swaps once
  const STORAGE_KEY = "phos.site.muted";

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const cfg = { base: "../ssi_tracks/", volume: 0.6 };
  let chapters = {}; // key → [track]
  const cursors = {}; // key → index into its list
  let inited = false;
  let els = null; // [a, b]
  let cur = null; // the element carrying the current track
  let track = null; // current track { title, file }
  let chapter = null; // recorded chapter key
  let activeList = []; // list the current track came from (for ended/next)
  let entered = false;
  let muted = false;
  let ducked = false;
  let playing = false;
  let userPaused = false; // an external pause (media key, OS) we respect
  let pausedWhileHidden = false;
  let reason = null; // why not playing, when we know
  let stopped = false; // gave up after failures; next()/playTrack() clears
  const failed = Object.create(null); // file → true
  let failSkips = 0; // consecutive error-driven skips
  let skipTimer = null;
  let chapterTimer = null;
  let loadSeq = 0;
  let pending = null; // { el, outgoing, inMs, outMs } until `playing`
  let volumeSettable = true; // false on iOS: hard cuts, mute-duck
  const listeners = { track: [], state: [] };
  let ui = null;

  const now = () =>
    global.performance && performance.now ? performance.now() : Date.now();
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const noop = () => {};

  // ------------------------------------------------------------------
  // Catalogue lookup
  // ------------------------------------------------------------------
  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  const byTitle = Object.create(null);
  const byFile = Object.create(null);
  CATALOGUE.forEach((t) => {
    byTitle[norm(t.title)] = t;
    byFile[norm(t.file)] = t;
  });

  function resolve(x) {
    if (!x) return null;
    if (typeof x === "string")
      return byTitle[norm(x)] || byFile[norm(x)] || null;
    if (typeof x === "object") {
      if (x.title && byTitle[norm(x.title)]) return byTitle[norm(x.title)];
      if (x.file && byFile[norm(x.file)]) return byFile[norm(x.file)];
      if (x.title && x.file)
        return { title: String(x.title), file: String(x.file) };
    }
    return null;
  }

  function urlFor(t) {
    return cfg.base + encodeURIComponent(t.file);
  }

  function resolveChapters(map) {
    const out = {};
    Object.keys(map || {}).forEach((key) => {
      const raw = map[key];
      const items = Array.isArray(raw)
        ? raw
        : raw == null || raw === ""
          ? []
          : [raw];
      const list = [];
      items.forEach((it) => {
        const t = resolve(it);
        if (t) list.push(t);
        else if (global.console)
          console.warn("[PhosAudio] unknown track for chapter", key, it);
      });
      if (list.length) out[key] = list;
    });
    return out;
  }

  // Every distinct track across the chapters, in order — the pool that
  // next() walks when a chapter lists a single track.
  function pool() {
    const seen = Object.create(null);
    const out = [];
    Object.keys(chapters).forEach((k) => {
      chapters[k].forEach((t) => {
        if (!seen[t.file]) {
          seen[t.file] = true;
          out.push(t);
        }
      });
    });
    return out.length ? out : CATALOGUE.slice();
  }

  // ------------------------------------------------------------------
  // Gain: element.volume = master × fade(element) × duck
  // ------------------------------------------------------------------
  let duckGain = 1;
  let ramps = []; // { el | null(duck), from, to, t0, dur, done }
  let rampTimer = null;

  function applyGain(el) {
    if (!el) return;
    const f = el._fade == null ? 1 : el._fade;
    const g = clamp01(cfg.volume * f * duckGain);
    if (volumeSettable) {
      try {
        el.volume = g;
      } catch (_) {}
    }
    // iOS ignores `volume`; duck by muting instead (mute state kept apart).
    el.muted = muted || (ducked && !volumeSettable);
  }
  function applyGainAll() {
    if (els) els.forEach(applyGain);
  }
  function setFade(el, v) {
    el._fade = clamp01(v);
    applyGain(el);
  }

  function cancelRamp(el) {
    ramps = ramps.filter((r) => r.el !== el);
  }

  function ramp(el, to, dur, done) {
    cancelRamp(el);
    const from = el ? (el._fade == null ? 1 : el._fade) : duckGain;
    if (dur <= 0 || !volumeSettable || from === to) {
      if (el) setFade(el, to);
      else {
        duckGain = to;
        applyGainAll();
      }
      if (done) done();
      return;
    }
    ramps.push({ el, from, to, t0: now(), dur, done: done || noop });
    if (!rampTimer) rampTimer = setInterval(tickRamps, 33);
  }

  function tickRamps() {
    const t = now();
    for (let i = ramps.length - 1; i >= 0; i--) {
      const r = ramps[i];
      const k = Math.min(1, (t - r.t0) / r.dur);
      // equal-power shape: sin for a rise, 1-cos for a fall (sum of squares = 1)
      const s =
        r.to > r.from
          ? Math.sin((k * Math.PI) / 2)
          : 1 - Math.cos((k * Math.PI) / 2);
      const v = r.from + (r.to - r.from) * s;
      if (r.el) setFade(r.el, v);
      else {
        duckGain = v;
        applyGainAll();
      }
      if (k >= 1) {
        ramps.splice(i, 1);
        r.done();
      }
    }
    if (!ramps.length && rampTimer) {
      clearInterval(rampTimer);
      rampTimer = null;
    }
  }

  // ------------------------------------------------------------------
  // Elements
  // ------------------------------------------------------------------
  function makeEl(name) {
    const el = new Audio();
    el.preload = "auto";
    el.setAttribute("data-phos-audio", name);
    el._fade = 0;
    el._seq = 0;
    el._expectPause = false;
    el.addEventListener("playing", () => onPlaying(el));
    el.addEventListener("pause", () => onPause(el));
    el.addEventListener("ended", () => onEnded(el));
    el.addEventListener("error", () => onError(el));
    // NOT `abort` — it fires on every src change (bug ledger).
    return el;
  }

  function probeVolume(el) {
    try {
      el.volume = 0.5;
      const ok = Math.abs(el.volume - 0.5) < 0.01;
      el.volume = 1;
      return ok;
    } catch (_) {
      return false;
    }
  }

  function pauseQuiet(el) {
    if (!el || el.paused) return;
    el._expectPause = true;
    el.pause();
  }

  function onPlaying(el) {
    if (el !== cur) return;
    playing = true;
    userPaused = false;
    pausedWhileHidden = false;
    reason = null;
    stopped = false;
    failSkips = 0;
    if (pending && pending.el === el) {
      const p = pending;
      pending = null;
      ramp(el, 1, p.inMs);
      if (p.outgoing && p.outgoing !== el) {
        const out = p.outgoing;
        ramp(out, 0, p.outMs, () => pauseQuiet(out));
      }
    }
    emitState();
  }

  function onPause(el) {
    const expected = el._expectPause;
    el._expectPause = false;
    if (el !== cur || expected || el.ended) return;
    // Something outside us paused the current track (media key, OS,
    // a backgrounded mobile tab). Respect it; resume on return if it
    // happened while hidden.
    userPaused = true;
    pausedWhileHidden = !!(global.document && document.hidden);
    playing = false;
    emitState();
  }

  function onEnded(el) {
    if (el !== cur) return;
    playing = false;
    advance(STEP_MS, 0);
  }

  function onError(el) {
    const e = el.error;
    if (!e || e.code === 1) return; // MEDIA_ERR_ABORTED: a normal src change
    if (el !== cur) return;
    if (track) failed[track.file] = true;
    if (global.console)
      console.warn(
        "[PhosAudio] track failed",
        track && track.title,
        "code",
        e.code,
      );
    if (skipTimer) return;
    skipTimer = setTimeout(() => {
      skipTimer = null;
      failSkips++;
      if (failSkips > 1) return stop("two tracks in a row failed");
      const nxt = nextIn(activeList, track, true);
      if (!nxt) return stop("no playable track in this chapter");
      swapTo(nxt, STEP_MS, 300, activeList);
    }, 250);
  }

  function stop(why) {
    stopped = true;
    playing = false;
    reason = why;
    pending = null;
    if (els) {
      els.forEach((el) => {
        if (el === cur) ramp(el, 0, 600, () => pauseQuiet(el));
        else {
          cancelRamp(el);
          setFade(el, 0);
          pauseQuiet(el);
        }
      });
    }
    emitState();
  }

  // Next track after `t` in `list` (wrapping). With skipFailed, walks
  // forward past failed tracks but never wraps back onto a failed one.
  function nextIn(list, t, skipFailed) {
    if (!list || !list.length) return null;
    const i = t ? list.findIndex((x) => x.file === t.file) : -1;
    for (let k = 1; k <= list.length; k++) {
      const c = list[(i + k + list.length) % list.length];
      if (skipFailed && failed[c.file]) continue;
      if (skipFailed && c.file === (t && t.file)) return null; // wrapped onto the failed one
      return c;
    }
    return null;
  }

  function advance(inMs, outMs) {
    const nxt = nextIn(activeList.length ? activeList : pool(), track, true);
    if (!nxt) return stop("nothing left to play");
    swapTo(nxt, inMs, outMs, activeList);
  }

  // Start `t` on the idle element; fade it in and the other out once it
  // is actually playing. Resolves after the play() attempt settles.
  function swapTo(t, inMs, outMs, list) {
    if (!els) return Promise.resolve(state());
    const incoming = cur === els[0] ? els[1] : els[0];
    const outgoing = cur;
    cancelRamp(incoming);
    const seq = ++loadSeq;
    incoming._seq = seq;
    incoming._expectPause = false;
    setFade(incoming, 0);
    incoming.src = urlFor(t);
    cur = incoming;
    track = t;
    if (list) activeList = list;
    if (chapter && chapters[chapter]) {
      const ci = chapters[chapter].findIndex((x) => x.file === t.file);
      if (ci >= 0) cursors[chapter] = ci;
    }
    userPaused = false;
    stopped = false;
    pending = { el: incoming, outgoing, inMs, outMs };
    emitTrack();
    emitState();
    return attemptPlay(incoming, seq);
  }

  function attemptPlay(el, seq) {
    let p;
    try {
      p = el.play();
    } catch (e) {
      p = Promise.reject(e);
    }
    if (!p || !p.then) return Promise.resolve(state());
    return p.then(
      () => state(),
      (err) => {
        if (el._seq !== seq || el !== cur) return state(); // superseded
        const name = (err && err.name) || "Error";
        if (name === "AbortError") return state(); // interrupted by our own next load
        playing = false;
        reason =
          name === "NotAllowedError"
            ? "NotAllowedError: autoplay blocked — enter() must run from a user gesture"
            : name + (err && err.message ? ": " + err.message : "");
        if (name === "NotAllowedError") armGestureRetry();
        emitState();
        return state();
      },
    );
  }

  let retryArmed = false;
  function armGestureRetry() {
    if (retryArmed || !global.document) return;
    retryArmed = true;
    const go = () => {
      retryArmed = false;
      document.removeEventListener("pointerdown", go, true);
      document.removeEventListener("keydown", go, true);
      if (entered && cur && cur.paused && !userPaused && !stopped)
        attemptPlay(cur, cur._seq);
    };
    document.addEventListener("pointerdown", go, true);
    document.addEventListener("keydown", go, true);
  }

  // Hidden tab: keep playing (the site is a listening experience). Only
  // a track paused *by the platform* while hidden is resumed on return.
  function onVisibility() {
    if (document.hidden || !entered || !cur) return;
    if (pausedWhileHidden && cur.paused && !stopped) {
      pausedWhileHidden = false;
      userPaused = false;
      attemptPlay(cur, cur._seq);
    }
  }

  // ------------------------------------------------------------------
  // Events out
  // ------------------------------------------------------------------
  function emit(kind, payload) {
    listeners[kind].slice().forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        if (global.console) console.error("[PhosAudio] listener failed", e);
      }
    });
  }
  function emitTrack() {
    updateUI();
    emit(
      "track",
      track ? { title: track.title, file: track.file, chapter } : null,
    );
  }
  function emitState() {
    updateUI();
    emit("state", state());
  }

  function state() {
    return {
      entered,
      muted,
      playing,
      ducked,
      chapter,
      track: track ? { title: track.title, file: track.file } : null,
      volume: cfg.volume,
      reason: reason || null,
      stopped,
    };
  }

  // ------------------------------------------------------------------
  // The pill
  // ------------------------------------------------------------------
  const NEXT_SVG =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">' +
    '<path d="M2.5 3.2v9.6L9 8z" fill="currentColor"/>' +
    '<rect x="10.8" y="3.2" width="1.8" height="9.6" fill="currentColor"/></svg>';

  function buildUI() {
    if (ui || !global.document || !document.body) return;
    const root = document.createElement("div");
    root.className = "phos-audio is-pre";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Soundtrack");
    root.innerHTML =
      '<span class="phos-audio__bars" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="phos-audio__title" aria-live="polite"></span>' +
      '<button type="button" class="phos-audio__btn phos-audio__mute" aria-label="Mute" aria-pressed="false" title="Mute">M</button>' +
      '<button type="button" class="phos-audio__btn phos-audio__next" aria-label="Next track" title="Next track">' +
      NEXT_SVG +
      "</button>";
    document.body.appendChild(root);
    ui = {
      root,
      title: root.querySelector(".phos-audio__title"),
      mute: root.querySelector(".phos-audio__mute"),
      next: root.querySelector(".phos-audio__next"),
    };
    ui.mute.addEventListener("click", () => toggleMute());
    ui.next.addEventListener("click", () => {
      if (!entered) enter().then(next);
      else next();
    });
    updateUI();
  }

  function updateUI() {
    if (!ui) return;
    const r = ui.root;
    r.classList.toggle("is-pre", !entered);
    r.classList.toggle("is-playing", playing && !muted);
    r.classList.toggle("is-muted", muted);
    r.classList.toggle("is-ducked", ducked);
    r.classList.toggle("is-stopped", stopped);
    ui.title.textContent = track ? track.title : "";
    ui.title.title = reason || (track ? track.title : "");
    ui.mute.setAttribute("aria-pressed", muted ? "true" : "false");
    ui.mute.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    ui.mute.title = muted ? "Unmute" : "Mute";
  }

  // ------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------
  function init(opts) {
    opts = opts || {};
    if (typeof opts.base === "string") cfg.base = opts.base;
    if (typeof opts.volume === "number" && isFinite(opts.volume))
      cfg.volume = clamp01(opts.volume);
    chapters = resolveChapters(opts.chapters || DEFAULT_CHAPTERS);
    Object.keys(chapters).forEach((k) => {
      if (cursors[k] == null) cursors[k] = 0;
    });

    if (!inited) {
      inited = true;
      try {
        muted =
          global.localStorage && localStorage.getItem(STORAGE_KEY) === "1";
      } catch (_) {
        muted = false;
      }
      els = [makeEl("a"), makeEl("b")];
      volumeSettable = probeVolume(els[0]);
      cur = null;
      if (global.document) {
        document.addEventListener("visibilitychange", onVisibility);
        if (document.body) buildUI();
        else
          document.addEventListener("DOMContentLoaded", buildUI, {
            once: true,
          });
      }
    }
    applyGainAll();

    // Record a starting track so the pill has a title before enter().
    if (!track) {
      const first =
        chapter && chapters[chapter]
          ? chapters[chapter]
          : chapters.enter || chapters[Object.keys(chapters)[0]];
      if (first) {
        track =
          first[
            cursors[chapter && chapters[chapter] ? chapter : firstKey()] || 0
          ] || first[0];
        activeList = first;
        if (!chapter) chapter = chapters.enter ? "enter" : firstKey();
      }
    }
    emitTrack();
    emitState();
    return api;
  }

  function firstKey() {
    const k = Object.keys(chapters);
    return k.length ? k[0] : null;
  }

  function currentFor(key) {
    const list = chapters[key];
    if (!list) return null;
    const i = cursors[key] || 0;
    return list[i < list.length ? i : 0];
  }

  function enter() {
    if (!inited) init();
    if (entered) return Promise.resolve(state());
    entered = true;
    if (chapterTimer) {
      clearTimeout(chapterTimer);
      chapterTimer = null;
    }
    const list = chapters[chapter] || activeList;
    const t =
      (list && list.length ? currentFor(chapter) || list[0] : null) ||
      track ||
      pool()[0];
    if (!t) {
      reason = "no tracks";
      emitState();
      return Promise.resolve(state());
    }
    return swapTo(t, FADE_IN_MS, 0, chapters[chapter] || list || []);
  }

  function setChapter(key) {
    if (!inited) init();
    if (key == null) return state();
    key = String(key);
    const same = key === chapter;
    chapter = key;
    if (chapterTimer) {
      clearTimeout(chapterTimer);
      chapterTimer = null;
    }
    const list = chapters[key];
    if (!list) {
      // no mapping: keep whatever is playing
      emitState();
      return state();
    }
    const want = currentFor(key);
    if (!entered) {
      track = want;
      activeList = list;
      emitTrack();
      emitState();
      return state();
    }
    if (same && track && want && want.file === track.file) {
      emitState();
      return state();
    }
    emitState();
    chapterTimer = setTimeout(() => {
      chapterTimer = null;
      if (chapter !== key) return; // superseded
      if (stopped) {
        // a previous failure stopped us; a new chapter is a fresh start
        failSkips = 0;
      }
      if (track && want.file === track.file && cur && !cur.paused) {
        activeList = list;
        return;
      }
      if (
        track &&
        want.file === track.file &&
        cur &&
        cur.paused &&
        !userPaused
      ) {
        activeList = list;
        attemptPlay(cur, cur._seq);
        return;
      }
      swapTo(want, XFADE_MS, XFADE_MS, list);
    }, CHAPTER_DEBOUNCE_MS);
    return state();
  }

  function setMuted(v) {
    muted = !!v;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch (_) {}
    applyGainAll();
    emitState();
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  function next() {
    if (!inited) init();
    failSkips = 0;
    const list = activeList.length > 1 ? activeList : pool();
    const nxt = nextIn(list, track, false);
    if (!nxt) return state();
    if (!entered) {
      track = nxt;
      activeList = list;
      emitTrack();
      emitState();
      return state();
    }
    swapTo(nxt, STEP_MS, STEP_MS, list);
    return state();
  }

  function duck(on) {
    on = !!on;
    if (on === ducked) return state();
    ducked = on;
    ramp(null, on ? DUCK_GAIN : 1, on ? DUCK_MS : UNDUCK_MS);
    applyGainAll();
    emitState();
    return state();
  }

  function playTrack(title) {
    if (!inited) init();
    const t = resolve(title);
    if (!t) return Promise.resolve(false);
    failSkips = 0;
    if (!entered) {
      // A per-track button is a gesture: it may unlock the player.
      track = t;
      if (!activeList.length) activeList = chapters[chapter] || pool();
      entered = true;
      return swapTo(t, FADE_IN_MS, 0, activeList).then(() => true);
    }
    if (track && track.file === t.file && cur && !cur.paused)
      return Promise.resolve(true);
    return swapTo(t, STEP_MS, STEP_MS, activeList).then(() => true);
  }

  function on(kind, fn) {
    if (!listeners[kind] || typeof fn !== "function") return noop;
    listeners[kind].push(fn);
    return () => {
      const i = listeners[kind].indexOf(fn);
      if (i >= 0) listeners[kind].splice(i, 1);
    };
  }

  function off(kind, fn) {
    if (!listeners[kind]) return;
    const i = listeners[kind].indexOf(fn);
    if (i >= 0) listeners[kind].splice(i, 1);
  }

  const api = {
    init,
    enter,
    setChapter,
    toggleMute,
    setMuted,
    next,
    duck,
    state,
    on,
    off,
    playTrack,
    resolve: (x) => {
      const t = resolve(x);
      return t ? { title: t.title, file: t.file } : null;
    },
    get defaultChapters() {
      const o = {};
      Object.keys(DEFAULT_CHAPTERS).forEach(
        (k) => (o[k] = DEFAULT_CHAPTERS[k].slice()),
      );
      return o;
    },
    get catalogue() {
      return CATALOGUE.map((t) => ({ title: t.title, file: t.file }));
    },
    get chapters() {
      const o = {};
      Object.keys(chapters).forEach(
        (k) => (o[k] = chapters[k].map((t) => t.title)),
      );
      return o;
    },
    get elements() {
      return els ? els.slice() : [];
    },
  };

  global.PhosAudio = api;
})(typeof window !== "undefined" ? window : this);
