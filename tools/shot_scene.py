#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""场景截图探针：一个浏览器会话里按固定机位连拍，供 §1.3 / §7 的人工验收用。

为什么要有它
------------
提示词 §1.3 六、自检要求"每转 90° 截一张，四个方向都不能出现一面空墙 + 一片空地"。
手工拖鼠标截图有三个毛病：角度不固定（两张图不可比）、截图时机随机（粒子/阴影还在变）、
一次只能拍一张（拍四张要开四遍浏览器）。这里把机位算成四个固定方位角，一次会话拍完，
并且把 `__mini.info()` 的面数/绘制调用一起打出来——"细节够了没有"先看数，再看图。

用法
----
    python tools/shot_scene.py                                   # 默认拍 S0 四向
    python tools/shot_scene.py --url .../scenes/wall.html --tag wall
    python tools/shot_scene.py --angles 45,135,225,315 --dist 22 --pitch 0.63
    python tools/shot_scene.py --only 45                         # 只拍一张

依赖：websocket-client（与 ui_probe.py 同一份解释器）
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
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]

# 打本机端口必须绕开系统代理，否则会被本地代理吞掉
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
        except (urllib.error.URLError, OSError, ValueError) as exc:
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
    ap.add_argument("--url", default="http://127.0.0.1:8770/scenes/duty.html")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1000)
    ap.add_argument("--angles", default="45,135,225,315", help="方位角（度），逗号分隔")
    ap.add_argument("--pitch", type=float, default=0.63, help="仰角（弧度，≈36°）")
    ap.add_argument("--dist", type=float, default=24)
    ap.add_argument("--tag", default="", help="文件名前缀，默认取 URL 末段")
    ap.add_argument("--out", default=str(ROOT / "tools" / "_logs"))
    ap.add_argument("--wait", type=float, default=4.0, help="首屏等待（贴图/阴影就位）")
    ap.add_argument("--settle", type=float, default=1.2, help="每次转机位后的等待")
    ap.add_argument("--only", default="", help="只拍一个角度")
    ap.add_argument("--focus", default="", help="机位目标点 x,y,z（默认跟随主角）")
    args = ap.parse_args()

    edge = find_edge()
    if not edge:
        print("找不到 Edge / Chrome")
        return 2

    tag = args.tag or Path(args.url.split("?")[0]).stem or "scene"
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    angles = [float(a) for a in (args.only or args.angles).split(",") if a.strip()]

    port = free_port()
    profile = tempfile.mkdtemp(prefix="shot-scene-")
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
            print("页面里没有 window.__mini —— 场景没起来（看控制台 / 是否 404）")
            return 3

        info = cdp.js("JSON.stringify(window.__mini.info())")
        print("场景 %s · %s" % (tag, info))

        shots = []
        focus = ("[%s]" % args.focus) if args.focus else "null"
        for deg in angles:
            yaw = math.radians(deg)
            cdp.js("window.__mini.setCam({yaw:%r, pitch:%r, dist:%r, focus:%s})"
                   % (yaw, args.pitch, args.dist, focus))
            time.sleep(args.settle)
            shot = cdp.call("Page.captureScreenshot", {"format": "png"})
            path = outdir / ("%s_%03d.png" % (tag, int(deg) % 360))
            path.write_bytes(base64.b64decode(shot["data"]))
            shots.append(path)
            print("  %3d° → %s" % (int(deg) % 360, path.name))
        cdp.close()
        print("拍完 %d 张" % len(shots))
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
