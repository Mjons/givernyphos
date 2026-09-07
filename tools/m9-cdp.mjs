// m9-cdp.mjs — drive a headless Chrome over the DevTools protocol.
//
// Run with the *Windows* node (127.0.0.1:<port> is local to Windows):
//   "/mnt/c/Program Files/nodejs/node.exe" L:\...\tools\m9-cdp.mjs \
//       --port 9222 --url "file:///L:/.../index.html?..." --wait 20000 \
//       --shot "C:\Users\Public\m9\x.png" --json "C:\Users\Public\m9\x.json"
//
// Sequence: connect, subscribe to console, inject (seeded Math.random,
// HUD-hiding CSS, a rAF frame counter), pin the viewport, Page.navigate,
// wait a real <wait> ms — or stop early once --until <js expr> is truthy
// or a console line contains --until-console <text> (e.g. the page's
// ?freeze run reporting done) — then optionally wait for the picture to
// stop changing (--stable: consecutive screenshots differ by less than
// a mean of N/255; the frozen state reaches the render textures a few
// seconds after freeze=done on the WebGPU backend), optionally measure
// real-clock fps over a --measure window, Runtime.evaluate
// JSON.stringify(window.__perfSnapshot()) (fallback: #perf-json
// textContent), Page.captureScreenshot, and Browser.close — so the
// harness never has to taskkill chrome.exe, which would also hit the
// user's own browser.
//
// Everything is real time. Chrome's virtual time (--virtual-time-budget
// or Emulation.setVirtualTimePolicy) does not advance this page's rAF
// loop in --headless=new (tested 2026-09-06: identical DOM at 2/15/30 s
// budgets, and the CDP variant hangs in Page.navigate), so determinism
// comes from the page's ?freeze=<steps> flag instead.
//
// No npm deps: uses the global WebSocket (Node >= 22), fetch and zlib.
// Called by tools/m9-perf.py and tools/m9-look.py; usable standalone.

import { writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes("--" + name);

const PORT = +arg("port", 9222);
const URL_ = arg("url", "about:blank");
const WAIT = +arg("wait", 20000); // real ms to wait after navigation
const UNTIL = arg("until", ""); // js expression; stop waiting when truthy
const UNTIL_CONSOLE = arg("until-console", ""); // ...or when a console line contains this
const SETTLE = +arg("settle", 500); // real ms after the until-condition is met
const STABLE = +arg("stable", 0); // mean |diff| (0-255) between consecutive shots
const STABLE_MAX = +arg("stable-max", 45000); // give up waiting for stability after
const STABLE_INTERVAL = +arg("stable-interval", 1000);
const STABLE_COUNT = +arg("stable-count", 2); // consecutive diffs below STABLE needed
const MEASURE = +arg("measure", 0); // real ms window for frame-count fps
const SHOT = arg("shot", "");
const JSON_OUT = arg("json", "");
const VIEWPORT = arg("viewport", ""); // e.g. 1920x1080
const SEED_RANDOM = arg("seed-random", ""); // seed Math.random on every document
const HIDE = arg("hide", has("hide-hud") ? "#hud,#rail,#toast" : "");
const EVAL = arg("eval", ""); // extra js expression, returned as `eval`
const CONNECT_TIMEOUT = +arg("connect-timeout", 30000);
const KEEP_OPEN = has("keep-open");
const VERBOSE = has("verbose");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[m9-cdp]", ...a);

async function waitForChrome() {
  const t0 = Date.now();
  let lastErr = "";
  while (Date.now() - t0 < CONNECT_TIMEOUT) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) {
      lastErr = e.message;
    }
    await sleep(250);
  }
  throw new Error(
    `no DevTools endpoint on 127.0.0.1:${PORT} after ${CONNECT_TIMEOUT} ms (${lastErr})`,
  );
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id != null) {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      } else if (m.method) {
        const h = this.handlers.get(m.method);
        if (h) h(m.params);
      }
    };
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = (e) =>
        rej(new Error("websocket error " + (e.message || "")));
    });
  }
  on(method, fn) {
    this.handlers.set(method, fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
  }
  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}

async function closeBrowser(version) {
  if (KEEP_OPEN) return;
  try {
    const b = new CDP(version.webSocketDebuggerUrl);
    await b.open();
    await b.send("Browser.close");
    b.close();
  } catch (e) {
    log("Browser.close failed:", e.message);
  }
}

function fmtConsole(p) {
  const txt = (p.args || [])
    .map((a) =>
      a.value !== undefined ? String(a.value) : a.description || a.type,
    )
    .join(" ");
  return `${p.type}: ${txt}`;
}

// Minimal PNG decoder (8-bit, non-interlaced — what captureScreenshot
// emits) so the stability check can compare pixels without an image
// library.
function decodePng(buf) {
  let pos = 8;
  const idat = [];
  let w = 0,
    h = 0,
    depth = 0,
    colorType = 0,
    interlace = 0;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (depth !== 8 || interlace !== 0 || !ch)
    throw new Error("unsupported PNG layout");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let ip = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[ip++];
    const o = y * stride,
      po = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[o + x - ch] : 0;
      const b = y > 0 ? out[po + x] : 0;
      const c = x >= ch && y > 0 ? out[po + x - ch] : 0;
      let v = raw[ip++];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[o + x] = v & 255;
    }
  }
  return { width: w, height: h, channels: ch, data: out };
}

// Mean absolute RGB difference (0-255), every other pixel.
function meanAbsDiff(p, q) {
  if (p.data.length !== q.data.length) return 255;
  const ch = p.channels;
  let sum = 0,
    n = 0;
  for (let i = 0; i + 2 < p.data.length; i += ch * 2) {
    sum +=
      Math.abs(p.data[i] - q.data[i]) +
      Math.abs(p.data[i + 1] - q.data[i + 1]) +
      Math.abs(p.data[i + 2] - q.data[i + 2]);
    n += 3;
  }
  return n ? sum / n : 0;
}

// mulberry32 — same generator the page uses for its own seeded RNG.
const seedRandomSource = (seed) => `(function(){
  var s = ${seed >>> 0};
  Math.random = function(){
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;

const hideSource = (selectors) => `(function(){
  function add(){
    var st = document.createElement('style');
    st.id = 'm9-hide';
    st.textContent = ${JSON.stringify(selectors)} + '{visibility:hidden !important}';
    (document.head || document.documentElement).appendChild(st);
  }
  if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
})();`;

// Count rAF callbacks so a run can report how many frames the page
// actually rendered, independent of the page's own fps counter.
const frameCounterSource = `(function(){
  var raf = window.requestAnimationFrame.bind(window);
  window.__m9frames = 0;
  window.requestAnimationFrame = function(cb){
    return raf(function(t){ window.__m9frames++; return cb(t); });
  };
})();`;

(async () => {
  const version = await waitForChrome();
  log("connected to", version.Browser);
  if (has("close-only")) {
    // Wrapper timed out mid-run: just shut this Chrome down cleanly.
    await closeBrowser(version);
    process.exit(0);
  }

  // Pick (or create) a real page target — headless=new also lists
  // extension background pages and browser_ui targets.
  const targets = await (
    await fetch(`http://127.0.0.1:${PORT}/json/list`)
  ).json();
  let page = targets.find((t) => t.type === "page");
  if (!page) {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {
      method: "PUT",
    });
    page = await r.json();
  }

  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();

  const consoleLines = [];
  let consoleHit = false;
  cdp.on("Runtime.consoleAPICalled", (p) => {
    const line = fmtConsole(p);
    consoleLines.push(line);
    if (UNTIL_CONSOLE && line.includes(UNTIL_CONSOLE)) consoleHit = true;
    if (VERBOSE) log("console", line);
  });
  cdp.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails || {};
    const line = `exception: ${d.text || ""} ${(d.exception && d.exception.description) || ""}`;
    consoleLines.push(line);
    if (VERBOSE) log(line);
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  if (VIEWPORT) {
    const [w, h] = VIEWPORT.toLowerCase().split("x").map(Number);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  if (SEED_RANDOM !== "") {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: seedRandomSource(+SEED_RANDOM),
    });
  }
  if (HIDE) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: hideSource(HIDE),
    });
  }
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: frameCounterSource,
  });

  const ev = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        "evaluate failed: " +
          ((r.exceptionDetails.exception &&
            r.exceptionDetails.exception.description) ||
            r.exceptionDetails.text),
      );
    }
    return r.result.value;
  };
  const shoot = async () => {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(r.data, "base64");
  };

  const t0 = Date.now();
  await cdp.send("Page.navigate", { url: URL_ });
  const untilDesc = [
    UNTIL && `js: ${UNTIL}`,
    UNTIL_CONSOLE && `console: ${UNTIL_CONSOLE}`,
  ]
    .filter(Boolean)
    .join(" | ");
  log(
    "navigated; waiting up to",
    WAIT,
    "ms" + (untilDesc ? ` or until ${untilDesc}` : ""),
  );
  const deadline = t0 + WAIT;
  let untilMet = null;
  let untilMs = null;
  if (UNTIL || UNTIL_CONSOLE) {
    untilMet = false;
    while (Date.now() < deadline && !untilMet) {
      await sleep(250);
      if (consoleHit) untilMet = true;
      else if (UNTIL) {
        try {
          untilMet = !!(await ev(`!!(${UNTIL})`));
        } catch (_) {}
      }
    }
    untilMs = Date.now() - t0;
    log(
      untilMet
        ? `until-condition met after ${untilMs} ms`
        : "until-condition NOT met before deadline",
    );
    if (untilMet && SETTLE > 0) await sleep(SETTLE);
  } else {
    await sleep(WAIT);
  }

  // Wait for the picture to stop changing (mean |diff| between two
  // consecutive captures below STABLE). Film grain re-rolls per frame,
  // so the threshold has to sit above that floor (~7-8/255 at grain
  // 0.04) and below a real state change (tens).
  let stability = null;
  if (STABLE > 0) {
    const t1 = Date.now();
    const diffs = [];
    let prev = null;
    let stable = false;
    let below = 0;
    while (Date.now() - t1 < STABLE_MAX) {
      let png;
      try {
        png = decodePng(await shoot());
      } catch (e) {
        stability = { error: e.message };
        break;
      }
      if (prev) {
        const d = meanAbsDiff(prev, png);
        diffs.push(+d.toFixed(2));
        if (VERBOSE) log(`stability: consecutive mean diff ${d.toFixed(2)}`);
        below = d < STABLE ? below + 1 : 0;
        if (below >= STABLE_COUNT) {
          stable = true;
          break;
        }
      }
      prev = png;
      await sleep(STABLE_INTERVAL);
    }
    if (!stability) stability = { stable, diffs, waitedMs: Date.now() - t1 };
    log(
      stable
        ? `picture stable after ${Date.now() - t1} ms`
        : `picture NOT stable within ${STABLE_MAX} ms`,
    );
  }

  // Real-clock fps from the injected frame counter over a window.
  let measured = null;
  if (MEASURE > 0) {
    try {
      const a = await ev("[window.__m9frames, performance.now()]");
      await sleep(MEASURE);
      const b = await ev("[window.__m9frames, performance.now()]");
      const frames = b[0] - a[0];
      const secs = (b[1] - a[1]) / 1000;
      measured = {
        frames,
        seconds: +secs.toFixed(3),
        fps: +(frames / secs).toFixed(1),
      };
    } catch (e) {
      measured = { error: e.message };
    }
  }

  let snapshot = null;
  let snapshotSource = "none";
  let snapshotError = "";
  try {
    const s = await ev(
      "typeof window.__perfSnapshot === 'function' ? JSON.stringify(window.__perfSnapshot()) : null",
    );
    if (s) {
      snapshot = JSON.parse(s);
      snapshotSource = "__perfSnapshot";
    }
  } catch (e) {
    snapshotError = e.message;
  }
  if (!snapshot) {
    try {
      const s = await ev(
        "(function(){var e=document.getElementById('perf-json');return e?e.textContent:null})()",
      );
      if (s) {
        snapshot = JSON.parse(s);
        snapshotSource = "#perf-json";
      }
    } catch (e) {
      snapshotError += (snapshotError ? "; " : "") + e.message;
    }
  }

  let frames = null;
  try {
    frames = await ev("window.__m9frames");
  } catch (_) {}

  // Optional extra expression (e.g. HUD stats text) returned as `eval`.
  let evalValue = null;
  if (EVAL) {
    try {
      evalValue = await ev(EVAL);
    } catch (e) {
      evalValue = "eval error: " + e.message;
    }
  }

  let shotOk = false;
  if (SHOT) {
    try {
      writeFileSync(SHOT, await shoot());
      shotOk = true;
    } catch (e) {
      log("screenshot failed:", e.message);
    }
  }

  const out = {
    url: URL_,
    browser: version.Browser,
    waitMs: WAIT,
    until: untilDesc || null,
    untilMet,
    untilMs,
    stability,
    elapsedMs: Date.now() - t0,
    viewport: VIEWPORT || null,
    seedRandom: SEED_RANDOM === "" ? null : +SEED_RANDOM,
    hidden: HIDE || null,
    frames,
    measured,
    snapshotSource,
    snapshotError: snapshotError || undefined,
    snapshot,
    eval: evalValue,
    screenshot: shotOk ? SHOT : null,
    console: consoleLines.slice(0, 200),
  };
  const text = JSON.stringify(out, null, 2);
  if (JSON_OUT) writeFileSync(JSON_OUT, text);
  process.stdout.write(text + "\n");

  cdp.close();
  await closeBrowser(version);
  process.exit(0);
})().catch(async (e) => {
  console.error("[m9-cdp] FAILED:", e.message);
  // Still shut the browser down, or a failed run leaks a chrome.exe.
  try {
    const v = await (
      await fetch(`http://127.0.0.1:${PORT}/json/version`)
    ).json();
    await closeBrowser(v);
  } catch (_) {}
  process.exit(2);
});
