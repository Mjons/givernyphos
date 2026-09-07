/* site.js — the shell for site/index.html (agent A). Plain script, no
   modules: the site must open from a folder. Consumes window.PHOS_CONTENT
   (content.js) and window.PhosAudio (audio.js); both are optional at
   runtime — without content the page says so, without audio the gate
   still works silently. Contract: docs/active/SITE_PLAN.md. */
(function () {
  "use strict";

  var doc = document;
  var body = doc.body;
  var gate = doc.getElementById("gate");
  var main = doc.getElementById("chapters");
  var rail = doc.getElementById("rail");
  var notice = doc.getElementById("notice");

  var C = window.PHOS_CONTENT && typeof window.PHOS_CONTENT === "object" ? window.PHOS_CONTENT : null;
  var reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = matchMedia("(hover: none) and (pointer: coarse)").matches;
  var posterMode = reducedMotion || coarse; // the poster with "Open live" instead of a frame

  var entered = false;
  var current = null; // key of the chapter that owns the viewport
  var liveFrame = null; // { key, iframe } — never two at once
  var chapters = []; // [{ key, title, el, sky, scene, cover }]
  var byEl = new Map();
  var railButtons = {};
  var trackRows = []; // [{ li, title, file }]

  function audio() {
    var A = window.PhosAudio;
    return A && typeof A === "object" ? A : null;
  }
  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      if (window.console) console.warn("[site]", e && e.message ? e.message : e);
    }
  }
  function appUrl(path) {
    return (C && C.appBase ? C.appBase : "../") + path;
  }

  // ---- tiny DOM helper ----
  function h(tag, attrs, kids) {
    var el = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "text") el.textContent = v;
        else if (k === "class") el.className = v;
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    if (kids != null) {
      (Array.isArray(kids) ? kids : [kids]).forEach(function (k) {
        if (k == null || k === false) return;
        el.appendChild(typeof k === "string" ? doc.createTextNode(k) : k);
      });
    }
    return el;
  }
  function ext(attrs) {
    attrs.target = "_blank";
    attrs.rel = "noopener";
    return attrs;
  }
  function paragraphs(list, cls) {
    var wrap = h("div", { class: cls || "body" });
    (Array.isArray(list) ? list : list ? [list] : []).forEach(function (t) {
      if (t) wrap.appendChild(h("p", { text: t }));
    });
    return wrap;
  }

  // ---- head: Open Graph from content ----
  function setMeta(site) {
    if (!site) return;
    var full = (site.title || "Giverny Phos") + (site.subtitle ? " · " + site.subtitle : "");
    var set = function (sel, val) {
      if (!val) return;
      var m = doc.querySelector(sel);
      if (m) m.setAttribute("content", val);
    };
    doc.title = full;
    set('meta[property="og:title"]', full);
    set('meta[name="twitter:title"]', full);
    set('meta[name="description"]', site.oneLine);
    set('meta[property="og:description"]', site.oneLine);
    set('meta[property="og:image"]', site.ogImage);
    set('meta[name="twitter:image"]', site.ogImage);
    set('meta[property="og:url"]', site.live);
    set('meta[property="og:site_name"]', site.title);
    set('meta[name="twitter:site"]', site.author);
    var name = doc.getElementById("gate-name");
    var sub = doc.getElementById("gate-sub");
    var line = doc.getElementById("gate-line");
    if (name && site.title) name.textContent = site.title;
    if (sub && site.subtitle) sub.textContent = site.subtitle;
    if (line && site.oneLine) line.textContent = site.oneLine;
  }

  // ---- what a live scene is, from its url (for the data line) ----
  function describeScene(scene) {
    var q = {};
    try {
      var qs = scene.url.split("?")[1] || "";
      qs.split("&").forEach(function (p) {
        if (!p) return;
        var kv = p.split("=");
        q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
      });
    } catch (e) {}
    var label = "live";
    var openUrl = scene.url;
    if (q.id) {
      var id = parseInt(q.id, 10);
      var tok = C && C.tokens ? C.tokens.filter(function (t) { return t.id === id; })[0] : null;
      label = "#" + id + (tok && tok.family ? "  " + tok.family : "");
      openUrl = "index.html?id=" + id; // the full token page, with its intro
    } else if (q.film) {
      label = "film  " + q.film;
    } else if (q.scene) {
      label = q.scene;
    }
    return { label: label, openUrl: openUrl };
  }

  // ---- live frames: one at a time ----
  function mountLive(c) {
    if (!entered || posterMode || !c.scene || !c.sky) return;
    if (liveFrame && liveFrame.key === c.key) return;
    unmountLive();
    var fr = doc.createElement("iframe");
    fr.className = "live-frame";
    fr.title = (c.title || "Giverny Phos") + " — live simulation";
    // file:// frames have an opaque origin: the bare allow="fullscreen"
    // form disables fullscreen inside them (CHANGELOG ledger), so grant
    // it to every origin explicitly and keep the legacy attribute.
    fr.setAttribute("allow", "fullscreen *");
    fr.setAttribute("allowfullscreen", "");
    fr.addEventListener("load", function () {
      fr.classList.add("on");
    });
    fr.src = appUrl(c.scene.url);
    c.sky.appendChild(fr);
    liveFrame = { key: c.key, iframe: fr };
  }
  function unmountLive() {
    if (!liveFrame) return;
    var fr = liveFrame.iframe;
    liveFrame = null;
    fr.classList.remove("on");
    try {
      fr.src = "about:blank";
    } catch (e) {}
    if (fr.parentNode) fr.parentNode.removeChild(fr);
  }

  // ---- renderers ----
  function renderSky(ch) {
    var sky = h("div", { class: "sky", "aria-hidden": "true" });
    if (ch.scene.poster) sky.appendChild(h("img", { class: "poster", src: ch.scene.poster, alt: "" }));
    return sky;
  }
  function renderSceneData(ch) {
    var d = describeScene(ch.scene);
    var row = h("div", { class: "scene-data" });
    if (posterMode) {
      row.appendChild(h("span", { text: d.label }));
      row.appendChild(h("a", ext({ class: "open-live", href: appUrl(d.openUrl), text: "Open live" })));
    } else {
      var lab = h("span");
      lab.appendChild(h("i", { class: "live-dot" }));
      lab.appendChild(doc.createTextNode("live  " + d.label));
      row.appendChild(lab);
      row.appendChild(h("a", ext({ href: appUrl(d.openUrl), text: "open in a new tab" })));
    }
    return row;
  }
  function titleCard(ch) {
    var frag = doc.createDocumentFragment();
    frag.appendChild(h("i", { class: "rule" }));
    var card = h("div", { class: "card" });
    if (ch.kicker) card.appendChild(h("p", { class: "kicker", text: ch.kicker }));
    card.appendChild(h("h2", { class: "title", text: ch.title || ch.key }));
    card.appendChild(paragraphs(ch.body));
    frag.appendChild(card);
    return frag;
  }

  function renderHero(ch) {
    var site = C.site || {};
    var sec = h("section", { class: "chapter live k-" + ch.key, id: ch.key, "aria-label": ch.title || site.title });
    var sky = renderSky(ch);
    sec.appendChild(sky);
    var grid = h("div", { class: "grid stage" });
    var mast = h("div", { class: "masthead text" });
    mast.appendChild(h("p", { class: "name", text: site.title || "Giverny Phos", role: "heading", "aria-level": "2" }));
    if (site.subtitle) mast.appendChild(h("p", { class: "sub", text: site.subtitle }));
    mast.appendChild(h("p", { class: "line", text: site.oneLine || ch.kicker || "" }));
    if (ch.body && ch.body.length) mast.appendChild(paragraphs(ch.body, "body"));
    grid.appendChild(mast);
    sec.appendChild(grid);
    sec.appendChild(renderSceneData(ch));
    return { el: sec, sky: sky };
  }

  function renderLive(ch) {
    var sec = h("section", { class: "chapter live k-" + ch.key, id: ch.key, "aria-label": ch.title });
    var sky = renderSky(ch);
    sec.appendChild(sky);
    var grid = h("div", { class: "grid" });
    var text = h("div", { class: "text" });
    text.appendChild(titleCard(ch));
    grid.appendChild(text);
    sec.appendChild(grid);
    sec.appendChild(renderSceneData(ch));
    return { el: sec, sky: sky };
  }

  function renderFlat(ch, extra) {
    var sec = h("section", { class: "chapter flat k-" + ch.key, id: ch.key, "aria-label": ch.title });
    var grid = h("div", { class: "grid" });
    var text = h("div", { class: "text" });
    text.appendChild(titleCard(ch));
    grid.appendChild(text);
    sec.appendChild(grid);
    if (extra) extra(sec, grid);
    return { el: sec };
  }

  function renderFamilies(ch) {
    return renderFlat(ch, function (sec) {
      var fams = C.families || [];
      var head = h("div", { class: "strip-head grid" });
      var ctl = h("div", { class: "wide", style: "display:flex;justify-content:flex-end;gap:22px" });
      var prev = h("button", { type: "button", text: "previous", "aria-label": "Previous family" });
      var next = h("button", { type: "button", text: "next", "aria-label": "Next family" });
      ctl.appendChild(prev);
      ctl.appendChild(next);
      head.appendChild(ctl);
      var strip = h("div", { class: "strip", role: "list", "aria-label": "The seventeen families" });
      fams.forEach(function (f) {
        var firstId = f.ids && f.ids.length ? f.ids[0] : null;
        var fig = h("figure", { role: "listitem" });
        var img = h("img", {
          class: "fam-img",
          src: f.hero || f.thumb,
          alt: f.name + (f.sentence ? " — " + f.sentence : ""),
          loading: "lazy",
          decoding: "async",
        });
        if (firstId != null) fig.appendChild(h("a", ext({ href: appUrl("index.html?id=" + firstId), "aria-label": "Open " + f.name + " live" }), img));
        else fig.appendChild(img);
        var cap = h("figcaption");
        var row = h("div", { class: "fam-row" });
        var nameAttrs = { class: "fam-name", text: f.name };
        row.appendChild(firstId != null ? h("a", ext(Object.assign({ href: appUrl("index.html?id=" + firstId) }, nameAttrs))) : h("span", nameAttrs));
        var n = f.count != null ? f.count : f.ids ? f.ids.length : null;
        var meta = [];
        if (n != null) meta.push(n + (n === 1 ? " token" : " tokens"));
        if (f.tier) meta.push(f.tier);
        row.appendChild(h("span", { class: "fam-meta" + (f.tier === "rare" ? " rare" : ""), text: meta.join(", ") }));
        cap.appendChild(row);
        if (f.sentence) cap.appendChild(h("p", { class: "fam-sentence", text: f.sentence }));
        var links = h("p", { class: "fam-links" });
        links.appendChild(h("a", ext({ href: appUrl("collection.html#family=" + encodeURIComponent(f.scene || f.name)), text: "in the collection" })));
        cap.appendChild(links);
        fig.appendChild(cap);
        strip.appendChild(fig);
      });
      var step = function (dir) {
        var card = strip.firstElementChild;
        var w = card ? card.getBoundingClientRect().width + 28 : strip.clientWidth * 0.8;
        strip.scrollBy({ left: dir * w, behavior: reducedMotion ? "auto" : "smooth" });
      };
      prev.addEventListener("click", function () { step(-1); });
      next.addEventListener("click", function () { step(1); });
      sec.appendChild(head);
      sec.appendChild(strip);
    });
  }

  function renderHundred(ch) {
    return renderFlat(ch, function (sec) {
      var toks = (C.tokens || []).slice().sort(function (a, b) { return a.id - b.id; });
      var sheet = h("div", { class: "sheet", role: "list", "aria-label": "The hundred tokens" });
      toks.forEach(function (t) {
        var a = h("a", {
          href: appUrl("collection.html#id=" + t.id),
          role: "listitem",
          title: "#" + t.id + (t.family ? "  " + t.family : ""),
          "aria-label": "Token " + t.id + (t.family ? ", " + t.family : ""),
        });
        a.appendChild(h("img", { src: t.thumb, alt: "", loading: "lazy", decoding: "async" }));
        a.appendChild(h("span", { class: "id", text: String(t.id) }));
        sheet.appendChild(a);
      });
      sec.appendChild(sheet);
      sec.appendChild(h("p", { class: "sheet-note", text: toks.length + " tokens. The still is each token at its first moments; the live piece is what it becomes." }));
    });
  }

  function renderMint(ch) {
    return renderFlat(ch, function (sec, grid) {
      var m = C.mint || {};
      if (m.question) grid.appendChild(h("p", { class: "question", text: m.question }));
      var cols = h("div", { class: "mint-cols" });
      var left = h("div");
      if (m.detail) left.appendChild(h("p", { class: "detail", text: m.detail }));
      if (m.rule) left.appendChild(h("p", { class: "rule-text", text: m.rule }));
      if (m.cta && m.link) left.appendChild(h("a", ext({ class: "cta", href: m.link, text: m.cta })));
      cols.appendChild(left);
      if (m.facts && m.facts.length) {
        var ul = h("ul", { class: "facts" });
        m.facts.forEach(function (f) { ul.appendChild(h("li", { text: f })); });
        cols.appendChild(ul);
      }
      grid.appendChild(cols);
    });
  }

  function renderMusic(ch) {
    return renderFlat(ch, function (sec, grid) {
      var A = audio();
      var playFn = null;
      if (A) ["playTrack", "play", "setTrack", "select"].some(function (n) {
        if (typeof A[n] === "function") { playFn = n; return true; }
        return false;
      });
      var ol = h("ol", { class: "tracks", "aria-label": "Soundtrack" });
      (C.tracks || []).forEach(function (t, i) {
        var li = h("li");
        li.appendChild(h("span", { class: "n", text: (i + 1 < 10 ? "0" : "") + (i + 1), "aria-hidden": "true" }));
        li.appendChild(h("span", { class: "t", text: t.title }));
        if (playFn) {
          var b = h("button", { type: "button", class: "play", text: "play", "aria-label": "Play " + t.title });
          b.addEventListener("click", function () {
            safe(function () {
              if (!entered) enter(false);
              A[playFn](playFn === "playTrack" ? t.title : t);
            });
          });
          li.appendChild(b);
        }
        trackRows.push({ li: li, title: (t.title || "").toLowerCase(), file: (t.file || "").toLowerCase() });
        ol.appendChild(li);
      });
      grid.appendChild(ol);
      if (C.tracks && C.tracks.length) {
        grid.appendChild(h("p", { class: "tracks-note", text: C.tracks.length + " tracks. The soundtrack belongs to this site; the token plays without music." }));
      }
    });
  }

  function renderCredits(ch) {
    return renderFlat(ch, function (sec, grid) {
      var cr = C.credits || {};
      var site = C.site || {};
      var dl = h("dl", { class: "credits-list" });
      var row = function (label, node) {
        if (!node) return;
        dl.appendChild(h("dt", { text: label }));
        dl.appendChild(h("dd", null, node));
      };
      var author = cr.author || site.author;
      if (author) row("Made by", site.x ? h("a", ext({ href: site.x, text: author })) : doc.createTextNode(author));
      if (cr.license) row("License", doc.createTextNode(cr.license));
      if (cr.tech && cr.tech.length) {
        var ul = h("ul", { class: "tech" });
        cr.tech.forEach(function (t) { ul.appendChild(h("li", { text: t })); });
        row("Built with", ul);
      }
      var links = (cr.links || []).slice();
      var has = function (path) {
        return links.some(function (l) { return String(l.href || "").indexOf(path) >= 0; });
      };
      if (!has("index.html")) links.push({ label: "Open the piece", href: appUrl("index.html") });
      if (!has("collection.html")) links.push({ label: "The collection viewer", href: appUrl("collection.html") });
      if (site.live && !has(site.live)) links.push({ label: "The live site", href: site.live });
      var dd = h("span");
      links.forEach(function (l, i) {
        if (i) dd.appendChild(h("span", { class: "sep", text: "/" }));
        dd.appendChild(h("a", ext({ href: l.href, text: l.label })));
      });
      row("Links", dd);
      sec.querySelector(".text").appendChild(dl);
      if (site.tagline) grid.appendChild(h("p", { class: "signoff", text: site.tagline }));
    });
  }

  function renderChapter(ch, i) {
    var live = ch.scene && ch.scene.kind === "live" && ch.scene.url;
    if (i === 0 && live) return renderHero(ch);
    if (live) return renderLive(ch);
    switch (ch.key) {
      case "families": return renderFamilies(ch);
      case "hundred": return renderHundred(ch);
      case "mint": return renderMint(ch);
      case "music": return renderMusic(ch);
      case "credits": return renderCredits(ch);
      default: return renderFlat(ch);
    }
  }

  // ---- rail ----
  function buildRail() {
    chapters.forEach(function (c) {
      var b = h("button", { type: "button", "aria-label": c.title, title: c.title }, [h("span", { text: c.key }), h("i")]);
      b.addEventListener("click", function () { goTo(c); });
      rail.appendChild(b);
      railButtons[c.key] = b;
    });
  }
  function goTo(c) {
    if (!c) return;
    c.el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }
  function step(dir) {
    var i = chapters.findIndex(function (c) { return c.key === current; });
    goTo(chapters[Math.max(0, Math.min(chapters.length - 1, i + dir))]);
  }

  // ---- which chapter owns the viewport ----
  function setCurrent(c) {
    current = c.key;
    body.setAttribute("data-chapter", c.key);
    Object.keys(railButtons).forEach(function (k) {
      var on = k === c.key;
      railButtons[k].classList.toggle("current", on);
      if (on) railButtons[k].setAttribute("aria-current", "true");
      else railButtons[k].removeAttribute("aria-current");
    });
    var A = audio();
    if (A && typeof A.setChapter === "function") safe(function () { A.setChapter(c.key); });
  }
  function update() {
    var best = null;
    chapters.forEach(function (c) {
      if (!best || c.cover > best.cover + 1e-6) best = c;
    });
    if (!best || best.cover <= 0) return;
    if (best.key !== current) setCurrent(best);
    if (best.scene && best.cover >= 0.5) mountLive(best);
    if (liveFrame) {
      var owner = chapters.filter(function (c) { return c.key === liveFrame.key; })[0];
      if (owner && owner.cover < 0.1) unmountLive();
    }
  }
  function observe() {
    var thresholds = [];
    for (var t = 0; t <= 1.0001; t += 0.05) thresholds.push(Math.min(1, t));
    var io = new IntersectionObserver(function (entries) {
      var vh = window.innerHeight || 1;
      entries.forEach(function (en) {
        var c = byEl.get(en.target);
        if (!c) return;
        var rb = en.rootBounds && en.rootBounds.height ? en.rootBounds.height : vh;
        c.cover = en.isIntersecting ? en.intersectionRect.height / rb : 0;
        if (en.intersectionRatio >= 0.2 || c.cover >= 0.35) c.el.classList.add("seen");
      });
      update();
    }, { threshold: thresholds });
    chapters.forEach(function (c) { io.observe(c.el); });
  }

  // ---- audio: chapter map, now-playing ----
  function initAudio() {
    var A = audio();
    if (!A) return;
    // The chapter → track mapping is audio.js's own (SITE_PLAN §3): hand
    // its defaultChapters back to init, never content.js's one-liners.
    if (typeof A.init === "function") {
      safe(function () {
        var opts = { base: appUrl("ssi_tracks/"), volume: 0.6 };
        if (A.defaultChapters) opts.chapters = A.defaultChapters;
        A.init(opts);
      });
    }
    var markNow = function (x) {
      var tr = x && x.track ? x.track : x;
      var title = tr && tr.title ? String(tr.title).toLowerCase() : "";
      var file = tr && tr.file ? String(tr.file).toLowerCase() : "";
      trackRows.forEach(function (r) {
        var on = !!(title && r.title === title) || !!(file && r.file === file);
        r.li.classList.toggle("now", on);
        if (on) r.li.setAttribute("aria-current", "true");
        else r.li.removeAttribute("aria-current");
      });
    };
    if (typeof A.on === "function") safe(function () { A.on("track", markNow); });
    safe(function () { if (typeof A.state === "function") markNow(A.state()); });
  }

  // ---- the gate ----
  function enter(silent) {
    if (entered) return;
    entered = true;
    var A = audio();
    if (A) safe(function () {
      if (silent) {
        if (typeof A.setMuted === "function") A.setMuted(true);
        else if (typeof A.toggleMute === "function") {
          var st = typeof A.state === "function" ? A.state() : null;
          if (!(st && st.muted)) A.toggleMute();
        }
      }
      if (typeof A.enter === "function") {
        var p = A.enter();
        if (p && typeof p.catch === "function") p.catch(function () {});
      }
    });
    body.classList.remove("pre");
    body.classList.add("entered");
    gate.classList.add("leaving");
    var done = function () {
      gate.classList.add("gone");
      gate.setAttribute("aria-hidden", "true");
    };
    if (reducedMotion) done();
    else setTimeout(done, 2100);
    update(); // mounts the hero's frame under the dissolving gate
    if (location.hash) {
      var target = chapters.filter(function (c) { return "#" + c.key === location.hash; })[0];
      if (target) setTimeout(function () { goTo(target); }, reducedMotion ? 0 : 600);
    }
    wake();
  }

  // ---- idle: body.idle after 5 s without input ----
  var idleTimer = null;
  function wake() {
    body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (entered) body.classList.add("idle");
    }, 5000);
  }

  // ---- fullscreen from a live frame: duck the music ----
  function onFullscreen() {
    var A = audio();
    var on = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (A && typeof A.duck === "function") safe(function () { A.duck(on); });
  }

  // ---- keyboard ----
  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && /^(input|textarea|select)$/i.test(t.tagName || "")) return;
    if (!entered) return;
    switch (e.key) {
      case "ArrowDown":
      case "j":
      case "J":
        step(1);
        e.preventDefault();
        break;
      case "ArrowUp":
      case "k":
      case "K":
        step(-1);
        e.preventDefault();
        break;
      case "m":
      case "M":
        var A = audio();
        if (A && typeof A.toggleMute === "function") safe(function () { A.toggleMute(); });
        break;
      case "Escape":
        break; // closes nothing; harmless
    }
  }

  // ---- build ----
  function noContent() {
    var msg = h("span");
    msg.appendChild(h("b", { text: "content.js not loaded" }));
    msg.appendChild(doc.createTextNode(" — the chapters, the families and the hundred come from site/content.js, which is missing or failed to load. The gate still works; there is nothing behind it yet."));
    notice.appendChild(msg);
    notice.hidden = false;
    var after = h("section", { class: "chapter flat", id: "missing" });
    var grid = h("div", { class: "grid" });
    var text = h("div", { class: "text" });
    text.appendChild(h("div", { class: "notice", text: "content.js not loaded — nothing to show." }));
    grid.appendChild(text);
    after.appendChild(grid);
    main.appendChild(after);
  }

  function build() {
    if (!C || !Array.isArray(C.chapters) || !C.chapters.length) {
      noContent();
      return;
    }
    setMeta(C.site);
    var first = C.chapters[0];
    var gatePoster = gate.querySelector(".poster");
    if (first.scene && first.scene.poster) gatePoster.src = first.scene.poster;
    C.chapters.forEach(function (ch, i) {
      var r = renderChapter(ch, i);
      var c = { key: ch.key, title: ch.title || ch.key, el: r.el, sky: r.sky || null, scene: ch.scene && ch.scene.kind === "live" ? ch.scene : null, cover: 0 };
      chapters.push(c);
      byEl.set(r.el, c);
      main.appendChild(r.el);
    });
    buildRail();
    initAudio();
    observe();
  }

  doc.getElementById("enter-sound").addEventListener("click", function () { enter(false); });
  doc.getElementById("enter-silent").addEventListener("click", function () { enter(true); });
  doc.addEventListener("keydown", onKey);
  ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach(function (ev) {
    doc.addEventListener(ev, wake, { passive: true });
  });
  doc.addEventListener("fullscreenchange", onFullscreen);
  doc.addEventListener("webkitfullscreenchange", onFullscreen);
  window.addEventListener("pagehide", unmountLive);

  build();

  // A small handle for the coordinator's checks (not a public API).
  window.__site = {
    enter: enter,
    current: function () { return current; },
    live: function () { return liveFrame ? liveFrame.key : null; },
    chapters: function () { return chapters.map(function (c) { return { key: c.key, cover: +c.cover.toFixed(2) }; }); },
    posterMode: posterMode,
  };
})();
