// m9-cdp.mjs — drive a headless Chrome over the DevTools protocol.
//
// Run with the *Windows* node (127.0.0.1:<port> is local to Windows):
//   "/mnt/c/Program Files/nodejs/node.exe" L:\...\tools\m9-cdp.mjs \
//       --port 9222 --url "file:///L:/.../index.html?..." --wait 20000 \
//       --shot "C:\Users\Public\m9\x.png" --json "C:\Users\Public\m9\x.json"
//
// Sequence: connect, subscribe to console, Page.navigate, wait a real
// <wait> ms, Runtime.evaluate JSON.stringify(window.__perfSnapshot())
// (fallback: #perf-json textContent), Page.captureScreenshot, then
// Browser.close (so the harness never has to taskkill chrome.exe, which
// would also hit the user's own browser). Uses only the global
// WebSocket (Node >= 22) and fetch — no npm deps.
//
// Called by tools/m9-perf.py; usable standalone.

import { writeFileSync } from "node:fs";

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const PORT = +arg("port", 9222);
const URL_ = arg("url", "about:blank");
const WAIT = +arg("wait", 20000);
const SHOT = arg("shot", "");
const JSON_OUT = arg("json", "");
const CONNECT_TIMEOUT = +arg("connect-timeout", 30000);
const KEEP_OPEN = process.argv.includes("--keep-open");
const VERBOSE = process.argv.includes("--verbose");

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
  throw new Error(`no DevTools endpoint on 127.0.0.1:${PORT} after ${CONNECT_TIMEOUT} ms (${lastErr})`);
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
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
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
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

  // Pick (or create) a real page target — headless=new also lists
  // extension background pages and browser_ui targets.
  let targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page = targets.find((t) => t.type === "page");
  if (!page) {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
    page = await r.json();
  }

  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();

  const consoleLines = [];
  cdp.on("Runtime.consoleAPICalled", (p) => {
    const line = fmtConsole(p);
    consoleLines.push(line);
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

  const t0 = Date.now();
  await cdp.send("Page.navigate", { url: URL_ });
  log("navigated; waiting", WAIT, "ms real time");
  await sleep(WAIT);

  const ev = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        "evaluate failed: " +
          ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) ||
            r.exceptionDetails.text)
      );
    }
    return r.result.value;
  };

  let snapshot = null;
  let snapshotSource = "none";
  let snapshotError = "";
  try {
    const s = await ev(
      "typeof window.__perfSnapshot === 'function' ? JSON.stringify(window.__perfSnapshot()) : null"
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
        "(function(){var e=document.getElementById('perf-json');return e?e.textContent:null})()"
      );
      if (s) {
        snapshot = JSON.parse(s);
        snapshotSource = "#perf-json";
      }
    } catch (e) {
      snapshotError += (snapshotError ? "; " : "") + e.message;
    }
  }

  // Second sample a moment later: catches a snapshot whose fps counter
  // was mid-refresh, and shows whether the rate has settled.
  let snapshot2 = null;
  if (snapshot && snapshotSource === "__perfSnapshot") {
    await sleep(1500);
    try {
      snapshot2 = JSON.parse(await ev("JSON.stringify(window.__perfSnapshot())"));
    } catch (_) {}
  }

  let shotOk = false;
  if (SHOT) {
    try {
      const r = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(SHOT, Buffer.from(r.data, "base64"));
      shotOk = true;
    } catch (e) {
      log("screenshot failed:", e.message);
    }
  }

  const out = {
    url: URL_,
    browser: version.Browser,
    waitMs: WAIT,
    elapsedMs: Date.now() - t0,
    snapshotSource,
    snapshotError: snapshotError || undefined,
    snapshot,
    snapshot2,
    screenshot: shotOk ? SHOT : null,
    console: consoleLines.slice(0, 200),
  };
  const text = JSON.stringify(out, null, 2);
  if (JSON_OUT) writeFileSync(JSON_OUT, text);
  process.stdout.write(text + "\n");

  cdp.close();
  if (!KEEP_OPEN) {
    try {
      const b = new CDP(version.webSocketDebuggerUrl);
      await b.open();
      await b.send("Browser.close");
      b.close();
    } catch (e) {
      log("Browser.close failed:", e.message);
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error("[m9-cdp] FAILED:", e.message);
  process.exit(2);
});
