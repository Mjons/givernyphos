"""Shared plumbing for the M9 verification harness (tools/m9-look.py,
tools/m9-perf.py). See tools/README-m9.md.

Runs from WSL, drives *Windows* Chrome (the WSL side has no browser and
WebGPU needs a secure context, so pages load as file:///L:/... URLs) over
the DevTools protocol via tools/m9-cdp.mjs executed by the Windows node —
the debugging port binds to 127.0.0.1 on the Windows side only.
"""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
NODE = "/mnt/c/Program Files/nodejs/node.exe"
REPO = Path(__file__).resolve().parent.parent
DRIVER = REPO / "tools" / "m9-cdp.mjs"
INDEX = REPO / "index.html"
DEFAULT_OUT = Path("/mnt/c/Users/Public/m9-harness")

# Minimal flag set that gives headless Chrome the RTX 4090 with a
# working WebGPU adapter on file:// URLs (measured 2026-09-06, Chrome
# 152). No --enable-unsafe-webgpu is needed; see WEBGPU_FALLBACKS.
BASE_FLAGS = [
    "--headless=new",
    "--no-sandbox",
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-extensions",
    "--hide-scrollbars",
    "--mute-audio",
]
# Extra flag sets m9-perf.py tries, in order, if a run reports no
# WebGPU backend. The empty first entry is the normal attempt.
WEBGPU_FALLBACKS = [
    [],
    ["--enable-unsafe-webgpu"],
    ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
]

# Page chrome the look gate hides before its screenshots (#err stays
# visible: an error banner is a legitimate difference).
HIDE_SELECTORS = (
    "#hud,#rail,#panel,#toast,#flash,#film-title,#hotkey-overlay,"
    "#intro-prompt,#intro-skip,#density-revert-banner,#debug-overlay"
)

_port = [9400]


class HarnessError(RuntimeError):
    pass


def log(*a):
    print("[m9]", *a, file=sys.stderr, flush=True)


def wsl_to_win(p):
    """/mnt/c/x/y -> C:\\x\\y (Windows Chrome/node need native paths)."""
    p = Path(p).resolve()
    parts = p.parts
    if len(parts) < 3 or parts[0] != "/" or parts[1] != "mnt" or len(parts[2]) != 1:
        raise HarnessError(
            f"{p} is not under /mnt/<drive>/ — Windows Chrome cannot reach it"
        )
    return parts[2].upper() + ":\\" + "\\".join(parts[3:])


def file_url(p):
    """/mnt/l/a/b.html -> file:///L:/a/b.html"""
    win = wsl_to_win(p)
    return "file:///" + win[0] + ":/" + quote(win[3:].replace("\\", "/"))


def page_url(params):
    """Build the index.html URL. Values of None become bare flags
    (?nogpu); everything else is key=value in the given order."""
    parts = []
    for k, v in params.items():
        if v is None:
            parts.append(k)
        else:
            parts.append(f"{k}={quote(str(v), safe='')}")
    return file_url(INDEX) + ("?" + "&".join(parts) if parts else "")


def parse_query(fragment):
    """'render=wgpu&bh=1&nogpu' -> ordered dict (bare keys -> None)."""
    out = {}
    for piece in (fragment or "").split("&"):
        piece = piece.strip()
        if not piece:
            continue
        if "=" in piece:
            k, v = piece.split("=", 1)
            out[k] = v
        else:
            out[piece] = None
    return out


def next_port():
    _port[0] += 1
    return _port[0]


def check_env():
    missing = [p for p in (CHROME, NODE) if not os.path.exists(p)]
    if missing:
        raise HarnessError("missing: " + ", ".join(missing))
    if not DRIVER.exists():
        raise HarnessError(f"driver not found: {DRIVER}")
    try:
        import PIL  # noqa: F401
    except ImportError:
        raise HarnessError("python3 PIL (Pillow) is required")


def _js_string_list(values):
    return [str(v) for v in values]


def run_page(
    url,
    out_stem,
    *,
    wait_ms,
    window="1280,720",
    viewport=None,
    until=None,
    until_console=None,
    settle_ms=None,
    stable=None,
    stable_max_ms=None,
    measure_ms=None,
    seed_random=None,
    hide=None,
    eval_expr=None,
    extra_flags=(),
    keep_profile=False,
    verbose=False,
):
    """Launch one headless Chrome, run the CDP driver against `url`,
    return the driver's JSON (dict). Writes <out_stem>.png/.json/.chrome.log.
    Always tries to leave no chrome.exe behind (Browser.close over CDP;
    never taskkill, which would also hit the user's own browser)."""
    out_stem = Path(out_stem)
    out_stem.parent.mkdir(parents=True, exist_ok=True)
    port = next_port()
    udd = out_stem.parent / f"udd-{port}"
    if udd.exists() and not keep_profile:
        shutil.rmtree(udd, ignore_errors=True)
    udd.mkdir(parents=True, exist_ok=True)

    chrome_cmd = (
        [CHROME]
        + BASE_FLAGS
        + list(extra_flags)
        + [
            f"--user-data-dir={wsl_to_win(udd)}",
            f"--remote-debugging-port={port}",
            f"--window-size={window}",
            "about:blank",
        ]
    )
    chrome_log = open(str(out_stem) + ".chrome.log", "wb")
    chrome = subprocess.Popen(chrome_cmd, stdout=chrome_log, stderr=chrome_log)

    driver_cmd = [
        NODE,
        wsl_to_win(DRIVER),
        "--port",
        str(port),
        "--url",
        url,
        "--wait",
        str(int(wait_ms)),
        "--shot",
        wsl_to_win(str(out_stem) + ".png"),
        "--json",
        wsl_to_win(str(out_stem) + ".json"),
    ]
    if viewport:
        driver_cmd += ["--viewport", viewport]
    if until:
        driver_cmd += ["--until", until]
    if until_console:
        driver_cmd += ["--until-console", until_console]
    if settle_ms is not None:
        driver_cmd += ["--settle", str(int(settle_ms))]
    if stable:
        driver_cmd += ["--stable", str(stable)]
    if stable_max_ms:
        driver_cmd += ["--stable-max", str(int(stable_max_ms))]
    if measure_ms:
        driver_cmd += ["--measure", str(int(measure_ms))]
    if seed_random is not None:
        driver_cmd += ["--seed-random", str(int(seed_random))]
    if hide:
        driver_cmd += ["--hide", hide]
    if eval_expr:
        driver_cmd += ["--eval", eval_expr]
    if verbose:
        driver_cmd += ["--verbose"]

    timeout = (wait_ms + (measure_ms or 0) + (stable_max_ms or 0) + (settle_ms or 0)) / 1000 + 120
    t0 = time.time()
    try:
        proc = subprocess.run(
            driver_cmd, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        log(f"driver timed out after {timeout:.0f}s on port {port}; closing Chrome")
        subprocess.run(
            [NODE, wsl_to_win(DRIVER), "--port", str(port), "--close-only",
             "--connect-timeout", "5000"],
            capture_output=True, timeout=30,
        )
        raise HarnessError(f"driver timeout ({timeout:.0f}s) for {url}")
    finally:
        try:
            chrome.wait(timeout=15)
        except subprocess.TimeoutExpired:
            log(f"warning: chrome on port {port} still running after driver exit")
        chrome_log.close()

    if verbose:
        sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-6:])
        raise HarnessError(f"driver exit {proc.returncode} for {url}\n{tail}")
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise HarnessError(f"driver returned no JSON for {url}\n{proc.stderr[-800:]}")
    result["_elapsed_s"] = round(time.time() - t0, 1)
    result["_chrome_flags"] = BASE_FLAGS + list(extra_flags)
    result["_png"] = str(out_stem) + ".png"
    if not keep_profile:
        shutil.rmtree(udd, ignore_errors=True)
    return result


def snap(result, key, default="-"):
    s = result.get("snapshot") or {}
    v = s.get(key, default)
    return default if v is None else v


def fmt_table(headers, rows):
    """Plain monospace table (no deps)."""
    cols = [[str(h)] + [str(r[i]) for r in rows] for i, h in enumerate(headers)]
    widths = [max(len(c) for c in col) for col in cols]
    line = "  ".join(h.ljust(w) for h, w in zip(headers, widths))
    out = [line, "  ".join("-" * w for w in widths)]
    for r in rows:
        out.append("  ".join(str(c).ljust(w) for c, w in zip(r, widths)))
    return "\n".join(out)
