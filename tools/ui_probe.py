#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""UI 探针：用 CDP 量页面真实布局，专门抓"窄屏被撑宽 / 元素被裁"这类只有真机才看得见的问题。

为什么不用截图肉眼判断：截图能看出"被裁了"，但看不出**是谁**把宽度撑出去的。
这里直接问浏览器：文档 scrollWidth 多少、哪几个元素右边界超出了视口。

用法：
    python tools/ui_probe.py --width 390 --height 844
    python tools/ui_probe.py --width 390 --shot tools/_logs/m.png

依赖 websocket-client（隔离解释器里有）：
    ~/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/ui_probe.py
"""
from __future__ import annotations

import argparse
import json
import os
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

# 打本机端口必须绕开系统代理，否则会被本地代理吞掉（表现为"连不上调试端口"）
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

PROBE_JS = r"""
(() => {
  const vw = window.innerWidth;
  const de = document.documentElement;
  const out = { vw, scrollWidth: de.scrollWidth, bodyScroll: document.body.scrollWidth, offenders: [] };
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      out.offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 40),
        id: el.id || '',
        left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width)
      });
    }
  }
  out.offenders = out.offenders.slice(0, 12);
  const c = document.getElementById('scene');
  if (c) { out.canvas = { css: c.style.width, attr: c.width, parent: c.parentElement.clientWidth }; }
  return JSON.stringify(out);
})()
"""


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
        import websocket  # 延迟导入：只有真要探针时才需要这份依赖
        self.ws = websocket.create_connection(ws_url, timeout=20,
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

    def close(self) -> None:
        try:
            self.ws.close()
        except OSError:
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8770/")
    ap.add_argument("--width", type=int, default=390)
    ap.add_argument("--height", type=int, default=844)
    ap.add_argument("--mobile", action="store_true", default=True)
    ap.add_argument("--shot", default="")
    ap.add_argument("--wait", type=float, default=2.5)
    ap.add_argument("--click", default="", help="模拟点击画布坐标：x,y")
    ap.add_argument("--read", default="", help="点击后读某个元素的 textContent（如 #hint）")
    ap.add_argument("--eval", dest="eval_js", default="", help="点击后求值一段 JS 并打印结果")
    ap.add_argument("--after", type=float, default=1.8, help="点击后等待秒数（等人走到位）")
    args = ap.parse_args()

    edge = find_edge()
    if not edge:
        print("找不到 Edge / Chrome，探针无法运行")
        return 2

    port = free_port()
    profile = tempfile.mkdtemp(prefix="ui-probe-")
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
            "deviceScaleFactor": 2, "mobile": bool(args.mobile),
        })
        cdp.call("Page.navigate", {"url": args.url})
        time.sleep(args.wait)
        if args.click:
            cx, cy = [int(v) for v in args.click.split(",")]
            # 传进来的是"画布内坐标"，实际点击要用视口坐标：加上画布左上角偏移
            rect = cdp.call("Runtime.evaluate", {
                "expression": "(() => { const r=document.getElementById('scene').getBoundingClientRect();"
                              " return JSON.stringify({x:r.left, y:r.top}); })()",
                "returnByValue": True,
            })["result"]["value"]
            off = json.loads(rect)
            cx, cy = int(cx + off["x"]), int(cy + off["y"])
            # 用真实的 pointer/mouse 事件走一遍点击链路，而不是直接调 JS 函数 ——
            # 要验的就是"手指点下去"这条路径本身。
            for t in ("mousePressed", "mouseReleased"):
                cdp.call("Input.dispatchMouseEvent", {
                    "type": t, "x": cx, "y": cy, "button": "left", "clickCount": 1,
                    "pointerType": "mouse",
                })
            time.sleep(args.after)

        res = cdp.call("Runtime.evaluate", {"expression": PROBE_JS, "returnByValue": True})
        data = json.loads(res["result"]["value"])
        print("视口宽 %d · 文档 scrollWidth %d · body %d"
              % (data["vw"], data["scrollWidth"], data["bodyScroll"]))
        if data.get("canvas"):
            c = data["canvas"]
            print("canvas：inline %s / 位图 %d / 父容器 %d" % (c["css"], c["attr"], c["parent"]))
        if data["scrollWidth"] > data["vw"] + 1:
            print("✗ 横向溢出 %d px，超界元素：" % (data["scrollWidth"] - data["vw"]))
            for o in data["offenders"]:
                print("   %-8s #%-10s .%-24s left=%d right=%d w=%d"
                      % (o["tag"], o["id"], o["cls"], o["left"], o["right"], o["w"]))
        else:
            print("✓ 没有横向溢出")

        if args.read:
            r = cdp.call("Runtime.evaluate", {
                "expression": "(() => { const e=document.querySelector(%r); return e ? e.textContent.trim() : '(找不到元素)'; })()" % args.read,
                "returnByValue": True,
            })
            print("读 %s → %s" % (args.read, r["result"]["value"]))

        if args.eval_js:
            r = cdp.call("Runtime.evaluate", {"expression": args.eval_js, "returnByValue": True})
            print("eval → %s" % json.dumps(r["result"].get("value"), ensure_ascii=False))

        if args.shot:
            shot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
            import base64
            Path(args.shot).parent.mkdir(parents=True, exist_ok=True)
            Path(args.shot).write_bytes(base64.b64decode(shot["data"]))
            print("截图 → %s" % args.shot)
        cdp.close()
        return 0 if data["scrollWidth"] <= data["vw"] + 1 else 1
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
