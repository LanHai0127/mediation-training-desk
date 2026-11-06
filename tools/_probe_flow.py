# -*- coding: utf-8 -*-
"""端到端探针：首屏单板 / 点开始直接进加载页 / 进场景后手机按钮出现。
一次会话内先量首屏，再做一次真实点击（pointerdown+pointerup 走 boot 的射线拾取），
然后等十场预热 + 开场运镜走完，量进场景后的状态。

用法：python tools/_probe_flow.py --url http://127.0.0.1:8770/static/app.html
"""
from __future__ import annotations

import argparse
import base64
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe"]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

BASE_JS = r"""
(() => {
  const a = window.__app;
  const btn = document.querySelector('.tp-launch');
  const cs = btn ? getComputedStyle(btn) : null;
  return JSON.stringify({
    app: !!a, mode: a && a.state.mode, boot: !!(a && a.boot), phone: !!(a && a.phone),
    err: String(window.__err || ""),
    layout: a && a.boot ? a.boot.layout() : null,
    gateDom: !!document.getElementById('gate'),
    gateState: !!(a && a.state && 'gate' in a.state),
    phoneBtn: cs ? { visibility: cs.visibility, opacity: cs.opacity,
                     pointerEvents: cs.pointerEvents, display: cs.display } : null,
    phoneMountClass: (document.getElementById('phoneMount') || {}).className || ""
  });
})()
"""

CLICK_JS = r"""
(() => {
  const a = window.__app;
  const b = (a.boot.layout() || [])[0];
  const T = window.__dbg.THREE;
  const v = new T.Vector3(b.x, b.y, b.z).project(a.camera);
  const x = Math.round((v.x * 0.5 + 0.5) * innerWidth);
  const y = Math.round((-v.y * 0.5 + 0.5) * innerHeight);
  const cv = document.getElementById('boot') || document.elementFromPoint(x, y);
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y,
                 pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
  cv.dispatchEvent(new PointerEvent('pointermove', opts));
  cv.dispatchEvent(new PointerEvent('pointerdown', opts));
  window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, { buttons: 0 })));
  return JSON.stringify({ click: [x, y], started: a.state.started,
                          loadOn: document.getElementById('load').classList.contains('on'),
                          loadHidden: document.getElementById('load').hidden,
                          loadingActive: a.loading.active });
})()
"""

WAIT_JS = r"""
(async () => {
  const a = window.__app;
  const btn = document.querySelector('.tp-launch');
  const phoneNow = () => {
    const cs = btn ? getComputedStyle(btn) : null;
    return cs ? { visibility: cs.visibility, opacity: cs.opacity,
                  pointerEvents: cs.pointerEvents } : null;
  };
  const t0 = performance.now();
  const mid = { loadOn: document.getElementById('load').classList.contains('on'),
                loadHidden: document.getElementById('load').hidden,
                loadingActive: a.loading.active, pct: a.loading.pct,
                started: a.state.started, phone: phoneNow() };
  while (!a.state.started && performance.now() - t0 < 70000) {
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, 1600));
  return JSON.stringify({
    mid,
    waitedMs: Math.round(performance.now() - t0),
    started: a.state.started, mode: a.state.mode, sceneId: a.state.sceneId,
    pct: a.loading.pct, loadHidden: document.getElementById('load').hidden,
    phone: phoneNow(),
    phoneMountClass: (document.getElementById('phoneMount') || {}).className || "",
    err: String(window.__err || "")
  });
})()
"""


def find_edge():
    for p in EDGE:
        if Path(p).is_file():
            return p
    return shutil.which("msedge") or shutil.which("chrome") or ""


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def wait_json(url, timeout=15.0):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            with OPENER.open(url, timeout=2) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.3)
    raise RuntimeError("调试端口没起来：%s" % last)


class CDP:
    def __init__(self, ws_url):
        import websocket
        self.ws = websocket.create_connection(ws_url, timeout=120,
                                              http_no_proxy=["127.0.0.1", "localhost"])
        self.n = 0

    def call(self, method, params=None):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError("%s -> %s" % (method, msg["error"]))
                return msg.get("result", {})

    def js(self, expr):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                           "awaitPromise": True})
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except OSError:
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8770/static/app.html")
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--wait", type=float, default=5.0)
    ap.add_argument("--out", default=str(ROOT / "tools" / "_logs"))
    args = ap.parse_args()
    edge = find_edge()
    if not edge:
        print("找不到 Edge / Chrome"); return 2
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    port = free_port(); profile = tempfile.mkdtemp(prefix="probe-flow-")
    proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             "--remote-debugging-port=%d" % port,
                             "--user-data-dir=%s" % profile, "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        page = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port)
                    if t.get("type") == "page")
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": args.width, "height": args.height,
                  "deviceScaleFactor": 2, "mobile": False})
        cdp.call("Page.navigate", {"url": args.url})
        time.sleep(args.wait)
        print("BASELINE →", cdp.js(BASE_JS))
        shot = cdp.call("Page.captureScreenshot", {"format": "png"})
        (out / "P_board.png").write_bytes(base64.b64decode(shot["data"]))
        print("截图 → tools/_logs/P_board.png")
        print("CLICK    →", cdp.js(CLICK_JS))
        time.sleep(1.0)
        print("LOADING  →", cdp.js("""JSON.stringify({
          loadOn: document.getElementById('load').classList.contains('on'),
          loadHidden: document.getElementById('load').hidden,
          loadingActive: window.__app.loading.active,
          pct: window.__app.loading.pct,
          gateDom: !!document.getElementById('gate'),
          phoneVis: getComputedStyle(document.querySelector('.tp-launch')).visibility
        })"""))
        shot = cdp.call("Page.captureScreenshot", {"format": "png"})
        (out / "P_loading.png").write_bytes(base64.b64decode(shot["data"]))
        print("截图 → tools/_logs/P_loading.png")
        print("SCENE    →", cdp.js(WAIT_JS))
        shot = cdp.call("Page.captureScreenshot", {"format": "png"})
        (out / "P_scene.png").write_bytes(base64.b64decode(shot["data"]))
        print("截图 → tools/_logs/P_scene.png")
        cdp.close()
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
