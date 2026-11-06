#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""外壳全量 UI / 交互测试（app.html 主线）。

跑法（项目根）：
    python tools/test_app.py
    py -3 tools/test_app.py            # Windows 上 `python` 是商店占位符时用这个
    python tools/test_app.py --url http://127.0.0.1:8770/static/app.html

前置：服务已在 8770 跑着（python src/server.py）。退出码 0 = 全绿。

为什么不用 websocket-client：这份测试要能在**任意装了 Python 的机器**上跑
（现场评审的笔记本不一定有隔离解释器）。CDP 其实只要一条 WebSocket，
这里用标准库自己实现了握手 + 帧编解码，零第三方依赖。

覆盖范围（每一条都对着真实 DOM / 真实布局量，不做字符串猜测）：
    A 首屏      canvas / __app / 无 __err / 四块看板坐标 / 鼠标视差
    B 密码门    错码不放行 / 错三次给提示不锁死 / 对码进加载页
    C 加载页    进度条文案 / 未满 100% 不进游戏 / 十场全部就绪
    D 场景      iframe ready / FOLLOW / 主角在镜头前方 3~5 米 / 机位逐帧同步
    E 手机      0.35s 进出 / 九个入口 / 地图当前地点不可点 / 学习 8+12 / 笔记增删
    F 传送      五条断言（sceneId / __mini / FOLLOW / 相机距离 / 手机跟地点）
    G 评价      scorePlan 三组样例（三维之和=总分、A/B/C）/ 结案出卡
    H 复盘      12 节点 / 点节点回调 / REPLAY 机位下发到 iframe
    I 视口      1440×900 与 390×844 无横向溢出
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from check_person_scenes import verify as verify_person_scenes  # noqa: E402

BASE = "http://127.0.0.1:%d" % int(os.environ.get("TJ_PORT") or 8770)
APP_URL = BASE + "/static/app.html"
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

PASS = 0
FAIL = 0
FAILED = []


def check(ok: bool, msg: str, detail="") -> bool:
    global PASS, FAIL
    if ok:
        PASS += 1
        print("[PASS] %s" % msg)
    else:
        FAIL += 1
        text = msg + ("  ← " + str(detail) if detail != "" else "")
        FAILED.append(text)
        print("[FAIL] " + text)
    return bool(ok)


# --------------------------------------------------------------------- WebSocket
class WS:
    """够用的 RFC6455 客户端：文本帧、掩码、分片、ping。"""

    def __init__(self, url: str, timeout: float = 45.0) -> None:
        u = urlparse(url)
        self.host = u.hostname or "127.0.0.1"
        self.port = u.port or 80
        self.path = u.path + (("?" + u.query) if u.query else "")
        self.sock = socket.create_connection((self.host, self.port), timeout=timeout)
        self.sock.settimeout(timeout)
        self.buf = b""
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = (
            "GET %s HTTP/1.1\r\n"
            "Host: %s:%d\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n" % (self.path, self.host, self.port, key)
        )
        self.sock.sendall(req.encode("ascii"))
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("CDP 握手被断开")
            head += chunk
        header, _, rest = head.partition(b"\r\n\r\n")
        if b" 101 " not in header.split(b"\r\n")[0]:
            raise RuntimeError("CDP 握手失败：%s" % header.split(b"\r\n")[0][:120])
        self.buf = rest

    # ---- 底层读写
    def _read_exact(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(max(4096, n - len(self.buf)))
            if not chunk:
                raise RuntimeError("CDP 连接已关闭")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send_frame(self, payload: bytes, opcode: int = 0x1) -> None:
        head = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        head += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(head) + masked)

    def send(self, text: str) -> None:
        self._send_frame(text.encode("utf-8"), 0x1)

    def recv(self) -> str:
        chunks = []
        while True:
            b1, b2 = self._read_exact(2)
            fin = b1 & 0x80
            opcode = b1 & 0x0F
            masked = b2 & 0x80
            ln = b2 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._read_exact(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if masked else None
            payload = self._read_exact(ln) if ln else b""
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x9:            # ping → pong
                self._send_frame(payload, 0xA)
                continue
            if opcode == 0xA:            # pong
                continue
            if opcode == 0x8:
                raise RuntimeError("CDP 对端关闭了连接")
            chunks.append(payload)
            if fin:
                return b"".join(chunks).decode("utf-8", "replace")

    def close(self) -> None:
        try:
            self._send_frame(b"", 0x8)
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


class CDP:
    def __init__(self, ws_url: str) -> None:
        self.ws = WS(ws_url)
        self.n = 0

    def call(self, method: str, params: dict | None = None):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") != self.n:
                continue                      # 事件帧直接跳过
            if "error" in msg:
                raise RuntimeError("%s -> %s" % (method, msg["error"]))
            return msg.get("result", {})

    def close(self) -> None:
        self.ws.close()


# --------------------------------------------------------------------- 浏览器
def find_edge() -> str:
    for p in EDGE_CANDIDATES:
        if Path(p).is_file():
            return p
    for name in ("msedge", "chrome"):
        from shutil import which
        found = which(name)
        if found:
            return found
    return ""


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_json(url: str, timeout: float = 20.0):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            with OPENER.open(url, timeout=2) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            last = exc
            time.sleep(0.25)
    raise RuntimeError("调试端口没起来：%s" % last)


class Page:
    """CDP 的一层薄封装：js(expr) / wait_for(expr) / viewport(w,h) / shot(path)。"""

    def __init__(self, cdp: CDP) -> None:
        self.cdp = cdp

    def js(self, expr: str, await_p: bool = True):
        r = self.cdp.call("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": await_p,
        })
        if "exceptionDetails" in r:
            det = r["exceptionDetails"]
            raise RuntimeError("JS 抛错：%s" % (det.get("exception", {}).get("description")
                                                or det.get("text")))
        return r.get("result", {}).get("value")

    def wait_for(self, expr: str, timeout: float = 10.0, interval: float = 0.15):
        end = time.time() + timeout
        while time.time() < end:
            try:
                v = self.js(expr)
            except RuntimeError:
                v = None
            if v:
                return v
            time.sleep(interval)
        return None

    def viewport(self, w: int, h: int, mobile: bool = False, scale: float = 1) -> None:
        self.cdp.call("Emulation.setDeviceMetricsOverride", {
            "width": w, "height": h, "deviceScaleFactor": scale, "mobile": mobile,
        })

    def shot(self, path: str) -> None:
        res = self.cdp.call("Page.captureScreenshot", {"format": "png",
                                                       "captureBeyondViewport": False})
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(base64.b64decode(res["data"]))


# --------------------------------------------------------------------- JS 片段
JS_YAW = ("(() => { const T = window.__dbg.THREE; const v = new T.Vector3();"
          " window.__app.camera.getWorldDirection(v);"
          " return +Math.atan2(v.x, v.z).toFixed(4); })()")
JS_SCENE = """(() => {
  const f = document.getElementById('frame');
  let mini = false, err = null, actor = null, cam = null;
  try {
    const w = f.contentWindow;
    mini = !!(w && w.__mini);
    err = w ? (w.__err || null) : null;
    actor = (w && w.__mini) ? w.__mini.actorPos() : null;
    cam = (w && w.__dbg) ? [+w.__dbg.camera.position.x.toFixed(2),
                           +w.__dbg.camera.position.y.toFixed(2),
                           +w.__dbg.camera.position.z.toFixed(2)] : null;
  } catch (e) { err = String(e); }
  return { started: window.__app.state.started, mode: window.__app.state.mode,
           sceneId: window.__app.state.sceneId, on: f.classList.contains('on'),
           src: f.getAttribute('src'), mini, err, actor, iframeCam: cam };
})()"""
JS_FRONT = """(() => {
  const c = window.__app.camera;
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__mini) return null;
  const a = w.__mini.actorPos();
  const dx = a.x - c.position.x, dy = -c.position.y, dz = a.z - c.position.z;
  const dist = Math.hypot(dx, dy, dz);
  const T = window.__dbg.THREE; const v = new T.Vector3();
  c.getWorldDirection(v);
  const len = Math.hypot(dx, dy, dz) || 1;
  const dot = (v.x * dx + v.y * dy + v.z * dz) / len;
  return { dist: +dist.toFixed(2), dot: +dot.toFixed(3), actor: a,
           cam: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)] };
})()"""
JS_CAM_SYNC = """(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__dbg) return null;
  const a = window.__app.camera.position, b = w.__dbg.camera.position;
  return { d: +Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(3),
           host: [+a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2)],
           frame: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)] };
})()"""
JS_OVERFLOW = """(() => ({
  vw: innerWidth,
  sw: document.documentElement.scrollWidth,
  bw: document.body.scrollWidth,
  canvasW: (document.querySelector('#stage canvas') || {}).clientWidth || 0
}))()"""
# 看板的世界坐标投影到屏幕：真实鼠标点「开始调解」，而不是直接调函数
JS_PROJ = """(() => {
  const T = window.__dbg.THREE;
  const out = {};
  for (const b of window.__app.boot.layout()) {
    const v = new T.Vector3(b.x, b.y, b.z).project(window.__app.camera);
    out[b.id] = [Math.round((v.x * 0.5 + 0.5) * innerWidth),
                 Math.round((-v.y * 0.5 + 0.5) * innerHeight)];
  }
  return out;
})()"""

SCORE_SAMPLES = """(() => {
  const A = {
    evidence: [{ id: 'e1', weight: 2, found: true, title: '宅基地档案' },
               { id: 'e2', weight: 1, found: true, title: '界石' }],
    plan: { claims: [
      { text: '排水沟属于历史形成的共用排水', lawId: '人民调解法 第二十条' },
      { text: '低处不得擅自堵截', lawId: '民法典 第二百九十条' },
      { text: '费用分摊，七日内共同出资清通', lawId: '人民调解法 第二十条' }
    ], concessions: { a: true, b: true } },
    rubric: { mustMention: ['历史形成的共用排水', '不得擅自堵截', '费用分摊或恢复原状'],
              timeLimit: { ok: ['七日内'], score: 8 }, forbid: [] }
  };
  const B = {
    evidence: [{ id: 'e1', weight: 2, found: true }, { id: 'e2', weight: 1, found: true }],
    plan: { claims: [
      { text: '排水沟属于历史形成的共用排水', lawId: '人民调解法 第二十条' },
      { text: '低处不得擅自堵截', lawId: '民法典 第二百九十条' },
      { text: '费用分摊，七日内共同出资清通', lawId: '人民调解法 第二十条' }
    ], concessions: {} },
    rubric: { mustMention: ['历史形成的共用排水', '不得擅自堵截', '费用分摊或恢复原状'],
              timeLimit: { ok: ['七日内'], score: 8 }, forbid: [] }
  };
  const C = {
    evidence: [{ id: 'e1', weight: 2, found: true }, { id: 'e2', weight: 2, found: false }],
    plan: { claims: [{ text: '费用分摊吧，让他自己拆了就行' }], concessions: {} },
    rubric: { mustMention: ['历史形成的共用排水', '不得擅自堵截', '费用分摊或恢复原状'],
              timeLimit: { ok: ['七日内'], score: 8 }, forbid: ['自己拆了就行'] }
  };
  const run = (inp) => {
    const r = window.__app.scorePlan(inp);
    return { total: r.total, grade: r.grade, label: r.gradeLabel,
             sum: r.scores.understanding + r.scores.legality + r.scores.executability,
             dims: r.scores,
             secs: { good: r.sections.good.length, missed: r.sections.missed.length,
                     illegal: r.sections.illegal.length, next: r.sections.next.length } };
  };
  return { a: run(A), b: run(B), c: run(C) };
})()"""

# 空方案 / 只看了证据但不写方案：分数必须留在方案上。
# 这一组盯的是"什么都不写直接结案还有 30 分"的回归 —— 旧版 buildReviewInput 在
# state.plan 为空时塞一份 samplePlan（每条都命中必答点 + 默认双方让步），空手结案 ~30 分。
SCORE_EMPTY = """(() => {
  const run = (inp) => {
    const r = window.__app.scorePlan(inp);
    return { total: r.total, grade: r.grade,
             sum: r.scores.understanding + r.scores.legality + r.scores.executability,
             dims: r.scores };
  };
  const rubric = { mustMention: ['历史形成的共用排水', '费用分摊或恢复原状'],
                   timeLimit: { ok: ['七日内'], score: 8 }, forbid: [] };
  const seenAll = [
    { id: 'e1', weight: 2, found: true },
    { id: 'e2', weight: 1, found: true }
  ];
  return {
    empty: run({ evidence: [], plan: { claims: [] }, rubric: {} }),
    // 结构化字段齐全但一句正文都没有：旧版 concessions 会白送可执行性 10 分
    hollow: run({ evidence: [], plan: { claims: [], concessions: { a: true, b: true } }, rubric: rubric }),
    seenNoPlan: run({ evidence: seenAll, plan: { claims: [] }, rubric: rubric }),
    seenWithPlan: run({ evidence: seenAll,
      plan: { claims: [{ text: '费用分摊，七日内共同出资清通', lawId: '人民调解法 第二十条' }],
              concessions: { a: true, b: true } }, rubric: rubric })
  };
})()"""


# --------------------------------------------------------------------- 主流程
def run(url: str) -> int:
    edge = find_edge()
    if not edge:
        print("[SKIP] 找不到 Edge / Chrome，浏览器测试跑不了")
        return 2
    try:
        with OPENER.open(BASE + "/__ver", timeout=4) as r:
            ver = json.loads(r.read().decode("utf-8"))
        print("服务端 build=%s pid=%s" % (ver.get("build", "?")[:19], ver.get("pid")))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        print("[FAIL] 8770 端口没起服务：%s" % exc)
        print("       先跑：python src/server.py")
        return 2

    # 静态校验不依赖浏览器：人物地图映射与场景源码一致、每个 party 至少 1 处。
    # 放在这里，CI 在浏览器跑挂之前就能看到「有人改了场景没重跑脚本」。
    ps_ok, ps_detail = verify_person_scenes(ROOT)
    check(ps_ok, "P1 person_scenes.json 与场景源码一致；每个案子的每个 party 至少 1 处可对话场景",
          ps_detail)

    port = free_port()
    profile = tempfile.mkdtemp(prefix="app-test-")
    proc = subprocess.Popen([
        edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--no-first-run", "--no-default-browser-check",
        "--remote-debugging-port=%d" % port, "--user-data-dir=%s" % profile,
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cdp = None
    try:
        page_target = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port)
                           if t.get("type") == "page")
        cdp = CDP(page_target["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        pg = Page(cdp)
        pg.viewport(1440, 900)
        cdp.call("Page.navigate", {"url": url})

        ready = pg.wait_for("!!(window.__app && window.__app.boot && window.__app.phone)", 25)
        if not ready:
            print("[FAIL] 页面 25 秒内没起来：%s" % url)
            return 1
        time.sleep(1.2)      # 首屏浮现 0.55s + 一轮视差

        # ------------------------------------------------------------ A 首屏
        canvas = pg.js("(() => { const c = document.querySelector('#stage canvas');"
                       " return c ? { w: c.width, h: c.height, cw: c.clientWidth,"
                       " ch: c.clientHeight } : null; })()")
        check(bool(canvas) and canvas["cw"] >= 1400 and canvas["ch"] >= 850,
              "A1 首屏 canvas 铺满视口", canvas)

        api = pg.js("(() => { const a = window.__app; if (!a) return null;"
                    " const need = ['flight','boot','phone','state','enterScene','teleport',"
                    "'startGame','openReview','openReplay','scorePlan'];"
                    " return { missing: need.filter(k => !(k in a)),"
                    " keys: Object.keys(a).length }; })()")
        check(bool(api) and not api["missing"], "A2 window.__app 就绪（探针入口齐全）", api)

        err = pg.js("window.__err || null")
        check(err is None, "A3 外壳无未捕获异常（window.__err 为空）", err)

        layout = pg.js("(() => (window.__app.boot.layout() || []).map(b => "
                       "({ id: b.id, y: +b.y.toFixed(3), x: +b.x.toFixed(3),"
                       "   w: b.size && b.size[0], h: b.size && b.size[1] })))()")
        one = (layout or [{}])[0] if len(layout or []) == 1 else {}
        ok_layout = (len(layout or []) == 1 and one.get("id") == "start"
                     and abs(one.get("x", -99)) <= 0.05
                     and abs(one.get("y", -99) - 4.9) <= 0.16
                     and one.get("w", 0) >= 3.5 and one.get("h", 0) >= 1.95)
        check(ok_layout, "A4 首屏只剩一块「开始调解」板（居中 / 高 4.9 / 3.6×2.0）", layout)

        yaw0 = pg.js(JS_YAW)
        cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 40, "y": 460})
        time.sleep(0.2)
        cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 1436, "y": 470})
        time.sleep(1.3)
        yaw1 = pg.js(JS_YAW)
        check(abs((yaw1 or 0) - (yaw0 or 0)) >= 0.1,
              "A5 鼠标移到右缘 → 相机 yaw 变化 ≥ 0.1 弧度",
              {"yaw0": yaw0, "yaw1": yaw1})

        # ------------------------------------------------------------ B 首屏 → 加载页
        # 真的用鼠标点画布上的「开始调解」板：射线拾取 + 按下抬起这条链路一起验。
        # 密码门已按新行为删除：点板子应当直接进加载页。
        cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 720, "y": 450})
        time.sleep(0.9)              # 视差回正，投影才准
        proj = pg.js(JS_PROJ)
        pt = (proj or {}).get("start") or [0, 0]
        for kind in ("mousePressed", "mouseReleased"):
            cdp.call("Input.dispatchMouseEvent", {"type": kind, "x": pt[0], "y": pt[1],
                                                  "button": "left", "clickCount": 1})
            time.sleep(0.05)
        time.sleep(0.45)
        first = pg.js("({ loadOn: document.getElementById('load').classList.contains('on'),"
                      " loadHidden: document.getElementById('load').hidden,"
                      " started: window.__app.state.started,"
                      " gateDom: !!document.getElementById('gate'),"
                      " prompt: typeof window.prompt })")
        check(bool(first) and first["loadOn"] and not first["loadHidden"]
              and not first["started"] and not first["gateDom"],
              "B1 鼠标点「开始调解」板 → 直接进加载页（没有密码门）",
              {"click": pt, "state": first})

        bootstate = pg.js("({ active: window.__app.loading.active,"
                          " total: window.__app.loading.total,"
                          " pct: window.__app.loading.pct,"
                          " text: (document.getElementById('loadCur').textContent || '').trim(),"
                          " btn: (() => { const b = document.querySelector('.tp-launch');"
                          "  if (!b) return null; const cs = getComputedStyle(b);"
                          "  return { vis: cs.visibility, pe: cs.pointerEvents }; })() })")
        check(bool(bootstate) and bootstate["active"] and bootstate["total"] == 10
              and bootstate["pct"] < 100 and bool(bootstate["text"]),
              "B2 加载页接手：十场预热启动、进度未满、有当前场景文案", bootstate)

        gone = pg.js("({ gate: !!document.getElementById('gate'),"
                     " input: !!document.getElementById('gateInput'),"
                     " card: document.querySelectorAll('.gate-card').length,"
                     " err: !!document.getElementById('gateErr'),"
                     " stateGate: 'gate' in window.__app.state })")
        check(bool(gone) and not gone["gate"] and not gone["input"]
              and gone["card"] == 0 and not gone["err"] and not gone["stateGate"],
              "B3 密码门 DOM / CSS / state 全部删干净（不是隐藏）", gone)

        check(bool(bootstate) and bootstate["btn"] is not None
              and bootstate["btn"]["vis"] == "hidden" and bootstate["btn"]["pe"] == "none",
              "B4 首屏不显示右上角手机图标（点开始之后才出现）",
              bootstate and bootstate["btn"])

        # ------------------------------------------------------------ C 加载页
        during = pg.js("({ visible: !document.getElementById('load').hidden,"
                       " text: (document.getElementById('loadCur').textContent || '').trim(),"
                       " state: (document.getElementById('loadState').textContent || '').trim(),"
                       " pct: window.__app.loading.pct,"
                       " fill: (document.getElementById('loadFill').style.width || ''),"
                       " total: window.__app.loading.total,"
                       " started: window.__app.state.started })")
        check(bool(during) and during["visible"] and during["total"] == 10
              and ("正在准备" in during["text"] or "准备中" in during["state"]),
              "C1 加载页有明确的「正在准备 …」文案与总进度", during)

        # 背景是"云盖住"：底色是深墨蓝的天，上面那张云画布真的落了像素
        cloud = pg.js("""(() => {
          const c = document.getElementById('loadCloud');
          const layer = document.getElementById('load');
          if (!c) return null;
          const ctx = c.getContext('2d');
          const w = c.width, h = c.height;
          const alphaAt = (px, py) => (ctx && w ? ctx.getImageData(
            Math.min(w - 1, Math.round(w * px)), Math.min(h - 1, Math.round(h * py)), 1, 1
          ).data[3] : 0);
          return {
            cssBg: getComputedStyle(layer).backgroundColor,
            w, h,
            painted: [alphaAt(0.5, 0.5), alphaAt(0.2, 0.25), alphaAt(0.8, 0.78)]
          };
        })()""")
        check(bool(cloud) and cloud["w"] > 100 and cloud["h"] > 100
              and all(a > 0 for a in cloud["painted"])
              and cloud["cssBg"] == "rgb(49, 92, 114)",
              "C5 加载页背景是「云盖住」（云画布已落像素 + 深墨蓝天）", cloud)

        mid = []
        for _ in range(4):
            mid.append(pg.js("({ pct: window.__app.loading.pct,"
                             " started: window.__app.state.started,"
                             " visible: !document.getElementById('load').hidden })"))
            time.sleep(0.35)
        bad_mid = [m for m in mid if m and (m["started"] or m["pct"] >= 100)]
        check(bool(mid) and not bad_mid, "C2 加载期间（未满 100%）不会进游戏", bad_mid or mid)

        done = pg.wait_for("(() => !!(window.__app.state.started"
                           " && window.__app.loading.pct >= 100))()", 45)
        check(bool(done), "C3 十个场景全部就绪后才进游戏（started 且 pct=100）",
              pg.js("({pct: window.__app.loading.pct, started: window.__app.state.started,"
                    " failed: window.__app.loading.failed})"))
        check(bool(done) and not pg.js("window.__app.loading.failed.length"),
              "C4 十场预热没有一场失败（failed 为空）",
              pg.js("window.__app.loading.failed"))

        # ------------------------------------------------------------ D 场景
        pg.wait_for("(() => { const f = document.getElementById('frame');"
                    " try { return !!(f.contentWindow && f.contentWindow.__mini); }"
                    " catch (e) { return false; } })()", 12)
        time.sleep(1.3)      # 等 follow 补间落定
        sc = pg.js(JS_SCENE)
        check(bool(sc) and sc["mini"] and sc["on"] and "duty.html" in (sc["src"] or ""),
              "D1 enterScene 后 iframe 载入完成、__mini 就绪", sc)
        check(bool(sc) and sc["mode"] == "FOLLOW", "D2 相机进入 FOLLOW 状态", sc)
        check(bool(sc) and sc["err"] is None, "D3 场景页无未捕获异常（iframe __err 为空）",
              sc and sc["err"])

        front = pg.js(JS_FRONT)
        check(bool(front) and 3.0 <= front["dist"] <= 5.0,
              "D4 相机到主角距离在 3~5 米（第三人称跟随）", front)
        check(bool(front) and front["dot"] > 0.9,
              "D5 主角在相机正前方（视线夹角 < 约 25°）", front and front["dot"])

        sync = pg.js(JS_CAM_SYNC)
        check(bool(sync) and sync["d"] <= 0.15,
              "D6 机位逐帧 postMessage 下发（iframe 相机 = 外壳相机）", sync)

        # ------------------------------------------------------------ E 手机
        pg.js("(() => { const b = document.querySelector('.tp-launch'); if (b) b.click();"
              " return true; })()")
        time.sleep(0.45)
        phone = pg.js("(() => { const root = document.querySelector('.tp-root');"
                      " const shell = document.querySelector('.tp-shell');"
                      " return { open: root && root.getAttribute('data-open'),"
                      "  fn: window.__app.phone.isOpen(),"
                      "  dur: shell ? getComputedStyle(shell).transitionDuration : '',"
                      "  vis: shell ? getComputedStyle(shell).visibility : '',"
                      "  tiles: document.querySelectorAll('.tp-app').length }; })()")
        check(bool(phone) and phone["open"] == "true" and phone["fn"] and phone["vis"] == "visible",
              "E1 手机能打开并真的滑入（visibility visible）", phone)
        check(bool(phone) and "0.35s" in (phone["dur"] or ""),
              "E2 手机进出动画 0.35s（CSS transition-duration）", phone and phone["dur"])

        # 桌面风格 = 国庆那台机器（中性浅屏 + 深墨壳），图标是这套工具自己画的、
        # 配色换成 PAL 压暗一档的四个色相（不是国庆那套高饱和蓝橙绿红）
        skin = pg.js("""(() => {
          const root = document.querySelector('.tp-root');
          const home = document.querySelector('.tp-page[data-page="home"]');
          const shell = document.querySelector('.tp-shell');
          const color = (k) => {
            const el = document.querySelector('.tp-app[data-app="' + k + '"] .tp-app-icon');
            return el ? getComputedStyle(el).color : null;
          };
          const rgb = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
          return {
            pal: root ? root.classList.contains('tp-theme-pal') : null,
            homeBg: rgb(home, 'backgroundColor'),
            shellBg: rgb(shell, 'backgroundColor'),
            colors: { case: color('case'), evidence: color('evidence'),
                      map: color('map'), review: color('review') }
          };
        })()""")
        check(bool(skin) and skin["pal"] is False
              and skin["homeBg"] == "rgb(247, 246, 243)"
              and skin["shellBg"] == "rgb(31, 35, 40)",
              "E10 手机桌面沿用国庆风格（中性浅屏 #f7f6f3 + 深墨壳 #1f2328）", skin)
        want_icon = {"case": "rgb(49, 92, 114)", "evidence": "rgb(138, 106, 74)",
                     "map": "rgb(79, 122, 104)", "review": "rgb(181, 86, 74)"}
        check(bool(skin) and skin["colors"] == want_icon,
              "E11 九宫格图标配色已改成与桌面融合的四个色相", skin and skin["colors"])

        nav = pg.js("""(() => {
          const keys = ['case','people','evidence','notes','laws','map','contact','learn'];
          const bad = [];
          for (const k of keys) {
            const b = document.querySelector('.tp-app[data-app="' + k + '"]');
            if (!b) { bad.push(k + ':missing'); continue; }
            b.click();
            if (window.__app.phone.page !== k) { bad.push(k + '->' + window.__app.phone.page); }
          }
          return { bad, tiles: document.querySelectorAll('.tp-app').length,
                   page: window.__app.phone.page };
        })()""")
        check(bool(nav) and nav["tiles"] == 9, "E3 九宫格九个入口都在", nav and nav["tiles"])
        check(bool(nav) and not nav["bad"], "E4 九个入口都能进（八个页面 + 评价复盘）", nav and nav["bad"])

        rv = pg.js("""(() => {
          const b = document.querySelector('.tp-app[data-app="review"]');
          if (b) b.click();
          const page = window.__app.phone.page;
          const locked = document.querySelector('.tp-page[data-page="review"] .tp-locked');
          const end = document.querySelector('.tp-page[data-page="review"] [data-end]');
          return { page, locked: !!locked, end: !!end,
                   text: (end ? end.textContent : '').trim() };
        })()""")
        check(bool(rv) and rv["page"] == "review" and rv["locked"] and rv["end"],
              "E5 案子未结时评价页是锁的，但给出「结案」入口（不是死路）", rv)

        mp = pg.js("""(() => {
          window.__app.phone.openPage('map');
          const here = document.querySelector('.tp-page[data-page="map"] .tp-scene.is-here');
          const others = document.querySelectorAll('.tp-page[data-page="map"] .tp-scene:not(.is-here)');
          return { here: here ? here.tagName : null,
                   aria: here ? here.getAttribute('aria-current') : null,
                   label: here ? here.getAttribute('aria-label') : null,
                   others: others.length,
                   otherTag: others.length ? others[0].tagName : null };
        })()""")
        check(bool(mp) and mp["here"] == "DIV" and mp["aria"] == "true"
              and not mp["label"] and mp["others"] >= 1 and mp["otherTag"] == "BUTTON",
              "E6 地图上当前地点不可点（是 div，其它地点是 button）", mp)

        # 案件档案：每个当事人下面必须有一行「📍 在哪张图」，且与 person_scenes.json 对齐。
        # 只比 DOM 文本不够 —— 必须把 JSON 里该案的每个人、每处场景都逐条对一遍。
        case_view = pg.js("""(async () => {
          window.__app.phone.openPage('case');
          const page = document.querySelector('.tp-page[data-page="case"]');
          const mutedEl = page.querySelector('.tp-p.tp-muted');
          const muted = mutedEl ? getComputedStyle(mutedEl).color : null;
          const rows = [...page.querySelectorAll('.tp-party')].map((wrap) => {
            const line = wrap.querySelector('.tp-party-scene');
            const k = wrap.querySelector('.tp-kv .k');
            const cs = line ? getComputedStyle(line) : null;
            return { id: wrap.getAttribute('data-party'),
                     name: k ? (k.textContent || '').trim() : '',
                     text: line ? (line.textContent || '').trim() : null,
                     ids: line ? (line.getAttribute('data-scenes') || '').split(',').filter(Boolean) : null,
                     more: line ? line.getAttribute('data-more') : null,
                     font: cs ? cs.fontSize : null,
                     color: cs ? cs.color : null };
          });
          const cid = window.__app.state.caseId;
          const res = await fetch('./person_scenes.json', { headers: { Accept: 'application/json' } });
          const map = await res.json();
          return { cid, rows, muted, map: map[cid] || {} };
        })()""")
        cv = case_view or {}
        exp = cv.get("map") or {}
        rows = cv.get("rows") or []
        ps_problems = []
        if not rows:
            ps_problems.append("案件页一个 .tp-party 都没渲染")
        if len(rows) != len(exp):
            ps_problems.append("DOM 当事人 %d 个 ≠ 映射 %d 个" % (len(rows), len(exp)))
        for row in rows:
            pid = row.get("id")
            items = exp.get(pid) or []
            want_ids = [str(it.get("scene")) for it in items]
            text = row.get("text") or ""
            if not items:
                ps_problems.append("%s 在映射里没有场景" % pid)
            if row.get("ids") != want_ids:
                ps_problems.append("%s 的 data-scenes=%s ≠ 映射 %s"
                                   % (pid, row.get("ids"), want_ids))
            if not text or "暂未安排" in text:
                ps_problems.append("%s 没有地图标注（text=%r）" % (pid, text))
            if row.get("font") != "13px":
                ps_problems.append("%s 标注字号 %r ≠ 13px" % (pid, row.get("font")))
            if row.get("color") != cv.get("muted"):
                ps_problems.append("%s 标注颜色 %r ≠ 次要色 %r"
                                   % (pid, row.get("color"), cv.get("muted")))
            if len(items) > 3:
                if "等" not in text:
                    ps_problems.append("%s 超过 3 处但没写「等 N 处」（%r）" % (pid, text))
                if row.get("more") != str(len(items) - 3):
                    ps_problems.append("%s 的 data-more=%r ≠ %d"
                                       % (pid, row.get("more"), len(items) - 3))
        check(not ps_problems,
              "E12 案件档案每个 party 都有地图标注（13px 次要色、与 person_scenes.json 一致）",
              "；".join(ps_problems[:6]) or {"cid": cv.get("cid"), "rows": len(rows)})

        # E13：>3 处时点整行能展开全部（这一段是可选交互，既然做了就用真实点击守住）。
        expand_row = next((r for r in rows if r.get("ids") and len(r["ids"]) > 3), None)
        expanded = None
        if expand_row:
            expanded = pg.js("""(() => {
              const line = document.querySelector(
                '.tp-page[data-page="case"] .tp-party[data-party="%s"] .tp-party-scene');
              if (!line) return null;
              line.click();
              return { text: (line.textContent || '').trim(),
                       expanded: line.getAttribute('data-expanded'),
                       more: line.getAttribute('data-more') };
            })()""" % expand_row["id"])
        want_names = [str(it.get("name")) for it in (exp.get(expand_row["id"]) or [])] if expand_row else []
        check(bool(expanded) and expanded["expanded"] == "true" and expanded["more"] == "0"
              and all(name in expanded["text"] for name in want_names) and len(want_names) > 3,
              "E13 点「等 N 处」能展开全部地图标注（收起前 4 处都写出来）",
              expanded or "没有 >3 处的当事人")

        lesson = pg.js("""(() => {
          window.__app.phone.openPage('learn');
          const pane = '.tp-page[data-page="learn"] ';
          const ops = document.querySelectorAll(pane + '.tp-op').length;
          const tabs = document.querySelectorAll(pane + '.tp-tab');
          if (tabs[1]) tabs[1].click();
          const cards = document.querySelectorAll(pane + '.tp-kcard').length;
          return { ops, cards, tabs: tabs.length };
        })()""")
        check(bool(lesson) and lesson["ops"] == 8 and lesson["cards"] == 12,
              "E7 学习：操作 8 条 + 知识 12 张", lesson)

        notes = pg.js("""(() => {
          window.__app.phone.openPage('notes');
          const pane = '.tp-page[data-page="notes"] ';
          const ta = document.querySelector(pane + '.tp-note-input');
          if (!ta) return { err: 'no-input' };
          ta.value = '测试笔记：先问他最不肯让的是什么';
          const save = Array.prototype.filter.call(
            document.querySelectorAll(pane + '.tp-btn'),
            (b) => (b.textContent || '').indexOf('存下') >= 0)[0];
          if (!save) return { err: 'no-save' };
          save.click();
          const afterAdd = document.querySelectorAll(pane + '.tp-note').length;
          const del = document.querySelector(pane + '.tp-note-del');
          if (del) del.click();
          const afterDel = document.querySelectorAll(pane + '.tp-note').length;
          return { afterAdd, afterDel, api: window.__app.phone.getNotes().length };
        })()""")
        check(bool(notes) and notes.get("afterAdd") == 1 and notes.get("api") == 0,
              "E8 笔记能存能删（存 → 1 条，删 → 0 条）", notes)

        pg.js("window.__app.phone.close(); true")
        time.sleep(0.65)     # .35s 位移 + .35s visibility 延迟，留一点余量
        closed = pg.js("({ open: window.__app.phone.isOpen(),"
                       " attr: document.querySelector('.tp-root').getAttribute('data-open'),"
                       " vis: getComputedStyle(document.querySelector('.tp-shell')).visibility })")
        check(bool(closed) and not closed["open"] and closed["attr"] == "false"
              and closed["vis"] == "hidden", "E9 手机能收起（0.35s 后隐藏）", closed)

        # ------------------------------------------------------------ F 传送
        # F0/F1 先走一遍真实链路：手机地图点地点 → onAction('teleport') → 云朵转场
        f0 = pg.js("""(() => {
          window.__app.phone.open();
          window.__app.phone.openPage('map');
          const rows = document.querySelectorAll('.tp-page[data-page="map"] .tp-scene[aria-label]');
          const target = Array.prototype.filter.call(
            rows, (r) => (r.textContent || '').indexOf('调解室') >= 0)[0];
          if (!target) return { err: 'no-row', n: rows.length };
          const label = target.getAttribute('aria-label');
          target.click();
          return { label };
        })()""")
        time.sleep(0.5)
        f0s = pg.js("({ mode: window.__app.state.mode, sceneId: window.__app.state.sceneId,"
                    " phoneOpen: window.__app.phone.isOpen(),"
                    " cloud: !!(window.__app.flight && window.__app.state.mode === 'FLIGHT') })")
        check(bool(f0) and f0.get("label") and bool(f0s)
              and f0s["mode"] == "FLIGHT" and f0s["sceneId"] == "mediation"
              and not f0s["phoneOpen"],
              "F1 手机地图点地点 → onAction('teleport') → 云朵转场（手机自动收起）",
              {"click": f0, "state": f0s})
        # 跳到转场末尾：只验"换 iframe + 落地 follow"，不重复等 5.9 秒
        pg.js("window.__app.flight.skip(); true")
        time.sleep(1.8)
        med = pg.js(JS_SCENE)
        check(bool(med) and med["sceneId"] == "mediation"
              and "mediation.html" in (med["src"] or "") and med["mini"]
              and med["mode"] == "FOLLOW",
              "F2 转场结束：iframe 换到 mediation.html、__mini 就绪、回到 FOLLOW",
              med)

        tp = pg.js("window.__app.teleport('wall')")
        time.sleep(2.0)
        flying = pg.js("({ mode: window.__app.state.mode, sceneId: window.__app.state.sceneId })")
        check(tp is True and bool(flying) and flying["mode"] == "FLIGHT",
              "F3 传送中：进入 FLIGHT 状态（云朵转场）", flying)
        time.sleep(5.6)      # 转场共 5.4s + 加载 + 落地补间；软件渲染下多等 0.8s，F6 不再卡在最后一帧
        wall = pg.js(JS_SCENE)
        check(bool(wall) and wall["sceneId"] == "wall" and "wall.html" in (wall["src"] or ""),
              "F4 传送后 state.sceneId='wall' 且 iframe 换到 wall.html", wall)
        check(bool(wall) and wall["mini"] and wall["err"] is None,
              "F5 传送后 iframe 的 __mini 就绪、无异常", wall)
        check(bool(wall) and wall["mode"] == "FOLLOW", "F6 落地回到 FOLLOW（不是停在高空）", wall)
        front2 = pg.js(JS_FRONT)
        camY2 = (front2 or {}).get("cam") or [0, 0, 0]
        check(bool(front2) and 10.0 <= camY2[1] <= 16.0 and front2["dist"] >= 8.0,
              "F7 落地也是俯瞰位（相机离地 10~16m、离主角 ≥8m，不降到贴地高度）", front2)
        world = pg.js("({ phoneScene: window.__app.phone.getSceneId(),"
                      " hint: (document.getElementById('hint').textContent || '').trim() })")
        check(bool(world) and world["phoneScene"] == "wall",
              "F8 手机地图跟着切到新地点", world)

        # ------------------------------------------------------------ G 评价
        sc3 = pg.js(SCORE_SAMPLES)
        ok_sum = bool(sc3) and all(
            k in sc3 and sc3[k]["total"] == sc3[k]["sum"] for k in ("a", "b", "c"))
        check(ok_sum, "G1 scorePlan 三组样例：三维之和 = 总分", sc3)
        grades = {k: (sc3 or {}).get(k, {}).get("grade") for k in ("a", "b", "c")}
        check(grades.get("a") == "A" and grades.get("b") == "B" and grades.get("c") == "C",
              "G2 评级 A / B / C 判对（A≥90，B≥75，C<75）", grades)
        secs = {k: (sc3 or {}).get(k, {}).get("secs") for k in ("a", "b", "c")}
        check(all(v and v["good"] >= 1 and v["next"] >= 1 for v in secs.values()),
              "G3 三组样例的四段点评都有人话（不是空壳）", secs)

        empty = pg.js(SCORE_EMPTY)
        e0 = (empty or {}).get("empty") or {}
        check(bool(empty) and e0.get("total", 999) <= 5 and e0.get("sum") == e0.get("total"),
              "G3b 空方案（无证据、无方案）总分 ≤ 5，三维之和 = 总分", e0)
        hl = (empty or {}).get("hollow") or {}
        check(bool(hl) and hl.get("dims", {}).get("legality") == 0
              and hl.get("dims", {}).get("executability") == 0,
              "G3c 只有 concessions、没有一句正文 → 方案两维都是 0（不靠默认让步拿分）",
              hl)
        snp = (empty or {}).get("seenNoPlan") or {}
        check(bool(snp) and snp.get("dims", {}).get("legality") == 0
              and snp.get("dims", {}).get("executability") == 0
              and snp.get("dims", {}).get("understanding", 99) <= 5
              and snp.get("total", 999) <= 6 and snp.get("total") == snp.get("sum"),
              "G3d 看完全部证据但方案为空 → 总分仍 ≤6（只剩 0~5 的「看过」分）", snp)
        swp = (empty or {}).get("seenWithPlan") or {}
        check(bool(swp) and swp.get("total", 0) >= 75
              and swp.get("total", 0) >= snp.get("total", 0) + 60,
              "G3e 同样证据写一句可执行方案 → ≥75，比空方案高 60 分以上（分数在方案上）",
              swp)

        pg.js("window.__app.openPhone('review'); true")
        time.sleep(0.35)
        plan_text = ("边界认定以宅基地档案和界石为准，墙先不动。\n"
                     "排水沟由村委出工出钱，七日内修通；证据支撑用档案、界石照片和积水照片。\n"
                     "双方各让一步，张家用超市代销李家鸡蛋，谁违约谁承担责任，逾期由村委督促。")
        plan_filled = pg.js("""(() => {
          const ta = document.querySelector('.tp-page[data-page="review"] [data-plan-input]');
          if (!ta) return null;
          ta.value = %s;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return { len: ta.value.length,
                   draft: (() => { try {
                     return (localStorage.getItem('tjt.phone.plan.v1.case_06_wall') || '').length;
                   } catch (e) { return -1; } })() };
        })()""" % json.dumps(plan_text))
        pg.js("""(() => {
          const end = document.querySelector('.tp-page[data-page="review"] [data-end]');
          if (end) end.click();
          return true;
        })()""")
        time.sleep(0.6)
        card = pg.js("""(() => {
          const c = document.querySelector('#reviewLayer .rv-card');
          if (!c) return null;
          const dim = (k) => +c.querySelector('[data-k="' + k + '"]').textContent;
          return {
            total: +c.querySelector('.rv-total').textContent,
            u: dim('understanding'), l: dim('legality'), e: dim('executability'),
            grade: c.dataset.grade, seal: (c.querySelector('.rv-seal-l') || {}).textContent,
            replayBtn: (() => { const b = c.querySelector('.rv-replay');
                                return !!b && !b.hidden; })(),
            secs: c.querySelectorAll('.rv-sec li').length,
            layerOn: document.getElementById('reviewLayer').classList.contains('on')
          };
        })()""")
        check(bool(card) and card["layerOn"], "G4 结案按钮 → 评价卡上屏", card)
        plan_now = pg.js("""(() => {
          const p = window.__app.state.plan || {};
          const claims = Array.isArray(p.claims) ? p.claims : [];
          return { claims: claims.length, texts: claims.map((c) => c.text).slice(0, 3) };
        })()""")
        check(bool(plan_filled) and bool(plan_now) and plan_now["claims"] >= 2
              and bool(card) and card["total"] > 40,
              "G4b 写了方案再结案：state.plan 有 ≥2 条 claim，评价分 > 40",
              {"filled": plan_filled, "plan": plan_now,
               "total": card and card["total"]})
        check(bool(card) and card["total"] == card["u"] + card["l"] + card["e"],
              "G5 卡上三维之和 = 卡上总分", card)
        check(bool(card) and card["seal"] == card["grade"] and card["secs"] >= 4,
              "G6 卡上有评级印章与四段点评", card and {"grade": card["grade"],
                                                       "seal": card["seal"],
                                                       "secs": card["secs"]})
        check(bool(card) and card["replayBtn"], "G7 卡上有「看复盘」按钮", card and card["replayBtn"])

        backfill = pg.js("""(() => {
          const page = document.querySelector('.tp-page[data-page="review"]');
          if (!page) return null;
          return {
            vals: Array.prototype.map.call(page.querySelectorAll('.tp-score-n'),
                                           (n) => (n.textContent || '').trim()),
            seal: (page.querySelector('.tp-seal') || {}).textContent,
            sub: (page.querySelector('[data-slot="sub-review"]') || {}).textContent
          };
        })()""")
        check(bool(backfill) and backfill["vals"] and all(v not in ("", "—") for v in backfill["vals"])
              and (backfill["seal"] or "").strip() in ("A", "B", "C"),
              "G8 分数回填到手机「评价复盘」页（三维 + 评级）", backfill)

        # ------------------------------------------------------------ H 复盘
        pg.js("(() => { const b = document.querySelector('#reviewLayer .rv-replay');"
              " if (b) b.click(); return true; })()")
        time.sleep(0.5)
        rp = pg.js("""(() => {
          const layer = document.getElementById('replayLayer');
          const nodes = layer.querySelectorAll('.rp-node');
          return { on: layer.classList.contains('on'), n: nodes.length,
                   segs: layer.querySelectorAll('.rp-seg').length,
                   count: (layer.querySelector('.rp-count') || {}).textContent,
                   reviewGone: document.querySelectorAll('#reviewLayer .rv-card').length,
                   first: nodes.length ? nodes[0].textContent.trim().slice(0, 18) : '' };
        })()""")
        check(bool(rp) and rp["on"] and rp["n"] == 12,
              "H1 看复盘 → 时间轴渲染 12 个节点", rp)
        check(bool(rp) and rp["segs"] == rp["n"], "H2 底部走势带与节点一一对应", rp)
        check(bool(rp) and rp["reviewGone"] == 0, "H3 进复盘时评价卡已收起", rp)
        check(bool(rp) and "12" in (rp["count"] or ""), "H4 节点计数写成「12 个节点」", rp and rp["count"])

        before = pg.js("""(() => {
          const w = document.getElementById('frame').contentWindow;
          return { cam: (w && w.__dbg) ? [+w.__dbg.camera.position.x.toFixed(2),
                                           +w.__dbg.camera.position.y.toFixed(2),
                                           +w.__dbg.camera.position.z.toFixed(2)] : null,
                   seeks: (window.__app.state.replay || {}).seeks || 0 };
        })()""")
        pg.js("(() => { const n = document.querySelectorAll('#replayLayer .rp-node');"
              " if (n[3]) n[3].click(); return true; })()")
        time.sleep(1.5)
        after = pg.js("""(() => {
          const w = document.getElementById('frame').contentWindow;
          return { mode: window.__app.state.mode,
                   seeks: (window.__app.state.replay || {}).seeks || 0,
                   cam: (w && w.__dbg) ? [+w.__dbg.camera.position.x.toFixed(2),
                                          +w.__dbg.camera.position.y.toFixed(2),
                                          +w.__dbg.camera.position.z.toFixed(2)] : null,
                   err: window.__err || null };
        })()""")
        moved = 0.0
        if before and after and before["cam"] and after["cam"]:
            moved = sum(abs(a - b) for a, b in zip(before["cam"], after["cam"]))
        check(bool(after) and after["seeks"] == 1, "H5 点节点触发回调（seeks +1）", after)
        check(bool(after) and after["mode"] == "REPLAY", "H6 回调把相机切到 REPLAY 状态", after)
        check(moved > 1.0 and bool(after) and after["cam"] and after["cam"][1] > 5.5,
              "H7 机位真的下发到 iframe（相机移动 > 1m 且抬到高空）",
              {"before": before, "after": after, "moved": round(moved, 2)})

        # H7b/H7c：两个不同节点必须落在两个机位，高亮也得跟着被点的那一个走。
        # 旧版 recordNode 把每个节点都写成场景默认落机位，点第 4 个和第 9 个相机完全不动。
        pg.js("(() => { const n = document.querySelectorAll('#replayLayer .rp-node');"
              " if (n[8]) n[8].click(); return true; })()")
        time.sleep(1.5)
        second = pg.js("""(() => {
          const nodes = [...document.querySelectorAll('#replayLayer .rp-node')];
          const on = nodes.findIndex((n) => n.classList.contains('is-on'));
          const w = document.getElementById('frame').contentWindow;
          return {
            on,
            cam: (w && w.__dbg) ? [+w.__dbg.camera.position.x.toFixed(2),
                                    +w.__dbg.camera.position.y.toFixed(2),
                                    +w.__dbg.camera.position.z.toFixed(2)] : null,
            act: (document.querySelector('#replayLayer .rp-d-act') || {}).textContent || '',
            nodeAct: on >= 0 ? ((nodes[on].querySelector('.rp-act') || {}).textContent || '') : '',
            aria: on >= 0 ? nodes[on].getAttribute('aria-current') : null,
            seeks: (window.__app.state.replay || {}).seeks || 0
          };
        })()""")
        dist = 0.0
        if after and after["cam"] and second and second["cam"]:
            dist = sum((x - y) ** 2 for x, y in zip(after["cam"], second["cam"])) ** 0.5
        check(bool(second) and dist > 0.5,
              "H7b 点第 4 / 第 9 个节点 → 相机落在两个不同机位（距离 > 0.5m）",
              {"first": after and after["cam"], "second": second and second["cam"],
               "dist": round(dist, 2)})
        check(bool(second) and second["on"] == 8 and second["aria"] == "true"
              and (second["act"] or "").strip() == (second["nodeAct"] or "").strip()
              and second["seeks"] == 2,
              "H7c 高亮与右侧详情都跟到被点的那个节点（不是永远第一个）", second)

        check(bool(after) and after["err"] is None, "H8 复盘全程无未捕获异常", after and after["err"])

        pg.js("window.__app.closeReplay(); true")
        time.sleep(0.4)
        layers = pg.js("({ rv: document.getElementById('reviewLayer').classList.contains('on'),"
                       " rp: document.getElementById('replayLayer').classList.contains('on'),"
                       " nodes: document.querySelectorAll('#replayLayer .rp-node').length })")
        check(bool(layers) and not layers["rv"] and not layers["rp"] and layers["nodes"] == 0,
              "H9 复盘能收起，两层都关干净", layers)

        # ------------------------------------------------------------ I 视口
        big = pg.js(JS_OVERFLOW)
        check(bool(big) and big["sw"] <= big["vw"] + 1,
              "I1 1440×900 无横向溢出", big)

        pg.viewport(390, 844, mobile=True, scale=2)
        time.sleep(0.6)
        small = pg.js(JS_OVERFLOW)
        check(bool(small) and small["sw"] <= small["vw"] + 1,
              "I2 390×844 无横向溢出（窄屏）", small)
        check(bool(small) and small["vw"] == 390 and abs(small["canvasW"] - 390) <= 2,
              "I3 390 宽下画布跟着视口铺满", small)

        phone_small = pg.js("window.__app.phone.open(); true")
        time.sleep(0.6)      # 等 0.35s 滑入走完再量位置
        phone_small = pg.js("""(() => {
          const sh = document.querySelector('.tp-shell').getBoundingClientRect();
          return { vw: innerWidth, sw: document.documentElement.scrollWidth,
                   left: Math.round(sh.left), right: Math.round(sh.right),
                   w: Math.round(sh.width), open: window.__app.phone.isOpen() };
        })()""")
        check(bool(phone_small) and phone_small["open"]
              and phone_small["sw"] <= phone_small["vw"] + 1
              and phone_small["left"] >= -1 and phone_small["right"] <= phone_small["vw"] + 1,
              "I4 390 宽下手机面板不越界、不撑宽页面", phone_small)

        pg.js("window.__app.phone.close(); true")
        time.sleep(0.5)
        # 问话面板（2026-11 改版）：预设话题列表已删，只剩人物名 + 两条量表 +
        # 输入框 + 发送按钮 + 引用入口；窄屏下面板不能出屏。
        pg.js("window.__app.openDialog('p_a').then(d => !!d)")
        time.sleep(0.55)
        dlg_small = pg.js("""(() => {
          const c = document.querySelector('.dlg-card');
          if (!c) return null;
          const r = c.getBoundingClientRect();
          return { vw: innerWidth, sw: document.documentElement.scrollWidth,
                   left: Math.round(r.left), right: Math.round(r.right),
                   topics: c.querySelectorAll('.dlg-topic').length,
                   inputs: c.querySelectorAll('.dlg-input').length,
                   send: c.querySelectorAll('.dlg-send').length,
                   refs: c.querySelectorAll('[data-ref]').length,
                   meters: c.querySelectorAll('.dlg-meter').length,
                   name: (c.querySelector('.dlg-name') || {}).textContent || '',
                   close: !!c.querySelector('.dlg-x') };
        })()""")
        check(bool(dlg_small) and dlg_small["topics"] == 0 and dlg_small["inputs"] == 1
              and dlg_small["send"] == 1 and dlg_small["refs"] == 2
              and dlg_small["meters"] == 2 and dlg_small["close"]
              and bool(dlg_small["name"])
              and dlg_small["sw"] <= dlg_small["vw"] + 1
              and dlg_small["left"] >= -1 and dlg_small["right"] <= dlg_small["vw"] + 1,
              "I5 390 宽下问话面板不出屏：只有输入框/发送/两条量表，没有预设话题",
              dlg_small)
        pg.js("window.__app.closeDialog(); true")
        time.sleep(0.35)

        # 加载页版式：只亮层看排版，不重跑十场预热
        pg.js("(() => { const l = document.getElementById('load'); l.hidden = false;"
              " l.classList.add('on'); return true; })()")
        time.sleep(0.3)
        load_small = pg.js("""(() => {
          const c = document.querySelector('#load .load-card');
          const cur = document.getElementById('loadCur');
          if (!c) return null;
          const r = c.getBoundingClientRect();
          return { vw: innerWidth, sw: document.documentElement.scrollWidth,
                   left: Math.round(r.left), right: Math.round(r.right),
                   curW: cur ? Math.round(cur.getBoundingClientRect().width) : 0,
                   text: (cur ? cur.textContent : '').trim() };
        })()""")
        check(bool(load_small) and load_small["sw"] <= load_small["vw"] + 1
              and load_small["left"] >= -1 and load_small["right"] <= load_small["vw"] + 1,
              "I6 390 宽下加载页卡片不出屏（进度条不被挤）", load_small)
        pg.js("(() => { const l = document.getElementById('load'); l.classList.remove('on');"
              " l.hidden = true; return true; })()")
        time.sleep(0.3)

        pg.js("window.__app.phone.close(); true")
        pg.viewport(1440, 900)
        time.sleep(0.4)

        # 直接调 enterScene（不走密码门 / 加载页）也要能起场景 —— 这是外壳对外的主入口
        pg.js("window.__app.enterScene('court'); true")
        pg.wait_for("(() => { const f = document.getElementById('frame');"
                    " try { return !!(f.contentWindow && f.contentWindow.__mini); }"
                    " catch (e) { return false; } })()", 15)
        time.sleep(1.4)
        direct = pg.js(JS_SCENE)
        check(bool(direct) and direct["sceneId"] == "court" and direct["mini"]
              and direct["mode"] == "FOLLOW" and direct["err"] is None,
              "J2 直接调 enterScene('court') 也能起场景并落到 FOLLOW", direct)
        front3 = pg.js(JS_FRONT)
        check(bool(front3) and 3.0 <= front3["dist"] <= 5.0,
              "J3 直调 enterScene 后距离同样在 3~5 米", front3)

        # ------------------------------------------------------------ K 真实鼠标通关
        # 这一节补的是一条缝：原来的 65 条里没有一条**用真实鼠标**点过人 / 物件，
        # 也没有真的拖过、滚过、逐个点过九宫格 / 地图行 / 复盘节点 ——
        # "点人不开口""点物件不收证据"两个 bug 正是从这条缝里漏过去的。
        # 这里全部走 CDP Input（真实 pointer / wheel 事件），不往 contentDocument 派假事件。
        import qa_play as Q

        pg.js("window.__app.teleport('wall'); true")
        pg.wait_for("(() => window.__app.state.sceneId === 'wall'"
                    " && window.__app.state.mode === 'FOLLOW')()", 25)
        time.sleep(1.6)
        check(pg.js("window.__app.state.sceneId") == "wall",
              "K0 传送到院墙场景（K1~K6 的场地）", pg.js("window.__app.state.sceneId"))

        # ---- 真实点人 → 走近 → 问话面板（自由输入，不再有预设话题）
        dlg = None
        hit_person = None
        for _ in range(2):
            time.sleep(0.9)
            hit_person = Q.fresh_target(pg, "people")
            if not hit_person:
                continue
            Q.click(cdp, hit_person["pt"][0], hit_person["pt"][1], settle=0.3)
            dlg = Q.poll(pg, "(() => { const c = document.querySelector('.dlg-card');"
                             " return c ? { name: (c.querySelector('.dlg-name') || {}).textContent,"
                             "  topics: c.querySelectorAll('.dlg-topic').length,"
                             "  inputs: c.querySelectorAll('.dlg-input').length,"
                             "  send: c.querySelectorAll('.dlg-send').length,"
                             "  refs: c.querySelectorAll('[data-ref]').length,"
                             "  meters: c.querySelectorAll('.dlg-meter').length } : null; })()", 14)
            if dlg:
                break
        check(bool(dlg) and dlg["topics"] == 0 and dlg["inputs"] == 1 and dlg["send"] == 1
              and dlg["refs"] == 2 and dlg["meters"] == 2 and bool(dlg["name"]),
              "K1 真实鼠标点场景里的人（身体）→ 走过去 → 弹出问话面板（只要输入框，无预设话题）",
              {"target": hit_person and hit_person["id"], "dlg": dlg})

        if dlg:
            # 自由输入一句话：真实鼠标点输入框 + 真实键盘输入 + 真实鼠标点发送
            inp = Q.rect(pg, ".dlg-card .dlg-input")
            Q.click(cdp, inp["x"], inp["y"], settle=0.2)
            cdp.call("Input.insertText", {"text": "你先坐下，慢慢说，到底怎么回事？"})
            time.sleep(0.25)
            typed = pg.js("(document.querySelector('.dlg-card .dlg-input') || {}).value || ''")
            send = Q.rect(pg, ".dlg-card .dlg-send")
            Q.click(cdp, send["x"], send["y"], settle=0.25)
            ans = Q.poll(pg, "(() => { const rows = document.querySelectorAll("
                             "'.dlg-msg--them .dlg-bubble'); if (!rows.length) return null;"
                             " return { n: rows.length,"
                             " text: rows[rows.length - 1].textContent.trim().slice(0, 60),"
                             " sys: document.querySelectorAll('.dlg-card .dlg-sys').length }; })()", 20)
            if not ans:
                # 模型偶发超时（外壳 12s 就断）：输入框原样留着，再点一次发送重试
                send = Q.rect(pg, ".dlg-card .dlg-send")
                if send:
                    Q.click(cdp, send["x"], send["y"], settle=0.3)
                    ans = Q.poll(pg, "(() => { const rows = document.querySelectorAll("
                                     "'.dlg-msg--them .dlg-bubble'); if (!rows.length) return null;"
                                     " return { n: rows.length,"
                                     " text: rows[rows.length - 1].textContent.trim().slice(0, 60),"
                                     " sys: document.querySelectorAll('.dlg-card .dlg-sys').length }; })()", 20)
            check(bool(ans) and ans["n"] >= 1 and len(ans["text"]) > 4,
                  "K2 真实输入一句话 → 点发送 → 有回答（气泡有字）",
                  {"typed": typed, "ans": ans})
            close_btn = Q.rect(pg, ".dlg-card .dlg-x")
            Q.click(cdp, close_btn["x"], close_btn["y"], settle=0.3)
            gone = Q.poll(pg, "(() => { const n = document.querySelectorAll('.dlg-card').length;"
                              " return (n === 0 && !window.__app.dialog)"
                              " ? { card: 0, dlg: false } : null; })()", 3.0)
            if not gone:
                gone = pg.js("({ card: document.querySelectorAll('.dlg-card').length,"
                             " dlg: !!window.__app.dialog })")
            check(gone["card"] == 0 and not gone["dlg"],
                  "K3 问话面板能关（DOM 移除 + state 清空）", gone)
        else:
            check(False, "K2 真实输入一句话 → 点发送 → 有回答（气泡有字）", "K1 没出面板")
            check(False, "K3 问话面板能关（DOM 移除 + state 清空）", "K1 没出面板")

        # ---- 真实点地面 → 继续走（关掉面板后还能动）
        walked = None
        for _ in range(3):
            time.sleep(0.7)
            g = pg.js(Q.JS_GROUND)
            cands = (g or {}).get("cands") or []
            if not cands:
                continue
            before = g.get("actor") or pg.js("""(() => {
              const w = document.getElementById('frame').contentWindow;
              return w.__mini.actorPos(); })()""")
            c = cands[0]
            Q.click(cdp, c["sx"], c["sy"], settle=0.3)
            t0 = time.time()
            while time.time() - t0 < 4.0:
                st = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
                  return w.__mini.actorPos(); })()""")
                if st and ((st["x"] - before["x"]) ** 2 + (st["z"] - before["z"]) ** 2) ** 0.5 > 0.12:
                    walked = {"from": before, "to": st}
                    break
                time.sleep(0.12)
            if walked:
                break
        check(bool(walked), "K4 关掉问话后真实点地面还能走", walked)

        # ---- 真实点物件 → 证据进 seen + 手机证据夹
        # 点"案卷里登记过的事实点位"（s_stone → f_marker 等）。不能随手点第一件陈设：
        # 场景修过 passable 不再挂 propId 之后，第一件可点物件不一定是证据点位，
        # 点到没有事实映射的家具只会把 s_xxx 记进 seen，手机证据夹仍然是 0（假红）。
        seen0 = pg.js("window.__app.state.seen.size")
        got = None
        wants = ["s_stone", "s_wallOld", "s_wallNew", "s_ditch", "s_drip"]
        for attempt in range(5):
            time.sleep(0.9)
            if attempt == 0:
                tg = pg.js(Q.JS_TARGETS) or {}
                center = next((p["center"] for p in tg.get("props") or []
                               if p["id"] == "s_stone"), None)
                if center:
                    Q.face_point(cdp, pg, center)
                time.sleep(0.5)
            prop = Q.fresh_target(pg, "props", ids=wants, min_dist=1.2)
            if not prop:
                Q.drag(cdp, 720, 470, 160 if attempt % 2 == 0 else -240, 0)
                continue
            Q.click(cdp, prop["pt"][0], prop["pt"][1], settle=0.3)
            got = Q.poll(pg, "(() => window.__app.state.seen.size > %d ?"
                             " [...window.__app.state.seen] : null)()" % seen0, 7)
            if got:
                break
        check(bool(got) and len(got) > seen0,
              "K5 真实鼠标点场景物件 → 走近 → 证据进 state.seen", {"seen": got})

        Q.phone_home(cdp, pg)
        tile_ev = Q.rect(pg, '.tp-app[data-app="evidence"]')
        Q.click(cdp, tile_ev["x"], tile_ev["y"], settle=0.45)
        ev_page = pg.js("""(() => { const page = document.querySelector(
            '.tp-page[data-page="evidence"]');
          if (!page) return null;
          const cards = [...page.querySelectorAll('.tp-evi')];
          return { n: cards.length,
                   collected: cards.filter((c) => !c.classList.contains('is-missing')).length }; })()""")
        check(bool(ev_page) and ev_page["n"] >= 1 and ev_page["collected"] >= 1,
              "K6 手机证据夹里那件已变成「已收集」", ev_page)

        # ---- 真实拖动 / 滚轮
        Q.phone_close(cdp, pg)
        time.sleep(0.5)
        az0 = pg.js("""(() => { const T = window.__dbg.THREE; const v = new T.Vector3();
          window.__app.camera.getWorldDirection(v);
          return +Math.atan2(v.x, v.z).toFixed(4); })()""")
        Q.drag(cdp, 720, 470, 150, 0)
        time.sleep(0.35)
        az1 = pg.js("""(() => { const T = window.__dbg.THREE; const v = new T.Vector3();
          window.__app.camera.getWorldDirection(v);
          return +Math.atan2(v.x, v.z).toFixed(4); })()""")
        check(abs((az1 or 0) - (az0 or 0)) > 0.15,
              "K7 真实按住拖动 → 视角 yaw 变化", {"az0": az0, "az1": az1})

        d0 = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          return w.__mini.stats().camDist; })()""")
        Q.wheel(cdp, 720, 470, -260)
        time.sleep(0.3)
        d1 = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          return w.__mini.stats().camDist; })()""")
        check(abs((d1 or 0) - (d0 or 0)) >= 1, "K8 真实滚轮 → camDist 变化", {"d0": d0, "d1": d1})

        # ---- 九宫格九个入口逐个真实点击
        Q.phone_home(cdp, pg)
        bad_tiles = []
        for key in ("case", "people", "evidence", "notes", "laws", "map", "contact",
                    "learn", "review"):
            Q.phone_home(cdp, pg)
            t = Q.rect(pg, '.tp-app[data-app="%s"]' % key)
            if not t:
                bad_tiles.append(key + ":no-tile")
                continue
            Q.click(cdp, t["x"], t["y"], settle=0.4)
            st = pg.js("""(() => { const p = window.__app.phone.page;
              const page = document.querySelector('.tp-page[data-page="' + p + '"]');
              return { page: p, hidden: page ? page.hidden : null,
                       len: page ? (page.textContent || '').trim().length : 0 }; })()""")
            if st["page"] != key or st["hidden"] is not False or st["len"] < 10:
                bad_tiles.append("%s->%s" % (key, st))
        check(not bad_tiles, "K9 九宫格九个入口逐个真实点击都能进", bad_tiles)

        # ---- 地图行真实点击 → 云朵转场
        Q.phone_home(cdp, pg)
        t = Q.rect(pg, '.tp-app[data-app="map"]')
        Q.click(cdp, t["x"], t["y"], settle=0.45)
        rows = pg.js("""(() => { const out = [];
          document.querySelectorAll('.tp-page[data-page="map"] .tp-scene').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || el.tagName !== 'BUTTON') return;
            out.push({ t: (el.textContent || '').trim().slice(0, 8),
                       x: Math.round(r.left + r.width / 2),
                       y: Math.round(r.top + r.height / 2) }); });
          return out; })()""")
        check(len(rows or []) == 9, "K10a 地图上可点的其它地点 9 个（当前地点是 div）", rows)
        before_scene = pg.js("window.__app.state.sceneId")
        Q.click(cdp, rows[0]["x"], rows[0]["y"], settle=0.35)
        fly = pg.js("({ mode: window.__app.state.mode, sceneId: window.__app.state.sceneId,"
                    " tr: window.__app.flight.transition })")
        check(bool(fly) and fly["mode"] == "FLIGHT" and fly["sceneId"] != before_scene,
              "K10b 真实点地图行 → 云朵转场（FLIGHT + 目标场景已切换）",
              {"before": before_scene, "state": fly})
        pg.js("window.__app.flight.skip(); true")
        pg.wait_for("(() => window.__app.state.mode === 'FOLLOW'"
                    " && window.__app.state.cam === 'play')()", 15)
        time.sleep(0.6)

        # ---- 评价卡 + 复盘节点真实点击
        # G 段已经把当前案子结掉了，评价页不再有「结案并出评价」。
        # 真实点一下案件页里另一件没结的案子，换过去再出评价卡。
        Q.phone_home(cdp, pg)
        t = Q.rect(pg, '.tp-app[data-app="case"]')
        Q.click(cdp, t["x"], t["y"], settle=0.45)
        other = pg.js("""(() => { const rows = [...document.querySelectorAll(
            '.tp-page[data-page="case"] .tp-case-row:not(.is-current)')];
          if (!rows.length) return null;
          const r = rows[0].getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2),
                   y: Math.round(r.top + r.height / 2),
                   t: (rows[0].textContent || '').trim().slice(0, 12) }; })()""")
        if other:
            Q.click(cdp, other["x"], other["y"], settle=0.6)
            Q.poll(pg, "(() => { const d = window.__app.state.data;"
                       " return d && d.id !== 'case_06_wall' ? d.id : null; })()", 10)
        Q.phone_home(cdp, pg)
        t = Q.rect(pg, '.tp-app[data-app="review"]')
        Q.click(cdp, t["x"], t["y"], settle=0.45)
        end = pg.js("""(() => { const b = document.querySelector(
            '.tp-page[data-page="review"] [data-end]');
          if (!b) return null; const r = b.getBoundingClientRect();
          return r.width > 1 ? { x: Math.round(r.left + r.width / 2),
                                 y: Math.round(r.top + r.height / 2) } : null; })()""")
        card = None
        if end:
            Q.click(cdp, end["x"], end["y"], settle=0.7)
            card = pg.js("""(() => { const c = document.querySelector('#reviewLayer .rv-card');
              if (!c) return null;
              const dims = {};
              c.querySelectorAll('[data-k]').forEach((el) => {
                dims[el.getAttribute('data-k')] = +el.textContent; });
              return { total: +c.querySelector('.rv-total').textContent, dims,
                       grade: c.dataset.grade,
                       secs: c.querySelectorAll('.rv-sec').length,
                       replay: !!c.querySelector('.rv-replay') }; })()""")
        check(bool(card) and sum(card["dims"].values()) == card["total"]
              and len(card["dims"]) >= 3 and card["secs"] >= 4 and card["replay"],
              "K11 真实点「结案并出评价」→ 评价卡（三维和=总分、四段、有看复盘）", card)

        rp = None
        if card and card["replay"]:
            rb = Q.rect(pg, "#reviewLayer .rv-replay")
            Q.click(cdp, rb["x"], rb["y"], settle=0.6)
            rp = pg.js("""(() => { const l = document.getElementById('replayLayer');
              return { on: l.classList.contains('on'),
                       n: l.querySelectorAll('.rp-node').length }; })()""")
            check(bool(rp) and rp["on"] and rp["n"] >= 10,
                  "K12 真实点「看复盘」→ 时间轴出节点", rp)
            node = pg.js("""(() => { const n = document.querySelectorAll(
                '#replayLayer .rp-node')[2];
              if (!n) return null; const r = n.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2),
                       y: Math.round(r.top + r.height / 2) }; })()""")
            before_cam = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
              return w.__dbg ? [+w.__dbg.camera.position.x.toFixed(2),
                                +w.__dbg.camera.position.y.toFixed(2),
                                +w.__dbg.camera.position.z.toFixed(2)] : null; })()""")
            Q.click(cdp, node["x"], node["y"], settle=1.4)
            after_rp = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
              return { mode: window.__app.state.mode,
                       cam: w.__dbg ? [+w.__dbg.camera.position.x.toFixed(2),
                                       +w.__dbg.camera.position.y.toFixed(2),
                                       +w.__dbg.camera.position.z.toFixed(2)] : null,
                       err: window.__err || null }; })()""")
            moved = 0.0
            if before_cam and after_rp["cam"]:
                moved = sum(abs(a - b) for a, b in zip(before_cam, after_rp["cam"]))
            check(after_rp["mode"] == "REPLAY" and moved > 1.0,
                  "K13 真实点复盘节点 → 相机飞回去（mode=REPLAY、位移>1m）",
                  {"mode": after_rp["mode"], "moved": round(moved, 2)})

            # K13b/K13c：换第 9 个节点再点一次。旧版所有节点的 actor 都写成场景
            # 默认落机位，第二下点下去相机一动不动 —— 这两条就是"点哪都一样"的回归。
            node2 = pg.js("""(() => { const n = document.querySelectorAll(
                '#replayLayer .rp-node')[8];
              if (!n) return null; const r = n.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2),
                       y: Math.round(r.top + r.height / 2) }; })()""")
            second_rp = None
            dist2 = 0.0
            if node2:
                Q.click(cdp, node2["x"], node2["y"], settle=1.5)
                second_rp = pg.js("""(() => {
                  const nodes = [...document.querySelectorAll('#replayLayer .rp-node')];
                  const on = nodes.findIndex((n) => n.classList.contains('is-on'));
                  const w = document.getElementById('frame').contentWindow;
                  return {
                    on,
                    cam: w.__dbg ? [+w.__dbg.camera.position.x.toFixed(2),
                                    +w.__dbg.camera.position.y.toFixed(2),
                                    +w.__dbg.camera.position.z.toFixed(2)] : null,
                    act: (document.querySelector('#replayLayer .rp-d-act') || {}).textContent || '',
                    nodeAct: on >= 0 ? ((nodes[on].querySelector('.rp-act') || {}).textContent || '') : '',
                    err: window.__err || null }; })()""")
                if after_rp["cam"] and second_rp["cam"]:
                    dist2 = sum((a - b) ** 2 for a, b in
                                zip(after_rp["cam"], second_rp["cam"])) ** 0.5
            check(bool(second_rp) and dist2 > 0.5,
                  "K13b 真实点第 9 个节点 → 相机到另一个机位（两个节点距离 > 0.5m）",
                  {"node3": after_rp["cam"], "node9": second_rp and second_rp["cam"],
                   "dist": round(dist2, 2)})
            check(bool(second_rp) and second_rp["on"] == 8
                  and (second_rp["act"] or "").strip() == (second_rp["nodeAct"] or "").strip(),
                  "K13c 复盘高亮跟到被点的那个节点（不是永远第一个）", second_rp)
            pg.js("window.__app.closeReplay(); true")
            time.sleep(0.4)
        else:
            check(False, "K12 真实点「看复盘」→ 时间轴出节点", "K11 没出卡")
            check(False, "K13 真实点复盘节点 → 相机飞回去", "K11 没出卡")
            check(False, "K13b 两个不同节点 → 两个不同机位", "K11 没出卡")
            check(False, "K13c 复盘高亮跟到被点的节点", "K11 没出卡")

        # K14 真实点通讯录联系人整行 → 手机收起 → 弹出和地图点人**同一张**问话面板。
        # 旧断言只查 body.innerText 有没有「通话中」，一张状态卡也能过；现在按用户
        # 明确要求验的是"能说话的对话框"：姓名、通话计时、输入框、发送、引用、挂断。
        pg.js("(() => { const p = window.__app.phone; if (p) { p.open(); p.openPage('contact'); } return true; })()")
        time.sleep(0.7)
        row = Q.rect(pg, ".tp-call")
        row_info = pg.js("""(() => { const el = document.querySelector('.tp-call');
          if (!el) return null;
          return { name: ((el.querySelector('.tp-call-n') || {}).textContent || '').trim(),
                   tag: ((el.querySelector('.tp-call-t') || {}).textContent || '').trim() }; })()""")
        call = None
        if row:
            Q.click(cdp, row["x"], row["y"], settle=1.6)
            call = pg.js("""(() => {
              const c = document.querySelector('.dlg-card');
              if (!c) return null;
              const r = c.getBoundingClientRect();
              const x = c.querySelector('.dlg-x');
              return {
                name: (c.querySelector('.dlg-name') || {}).textContent || '',
                role: (c.querySelector('.dlg-role') || {}).textContent || '',
                kicker: (c.querySelector('.dlg-kicker') || {}).textContent || '',
                inputs: c.querySelectorAll('.dlg-input').length,
                send: c.querySelectorAll('.dlg-send').length,
                refs: c.querySelectorAll('[data-ref]').length,
                meters: c.querySelectorAll('.dlg-meter').length,
                closeLabel: x ? x.getAttribute('aria-label') : '',
                phoneOpen: window.__app.phone.isOpen(),
                callCard: !!document.querySelector('.tp-call-dialog:not([hidden])'),
                inside: r.left >= -1 && r.right <= innerWidth + 1 &&
                        r.top >= -1 && r.bottom <= innerHeight + 1,
                sw: document.documentElement.scrollWidth, vw: innerWidth
              }; })()""")
        check(bool(call) and bool(row_info) and call["name"] == row_info["name"]
              and call["kicker"] == "通 话" and call["phoneOpen"] is False
              and call["callCard"] is False and call["inputs"] == 1
              and call["send"] == 1 and call["refs"] == 2 and call["meters"] == 2
              and call["inside"] and call["sw"] <= call["vw"] + 1,
              "K14 真实点联系人整行 → 手机收起，弹出和地图点人一样的问话面板",
              {"row": row_info, "call": call})
        tm = re.search(r"通话中\s+(\d{2}:\d{2})", (call or {}).get("role") or "")
        check(bool(call) and bool(tm) and call["closeLabel"] == "挂断",
              "K14b 面板抬头「通 话」、身份行后挂真实通话计时、右上角 × 是挂断",
              {"role": (call or {}).get("role"), "close": (call or {}).get("closeLabel")})

        # 计时真的在走：1.25s 后同一处文本必须变
        t1 = tm.group(1) if tm else ""
        time.sleep(1.25)
        t2 = pg.js("""(() => { const r = document.querySelector('.dlg-role');
          const m = r && (r.textContent || '').match(/通话中\\s+(\\d{2}:\\d{2})/);
          return m ? m[1] : ''; })()""")
        check(bool(t2) and t2 != t1, "K14c 通话计时在走（1.25s 后 MM:SS 变化）",
              {"before": t1, "after": t2})

        # 同一张面板里直接说话：玩家气泡立刻出现（回复由 /api/dialogue 异步来，不等它）
        inp = Q.rect(pg, ".dlg-card .dlg-input")
        if inp:
            Q.click(cdp, inp["x"], inp["y"], settle=0.15)
            cdp.call("Input.insertText", {"text": "喂，我是调解员，你现在方便说话吗？"})
            time.sleep(0.15)
            sb = Q.rect(pg, ".dlg-card .dlg-send")
            if sb:
                Q.click(cdp, sb["x"], sb["y"], settle=0.7)
        said = pg.js("""(() => { const b = document.querySelector('.dlg-msg--me .dlg-bubble');
          return { me: document.querySelectorAll('.dlg-msg--me').length,
                   text: b ? (b.textContent || '').trim() : '' }; })()""")
        check(bool(said) and said["me"] >= 1 and "调解员" in (said["text"] or ""),
              "K14d 通话面板里能直接说话（玩家气泡出现）", said)

        close_x = Q.rect(pg, ".dlg-card .dlg-x")
        if close_x:
            Q.click(cdp, close_x["x"], close_x["y"], settle=0.6)
        off = pg.js("""({ card: !!document.querySelector('.dlg-card'),
          dialog: !!window.__app.dialog, phone: window.__app.phone.isOpen() })""")
        check(bool(off) and not off["card"] and not off["dialog"] and not off["phone"],
              "K14e 点 ×（挂断）→ 面板消失，手机保持收起", off)
        pg.js("window.__app.phone.close(); true")
        time.sleep(0.4)

        # ------------------------------------------------------------ 收尾
        final_err = pg.js("window.__err || null")
        check(final_err is None, "J1 全流程走完，外壳仍然没有未捕获异常", final_err)
        try:
            pg.shot(str(ROOT / "tools" / "_logs" / "APP_final.png"))
            print("截图 → tools/_logs/APP_final.png")
        except (RuntimeError, OSError) as exc:
            print("（截图失败：%s）" % exc)
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        import shutil
        shutil.rmtree(profile, ignore_errors=True)

    print("-" * 64)
    print("通过 %d ｜ 失败 %d" % (PASS, FAIL))
    if FAILED:
        print("失败清单：")
        for f in FAILED:
            print("  · " + f)
    return 0 if FAIL == 0 and PASS > 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="外壳 UI / 交互全量测试")
    ap.add_argument("--url", default=APP_URL)
    args = ap.parse_args()
    return run(args.url)


if __name__ == "__main__":
    sys.exit(main())
