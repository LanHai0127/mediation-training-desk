# -*- coding: utf-8 -*-
"""近景检查探针：精确摆机位（绕开 scene3d 的 actor 跟随与 dist>=8 限制），
用于逐件家具查穿模。只读页面，不改任何源文件。

用法：
    python tools/_closeup.py --tag X_bench --focus=-4.75,0.85,1.3 --dist 4.2 \
        --pitch 0.28 --angles 20,110,200,290 --hide-actor
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def find_edge() -> str:
    for p in EDGE_CANDIDATES:
        if Path(p).is_file():
            return p
    return shutil.which("msedge") or shutil.which("chrome") or ""


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_json(url: str, timeout: float = 15.0):
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
    def __init__(self, ws_url: str) -> None:
        import websocket
        self.ws = websocket.create_connection(ws_url, timeout=30,
                                              http_no_proxy=["127.0.0.1", "localhost"])
        self.n = 0

    def call(self, method: str, params: dict | None = None):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError("%s -> %s" % (method, msg["error"]))
                return msg.get("result", {})

    def js(self, expr: str):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                           "awaitPromise": True})
        return r.get("result", {}).get("value")

    def close(self) -> None:
        try:
            self.ws.close()
        except OSError:
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8770/static/scenes/duty.html")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1000)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--focus", default="0,1.0,-0.1")
    ap.add_argument("--dist", type=float, default=6.0)
    ap.add_argument("--pitch", type=float, default=0.3)
    ap.add_argument("--fov", type=float, default=42)
    ap.add_argument("--angles", default="0,90,180,270")
    ap.add_argument("--wait", type=float, default=4.0)
    ap.add_argument("--settle", type=float, default=0.45)
    ap.add_argument("--hide-actor", action="store_true")
    ap.add_argument("--eval-file", default="", help="加载后执行一段 JS 并打印结果（排查用）")
    ap.add_argument("--out", default=str(ROOT / "tools" / "_logs"))
    args = ap.parse_args()

    edge = find_edge()
    if not edge:
        print("找不到 Edge / Chrome")
        return 2
    fx, fy, fz = [float(v) for v in args.focus.split(",")]
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    angles = [float(a) for a in args.angles.split(",") if a.strip()]

    port = free_port()
    profile = tempfile.mkdtemp(prefix="closeup-")
    proc = subprocess.Popen([
        edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--remote-debugging-port=%d" % port, "--user-data-dir=%s" % profile,
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        targets = wait_json("http://127.0.0.1:%d/json/list" % port)
        page = next(t for t in targets if t.get("type") == "page")
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Emulation.setDeviceMetricsOverride", {
            "width": args.width, "height": args.height,
            "deviceScaleFactor": 2, "mobile": False,
        })
        cdp.call("Page.navigate", {"url": args.url})
        time.sleep(args.wait)
        err = cdp.js("window.__err || ''")
        if err:
            print("场景报错：%s" % err)
            return 3
        if not cdp.js("!!window.__mini"):
            print("没有 window.__mini")
            return 3
        # 锁相机主人，避免 placeCamera 每帧把机位拽走
        cdp.js("window.__mini.setCameraOwner(true); true")
        if args.hide_actor:
            cdp.js("window.__mini.hideActor(true); true")
        if args.eval_file:
            js_src = Path(args.eval_file).read_text(encoding="utf-8")
            print("eval →", json.dumps(cdp.js(js_src), ensure_ascii=False))
        print("场景 %s · %s" % (args.tag, cdp.js("JSON.stringify(window.__mini.info())")))
        for deg in angles:
            yaw = math.radians(deg)
            r = math.cos(args.pitch) * args.dist
            pos = [fx + math.sin(yaw) * r, max(0.3, fy + math.sin(args.pitch) * args.dist), fz + math.cos(yaw) * r]
            payload = {"pos": pos, "look": [fx, fy, fz], "fov": args.fov}
            cdp.js("window.postMessage({source:'host',type:'camera:set',payload:%s},'*'); true"
                   % json.dumps(payload))
            time.sleep(args.settle)
            shot = cdp.call("Page.captureScreenshot", {"format": "png"})
            path = outdir / ("%s_%03d.png" % (args.tag, int(deg) % 360))
            path.write_bytes(base64.b64decode(shot["data"]))
            print("  %3d° pos=(%.2f,%.2f,%.2f) → %s" % (int(deg) % 360, *pos, path.name))
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
