#!/usr/bin/env node
// Token build (docs/active/INTERACTIVE_NFT.md §5) — a derived artefact, not
// a transform of the app. Copies index.html into dist/token/, points the
// importmap at the vendored three.js, strips the Google Fonts links so the
// bundle makes no network requests, copies vendor/ + sfx/, and writes
// dist/token.zip for platform upload. Plain node, no dependencies.
//
//   node tools/build-token.mjs                  # dist/token/ + dist/token.zip
//   node tools/build-token.mjs --inject fxhash.min.js   # add a platform SDK <script> before the importmap
//   node tools/build-token.mjs --check          # only report external URLs in the built html
//
// The main index.html is untouched (single-file invariant; the Vercel page
// keeps loading three from unpkg).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "index.html");
const OUT_DIR = path.join(ROOT, "dist", "token");
const ZIP = path.join(ROOT, "dist", "token.zip");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

let html = fs.readFileSync(SRC, "utf8");
const before = html.length;

// 1. importmap → vendored three
const mapFrom = [
  [
    "https://unpkg.com/three@0.160.0/build/three.module.js",
    "./vendor/three/three.module.min.js",
  ],
  ["https://unpkg.com/three@0.160.0/examples/jsm/", "./vendor/three/addons/"],
];
for (const [a, b] of mapFrom) {
  if (!html.includes(a)) throw new Error(`importmap entry not found: ${a}`);
  html = html.split(a).join(b);
}

// 2. drop the Google Fonts preconnects + stylesheet (system font stack takes over)
html = html.replace(/\s*<link\s+rel="preconnect"[^>]*>/g, "");
html = html.replace(
  /\s*<link\s+rel="stylesheet"\s+href="https:\/\/fonts\.googleapis\.com[^>]*>/g,
  "",
);

// 3. optional platform SDK snippet (fx(hash) / Highlight) before the importmap
const inject = opt("--inject");
if (inject) {
  const file = path.resolve(inject);
  const base = path.basename(file);
  html = html.replace(
    /<script type="importmap">/,
    `<script src="./${base}"></script>\n    <script type="importmap">`,
  );
}

// 4. report anything that would still leave the bundle
const external = [];
for (const m of html.matchAll(
  /<(?:script|link)[^>]*(?:src|href)="(https?:\/\/[^"]+)"/g,
)) {
  external.push(m[1]);
}
for (const m of html.matchAll(/\bfetch\(\s*["'`](https?:\/\/[^"'`]+)/g))
  external.push(m[1]);
if (external.length) {
  console.warn("external references remain in markup/scripts:");
  for (const u of external) console.warn("  " + u);
} else {
  console.log("no external script/link/fetch URLs in the built html");
}
if (flag("--check")) process.exit(external.length ? 1 : 0);

// 5. write dist/token/
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
copyDir(path.join(ROOT, "vendor"), path.join(OUT_DIR, "vendor"));
copyDir(path.join(ROOT, "sfx"), path.join(OUT_DIR, "sfx"));
if (inject)
  fs.copyFileSync(
    path.resolve(inject),
    path.join(OUT_DIR, path.basename(inject)),
  );

// 6. zip
const entries = [];
walk(OUT_DIR, OUT_DIR, entries);
fs.writeFileSync(ZIP, makeZip(entries));

// 7. content hashes (launch board: "record the bundle content hash in the
// repo"). dist/token.manifest.json lists every file's SHA-256 and one
// bundle hash over the sorted "name  sha256" lines, so a rebuild can be
// checked against what was minted. The manifest sits beside the bundle,
// not inside it (it would change the hash it records).
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fileHashes = entries.map((e) => ({
  name: e.name,
  bytes: e.data.length,
  sha256: sha(e.data),
}));
const bundleSha256 = sha(
  fileHashes.map((f) => `${f.name}  ${f.sha256}\n`).join(""),
);
let git = null;
try {
  git = execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch (_) {}
const manifest = {
  bundle: "giverny-phos token build",
  builtAt: new Date().toISOString(),
  git,
  bundleSha256,
  files: fileHashes,
};
const MANIFEST = path.join(ROOT, "dist", "token.manifest.json");
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

const total = entries.reduce((s, e) => s + e.data.length, 0);
console.log(
  `built ${path.relative(ROOT, OUT_DIR)}/ (${entries.length} files, ${mb(total)} MB unpacked; html ${mb(before)} → ${mb(html.length)} MB)`,
);
console.log(
  `zip   ${path.relative(ROOT, ZIP)} (${mb(fs.statSync(ZIP).size)} MB)`,
);
console.log(`hash  ${bundleSha256}  (${path.relative(ROOT, MANIFEST)}, git ${git ? git.slice(0, 10) : "?"})`);

// ---------------------------------------------------------------- helpers
function mb(n) {
  return (n / 1048576).toFixed(2);
}
function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const s = path.join(from, name);
    const d = path.join(to, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, base, out);
    else
      out.push({
        name: path.relative(base, p).split(path.sep).join("/"),
        data: fs.readFileSync(p),
      });
  }
}
// Minimal ZIP writer: deflate entries, local headers + central directory.
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const now = new Date();
  const dosTime =
    ((now.getHours() << 11) |
      (now.getMinutes() << 5) |
      (now.getSeconds() >> 1)) &
    0xffff;
  const dosDate =
    (((now.getFullYear() - 1980) << 9) |
      ((now.getMonth() + 1) << 5) |
      now.getDate()) &
    0xffff;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const comp = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}
let _crcTable = null;
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  if (!_crcTable) {
    _crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++)
    c = _crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
