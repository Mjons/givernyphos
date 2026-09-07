// film-strip.mjs — screenshot a movie-mode film at chosen film timestamps
// from a REAL-TIME headless run, over the DevTools protocol.
//
// Chrome's virtual time does not advance this page's rAF loop (see
// tools/README-m9.md), and a virtual-time strip only ever ran a handful
// of physics steps for the whole film — so the sim never evolved. This
// driver lets the film play for real and polls the page's film clock
// (window.__perfSnapshot().film) until each requested stamp is reached.
//
// Run with the *Windows* node (127.0.0.1:<port> is local to Windows):
//   chrome.exe --headless=new --no-sandbox --ignore-gpu-blocklist \
//     --use-angle=d3d11 --mute-audio --remote-debugging-port=9333 \
//     --window-size=1600,900 --user-data-dir=C:\Users\Public\film-udd about:blank
//   node.exe L:\...\tools\film-strip.mjs --port 9333 \
//     --url "file:///L:/.../index.html?intro=0&film=rewind&objects=65k" \
//     --stamps 2,40,62,100 --out "C:\Users\Public\film\rewind" --max 300
//
// Writes <out>-<k>.png per stamp, <out>.console.txt (console + exceptions)
// and prints one JSON summary line to stdout. No npm dependencies.

import { writeFileSync } from "node:fs";

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const PORT = +arg("port", 9333);
const URL_ = arg("url", "about:blank");
const STAMPS = arg("stamps", "2,40,62,100")
  .split(",")
  .map(Number)
  .filter((x) => !Number.isNaN(x))
  .sort((a, b) => a - b);
const OUT = arg("out", "C:\\Users\\Public\\film\\strip");
const MAX_S = +arg("max", 320); // give up after this many real seconds
const VIEWPORT = arg("viewport", "");
const POLL_MS = +arg("poll", 150);
// --hold: keep running until --max even after the film ends (token pages,
// watchdog runs); writes <out>-end.png on exit.
const HOLD = process.argv.includes("--hold");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[film-strip]", ...a);

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
      this.ws.onerror = (e) => rej(new Error("websocket error " + (e.message || "")));
    });
  }
  on(method, fn) {
    this.handlers.set(method, fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}

async function waitForChrome(timeoutMs = 30000) {
  const t0 = Date.now();
  let lastErr = "";
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) {
      lastErr = e.message;
    }
    await sleep(250);
  }
  throw new Error(`no DevTools endpoint on 127.0.0.1:${PORT} (${lastErr})`);
}

function fmtConsole(p) {
  const txt = (p.args || [])
    .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
    .join(" ");
  return `${p.type}: ${txt}`;
}

(async () => {
  const version = await waitForChrome();
  log("connected to", version.Browser);
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page = targets.find((t) => t.type === "page");
  if (!page) {
    page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  }
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  const consoleLines = [];
  cdp.on("Runtime.consoleAPICalled", (p) => consoleLines.push(fmtConsole(p)));
  cdp.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails || {};
    consoleLines.push(`exception: ${d.text || ""} ${(d.exception && d.exception.description) || ""}`);
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  if (VIEWPORT) {
    const [w, h] = VIEWPORT.toLowerCase().split("x").map(Number);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  }
  const ev = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
    if (r.exceptionDetails) return undefined;
    return r.result.value;
  };

  await cdp.send("Page.navigate", { url: URL_ });
  const t0 = Date.now();
  const shots = [];
  let k = 0;
  let started = false;
  let lastFilm = null;
  while (k < STAMPS.length && (Date.now() - t0) / 1000 < MAX_S) {
    const film = await ev("(window.__perfSnapshot ? window.__perfSnapshot().film : null)");
    if (typeof film === "number") {
      started = true;
      lastFilm = film;
      if (film >= STAMPS[k]) {
        const png = `${OUT}-${k}.png`;
        const r = await cdp.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(png, Buffer.from(r.data, "base64"));
        shots.push({ k, want: STAMPS[k], got: film, real: +((Date.now() - t0) / 1000).toFixed(1), png });
        log(`shot ${k} film ${film}s (wanted ${STAMPS[k]})`);
        k++;
        continue;
      }
    } else if (started && !HOLD) {
      // Film ended before the remaining stamps.
      break;
    }
    await sleep(POLL_MS);
  }
  if (HOLD) {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}-end.png`, Buffer.from(r.data, "base64"));
  }
  writeFileSync(`${OUT}.console.txt`, consoleLines.join("\n") + "\n");
  const errors = consoleLines.filter((l) => /^exception:|^error:|Uncaught|TypeError|ReferenceError/.test(l));
  console.log(JSON.stringify({ shots, missed: STAMPS.slice(k), lastFilm, errors: errors.slice(0, 10), consoleCount: consoleLines.length }));
  try {
    const b = new CDP(version.webSocketDebuggerUrl);
    await b.open();
    await b.send("Browser.close");
    b.close();
  } catch (e) {
    log("Browser.close failed:", e.message);
  }
  cdp.close();
  process.exit(0);
})().catch((e) => {
  log("fatal:", e.message);
  process.exit(1);
});
