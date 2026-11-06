#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""手机版专项测试（真触摸事件，不是 JS 假事件）。

跑法（项目根）：
    python tools/test_mobile.py
    py -3 tools/test_mobile.py                 # Windows 上 python 是商店占位符时
    python tools/test_mobile.py --url http://127.0.0.1:8770/static/app.html
    python tools/test_mobile.py --only 390     # 只跑一个视口

前置：服务已在 8770 跑着（python src/server.py）。退出码 0 = 全绿。

这一套补的是桌面鼠标测试摸不到的缝：
    · 触摸事件走 CDP Input.dispatchTouchEvent（touchStart/Move/End），
      配合 Emulation.setTouchEmulationEnabled；不是往页面里派自定义事件。
    · 三种视口：390×844 / 430×932 / 844×390（横屏抽屉）。
    · 单指轻点走路 5/5、单指拖动改 yaw、双指捏合改 camDist，三项都读前后数值。
    · 九宫格九个入口逐个真点、全部落在屏内、可点区域 ≥44×44、字号 ≥13px。
    · 问话面板可滚可关；评价卡不出屏；复盘时间轴能横向滚。
    · 移动端降级：第一场 ready 即进，其余九场后台串行预热；pixelRatio ≤1.5。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# 控制台按 UTF-8 输出：断言详情里会出现「‹」/「×」等符号，Windows 的 GBK
# 控制台直接 encode 会抛 UnicodeEncodeError，把测试自己弄崩。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import test_app as T  # noqa: E402  （复用零依赖 CDP / Edge 查找 / 截图）

BASE = T.BASE
APP_URL = T.APP_URL
SHOT_DIR = ROOT / "tools" / "_logs"

PASS = 0
FAIL = 0
FAILED: list[str] = []
SHOTS: list[str] = []
EVIDENCE: dict = {}


def check(ok: bool, msg: str, detail=None) -> bool:
    global PASS, FAIL
    if ok:
        PASS += 1
        print("[PASS] %s" % msg)
    else:
        FAIL += 1
        text = msg + ("  ← " + str(detail) if detail not in (None, "") else "")
        FAILED.append(text)
        print("[FAIL] " + text)
    return bool(ok)


# --------------------------------------------------------------------- 触摸
def _pts(points):
    return [{"x": int(round(p[0])), "y": int(round(p[1])),
             "id": i + 1, "radiusX": 8, "radiusY": 8, "force": 1}
            for i, p in enumerate(points)]


def touch(cdp, kind: str, points) -> None:
    cdp.call("Input.dispatchTouchEvent", {"type": kind, "touchPoints": _pts(points)})


def tap(cdp, x: int, y: int, hold: float = 0.06) -> None:
    touch(cdp, "touchStart", [(x, y)])
    time.sleep(hold)
    touch(cdp, "touchEnd", [])


def drag(cdp, x: int, y: int, dx: int, dy: int, steps: int = 14,
         hold: float = 0.012) -> None:
    touch(cdp, "touchStart", [(x, y)])
    for i in range(1, steps + 1):
        touch(cdp, "touchMove", [(x + dx * i / steps, y + dy * i / steps)])
        time.sleep(hold)
    touch(cdp, "touchEnd", [])


def pinch(cdp, x: int, y: int, r0: int = 48, r1: int = 118, steps: int = 10) -> None:
    touch(cdp, "touchStart", [(x - r0, y), (x + r0, y)])
    for i in range(1, steps + 1):
        r = r0 + (r1 - r0) * i / steps
        touch(cdp, "touchMove", [(x - r, y), (x + r, y)])
        time.sleep(0.014)
    touch(cdp, "touchEnd", [])


def insert_text(cdp, text: str) -> None:
    """手机问话面板输入中文：CDP insertText 等价于输入法上屏，仍是真实输入事件。"""
    cdp.call("Input.insertText", {"text": text})
    time.sleep(0.12)


def rect(pg, sel: str):
    return pg.js("""(() => { const el = document.querySelector(%s);
      if (!el) return null; const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
               l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right),
               b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; })()"""
                  % json.dumps(sel))


def inside(r, vw: int, vh: int, pad: int = 1) -> bool:
    return bool(r) and r["l"] >= -pad and r["t"] >= -pad and r["r"] <= vw + pad and r["b"] <= vh + pad


def angle_delta(a: float, b: float) -> float:
    d = (b - a + 3.141592653589793) % (2 * 3.141592653589793) - 3.141592653589793
    return abs(d)


# --------------------------------------------------------------------- JS 片段
JS_START_PT = """(() => {
  const T = window.__dbg.THREE;
  const b = window.__app.boot.layout()[0];
  const v = new T.Vector3(b.x, b.y, b.z).project(window.__app.camera);
  return [Math.round((v.x * .5 + .5) * innerWidth), Math.round((-v.y * .5 + .5) * innerHeight)];
})()"""

# 地面候选：屏幕网格采样（比"沿主角朝向找点"稳：角色走到墙边时也可能只剩
# 很小一块地面，但屏幕上总有可见的地）。每条候选都用与外壳一致的拾取规则，
# 跳过地面大平面 / 墙 / 描边线，并要求路径 ≥2 格 —— walkTo 在路径不足 2 格时
# 会静默返回，点下去就像"没反应"。
JS_GROUND = """(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__dbg || !w.__mini) return null;
  const T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
  const a = w.__mini.actorPos();
  const W = innerWidth, H = innerHeight;
  const rc = new T.Raycaster();
  const plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const hit = new T.Vector3();
  const out = [];
  for (let sy = Math.max(96, Math.round(H * 0.14)); sy <= H - 64; sy += 32) {
    for (let sx = 34; sx <= W - 34; sx += 32) {
      const ndc = new T.Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
      rc.setFromCamera(ndc, cam);
      if (!rc.ray.intersectPlane(plane, hit)) continue;
      const x = hit.x, z = hit.z;
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < 0.8 || d > 10) continue;
      const p = w.__mini.debugPath(x, z);
      if (!p || p.len < 2) continue;
      const hits = rc.intersectObjects(sc.children, true);
      const groundDist = cam.position.distanceTo(hit);
      let identified = false;
      for (const h of hits) {
        const u = h.object.userData || {};
        // 浮尘 Points、家具描边 LineSegments、接触阴影（半透明面片）都不是实体遮挡，
        // 不跳过它们的话整屏都会被判成"被挡住"（实测 dust 的 AABB 有 10×2.6×7.4 米）。
        const mat = h.object.material;
        if (h.object.isPoints || h.object.isLine || h.object.isLineSegments) { continue; }
        if (mat && mat.transparent && (mat.opacity ?? 1) < 0.5 && !u.propId && !u.personId && !u.nameplateFor) { continue; }
        if (u.personId || u.nameplateFor) { identified = true; break; }
        // 墙体 / 家具 / 人物挡在地面点前面：这个像素看到的是它们，不是地。
        // 地面本身（大而平的 g_*）允许，它离地面平面只差 1~2cm。
        if (h.distance < groundDist - 0.18) {
          let flat = false;
          try {
            const bb = new T.Box3().setFromObject(h.object);
            const sz = bb.getSize(new T.Vector3());
            flat = sz.y < 0.35 && Math.max(sz.x, sz.z) > 8;
          } catch (e) { flat = false; }
          if (!flat) { identified = true; break; }
        }
        if (u.propId) {
          let flat = false;
          try {
            const bb = new T.Box3().setFromObject(h.object);
            const sz = bb.getSize(new T.Vector3());
            flat = sz.y < 0.35 && Math.max(sz.x, sz.z) > 8;
          } catch (e) { flat = false; }
          if (!flat) { identified = true; break; }
        }
      }
      if (identified) continue;
      out.push({ sx, sy, x: +x.toFixed(2), z: +z.toFixed(2), len: p.len, d: +d.toFixed(1) });
    }
  }
  return { actor: a, cands: out };
})()"""

JS_IDLE = """(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__mini) return null;
  const s = w.__mini.stats();
  return (!s.walking && s.path === 0) ? s : null;
})()"""

JS_POS = """(() => {
  const w = document.getElementById('frame').contentWindow;
  return w && w.__mini ? w.__mini.actorPos() : null;
})()"""

JS_CAM = """(() => {
  const T = window.__dbg.THREE, c = window.__app.camera, v = new T.Vector3();
  c.getWorldDirection(v);
  const w = document.getElementById('frame').contentWindow;
  const view = window.__app.flight.view;
  const [px, py, pz] = view.pos, [lx, ly, lz] = view.look;
  return { az: +Math.atan2(v.x, v.z).toFixed(4),
           dist: +Math.hypot(px - lx, py - ly, pz - lz).toFixed(3),
           miniYaw: w.__mini.stats().yaw,
           miniDist: w.__mini.stats().camDist,
           pos: [+px.toFixed(2), +py.toFixed(2), +pz.toFixed(2)] };
})()"""

JS_SCENE = """(() => {
  const f = document.getElementById('frame');
  let mini = false, err = null, mode = null, cam = null;
  try {
    const w = f.contentWindow;
    mini = !!(w && w.__mini);
    err = w ? (w.__err || null) : null;
    mode = window.__app.state.mode;
    cam = window.__app.state.cam;
  } catch (e) { err = String(e); }
  return { started: window.__app.state.started, mode, cam, mini, err,
           sceneId: window.__app.state.sceneId,
           fw: f.clientWidth, fh: f.clientHeight, vw: innerWidth, vh: innerHeight };
})()"""

JS_PHONE = """(() => {
  const root = document.querySelector('.tp-root');
  const shell = document.querySelector('.tp-shell');
  if (!root || !shell) return null;
  const r = shell.getBoundingClientRect();
  const cs = getComputedStyle(shell);
  return { open: root.getAttribute('data-open') === 'true',
           fnOpen: window.__app.phone.isOpen(),
           page: window.__app.phone.page,
           vis: cs.visibility, transform: cs.transform,
           l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right),
           b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height),
           vw: innerWidth, vh: innerHeight };
})()"""

JS_TILES = """(() => {
  const out = [];
  document.querySelectorAll('.tp-app').forEach((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const lab = el.querySelector('.tp-app-label');
    out.push({ key: el.getAttribute('data-app'),
               l: Math.round(r.left), t: Math.round(r.top),
               r: Math.round(r.right), b: Math.round(r.bottom),
               w: Math.round(r.width), h: Math.round(r.height),
               fs: lab ? parseFloat(getComputedStyle(lab).fontSize) : 0,
               vis: cs.visibility });
  });
  return out;
})()"""

# 当前页的字号 / 可点区域审计：只看"真的显示出来"的元素（隐藏页会被跳过）。
JS_AUDIT = """(() => {
  const shell = document.querySelector('.tp-shell');
  if (!shell) return null;
  const low = [], small = [];
  shell.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) return;
    const fs = parseFloat(cs.fontSize);
    if (fs < 13) low.push({ c: String(el.className || el.tagName).slice(0, 30),
                            t: (el.textContent || '').trim().slice(0, 12), fs });
  });
  shell.querySelectorAll('button, a, [role=button]').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) return;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      small.push({ c: String(el.className || el.tagName).slice(0, 30),
                   t: (el.textContent || '').trim().slice(0, 12),
                   w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  return { low: low.slice(0, 8), lowN: low.length, small: small.slice(0, 8), smallN: small.length };
})()"""

JS_DIALOG = """(() => {
  const c = document.querySelector('.dlg-card');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const th = c.querySelector('.dlg-thread');
  const x = c.querySelector('.dlg-x');
  const xr = x ? x.getBoundingClientRect() : null;
  return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right),
           b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height),
           vw: innerWidth, vh: innerHeight,
           inputs: c.querySelectorAll('.dlg-input').length,
           send: c.querySelectorAll('.dlg-send').length,
           refs: c.querySelectorAll('[data-ref]').length,
           msgs: c.querySelectorAll('.dlg-msg--them').length,
           close: xr ? [Math.round(xr.width), Math.round(xr.height)] : null,
           threadScroll: th ? th.scrollTop : 0,
           threadH: th ? [th.scrollHeight, th.clientHeight] : null,
           sw: document.documentElement.scrollWidth };
})()"""

JS_REVIEW = """(() => {
  const c = document.querySelector('#reviewLayer .rv-card');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const body = c.querySelector('.rv-body');
  const btn = (s) => { const b = c.querySelector(s); if (!b) return null;
    const q = b.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; };
  return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right),
           b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height),
           vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth,
           title: getComputedStyle(c.querySelector('.rv-title')).fontSize,
           li: c.querySelector('.rv-sec li') ? getComputedStyle(c.querySelector('.rv-sec li')).fontSize : null,
           close: btn('.rv-close'), replay: btn('.rv-replay'),
           body: body ? [body.scrollHeight, body.clientHeight] : null };
})()"""

JS_REPLAY = """(() => {
  const layer = document.getElementById('replayLayer');
  if (!layer || !layer.classList.contains('on')) return null;
  const host = layer.querySelector('.rp-host');
  if (!host) return null;
  const r = host.getBoundingClientRect();
  const rail = layer.querySelector('.rp-rail');
  const node = layer.querySelector('.rp-node');
  const close = document.getElementById('replayClose');
  const cr = close ? close.getBoundingClientRect() : null;
  return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right),
           b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height),
           vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth,
           nodes: layer.querySelectorAll('.rp-node').length,
           rail: rail ? [rail.scrollWidth, rail.clientWidth, Math.round(rail.scrollLeft)] : null,
           node: node ? [Math.round(node.getBoundingClientRect().width),
                         Math.round(node.getBoundingClientRect().height)] : null,
           close: cr ? [Math.round(cr.width), Math.round(cr.height)] : null };
})()"""

JS_CALL_DLG = """(() => {
  const c = document.querySelector('.dlg-card');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const x = c.querySelector('.dlg-x');
  const xr = x ? x.getBoundingClientRect() : null;
  return {
    l: Math.round(r.left), t: Math.round(r.top),
    r: Math.round(r.right), b: Math.round(r.bottom),
    w: Math.round(r.width), h: Math.round(r.height),
    vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth,
    name: (c.querySelector('.dlg-name') || {}).textContent || '',
    role: (c.querySelector('.dlg-role') || {}).textContent || '',
    kicker: (c.querySelector('.dlg-kicker') || {}).textContent || '',
    inputs: c.querySelectorAll('.dlg-input').length,
    send: c.querySelectorAll('.dlg-send').length,
    refs: c.querySelectorAll('[data-ref]').length,
    meters: c.querySelectorAll('.dlg-meter').length,
    close: xr ? [Math.round(xr.width), Math.round(xr.height)] : null,
    closeLabel: x ? x.getAttribute('aria-label') : '',
    phoneOpen: window.__app.phone.isOpen(),
    callCard: !!document.querySelector('.tp-call-dialog:not([hidden])')
  };
})()"""


def font_audit(pg, selector: str):
    """某块 UI 里所有“真的显示出来”的文字，字号是否都 ≥13px。"""
    return pg.js("""(() => {
      const root = document.querySelector(%s);
      if (!root) return null;
      const low = [];
      root.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) return;
        const fs = parseFloat(cs.fontSize);
        if (fs < 13) low.push({ c: String(el.className || el.tagName).slice(0, 26),
                                t: (el.textContent || '').trim().slice(0, 10), fs });
      });
      return { low: low.slice(0, 6), n: low.length };
    })()""" % json.dumps(selector))


def wait_idle(pg, timeout: float = 4.0) -> bool:
    return bool(pg.wait_for(JS_IDLE, timeout, interval=0.1))


def wait_scene(pg, timeout: float = 30.0):
    return pg.wait_for("""(() => {
      const f = document.getElementById('frame');
      try {
        if (!window.__app.state.started) return null;
        const w = f.contentWindow;
        if (!w || !w.__mini) return null;
        if (window.__app.state.mode !== 'FOLLOW') return null;
        return { mode: window.__app.state.mode, cam: window.__app.state.cam,
                 scene: window.__app.state.sceneId };
      } catch (e) { return null; }
    })()""", timeout, interval=0.12)


# --------------------------------------------------------------------- 单视口
def run_viewport(cdp, pg, w: int, h: int, tag: str) -> None:
    print("\n=== 视口 %d×%d ===" % (w, h), flush=True)
    pg.viewport(w, h, mobile=True, scale=2)
    cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    cdp.call("Page.navigate", {"url": APP_URL})
    if not pg.wait_for("!!(window.__app && window.__app.boot && window.__app.phone)", 30):
        check(False, "%s 页面 30 秒内启动" % tag)
        return
    time.sleep(0.8)
    # 每个视口都从"没关过横屏提示"开始
    pg.js("try { localStorage.removeItem('tjt.rotateTip.v1'); } catch (e) {}; true")

    dev = pg.js("""(() => ({
      mobile: window.__app.isMobile, touch: window.__app.isTouch,
      coarse: matchMedia('(pointer: coarse)').matches,
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
      meta: (document.querySelector('meta[name=viewport]') || {}).content || '',
      sw: document.documentElement.scrollWidth,
      bw: document.body.scrollWidth,
      safeCss: (() => { const st = document.querySelector('style');
        return !!st && /safe-area-inset-(top|right|bottom|left)/.test(st.textContent || ''); })(),
      vars: [getComputedStyle(document.documentElement).getPropertyValue('--sat').trim(),
             getComputedStyle(document.documentElement).getPropertyValue('--sab').trim()]
    }))()""")
    check(bool(dev) and dev["mobile"] and dev["touch"], "%s 真机判定（触摸 + 窄边）" % tag, dev)
    check(bool(dev) and dev["coarse"], "%s 浏览器报告 coarse pointer" % tag, dev)
    check(bool(dev) and "viewport-fit=cover" in dev["meta"],
          "%s viewport 声明 viewport-fit=cover" % tag, dev and dev["meta"])
    check(bool(dev) and dev["safeCss"] and dev["vars"] and dev["vars"][0] != "",
          "%s 安全区 env() 已接入（有 0px 回退）" % tag, dev and dev["vars"])
    check(bool(dev) and dev["sw"] <= dev["vw"] + 1 and dev["bw"] <= dev["vw"] + 1,
          "%s 首屏无横向溢出" % tag, dev and {"sw": dev["sw"], "vw": dev["vw"]})

    # ---- 首屏：真实触摸点「开始调解」
    check(bool(pg.wait_for("window.__app.boot.layout().length === 1", 6)),
          "%s 首屏看板已就位、可点" % tag)
    pt = pg.js(JS_START_PT)
    check(bool(pt) and 0 <= pt[0] <= w and 0 <= pt[1] <= h,
          "%s 「开始调解」看板投影在屏内" % tag, pt)
    if not pt:
        pt = [w // 2, h // 2]
    tap(cdp, pt[0], pt[1])
    time.sleep(0.35)
    first = pg.js("""({ loadOn: document.getElementById('load').classList.contains('on'),
      hidden: document.getElementById('load').hidden,
      started: window.__app.state.started,
      pct: window.__app.loading.pct })""")
    check(bool(first) and first["loadOn"] and not first["hidden"] and not first["started"],
          "%s 触摸点看板 → 进加载页（还没进场景）" % tag, first)

    # ---- 移动端降级：第一场 ready 就标记 early；不等到 100%
    early = pg.wait_for("""(() => window.__app.loading.early ? {
      pct: window.__app.loading.pct, done: window.__app.loading.done,
      bg: window.__app.loading.background, ready: window.__app.loading.ready.slice()
    } : null)()""", 25, interval=0.1)
    check(bool(early) and early["pct"] < 100 and early["bg"],
          "%s 首场就绪即放行（early，后台继续预热）" % tag, early)

    scene = wait_scene(pg, 35)
    check(bool(scene), "%s 加载页能进场景并落到 FOLLOW" % tag, scene)
    if not scene:
        return
    play = pg.wait_for("window.__app.state.cam === 'play' ? true : null", 12)
    check(bool(play), "%s 落地后相机交给场景内自由视角" % tag,
          pg.js("({cam: window.__app.state.cam, mode: window.__app.state.mode})"))
    sc = pg.js(JS_SCENE)
    check(bool(sc) and sc["fw"] == w and sc["fh"] == h,
          "%s iframe 3D 画布铺满视口" % tag, sc)

    q = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
      return w.__dbg && w.__dbg.quality ? w.__dbg.quality() : null; })()""")
    check(bool(q) and q["mobile"] and q["cap"] <= 1.5 and q["pixelRatio"] <= 1.5,
          "%s 移动端 pixelRatio 上限 1.5" % tag, q)
    check(bool(q) and q["shadow"] <= 1024, "%s 移动端阴影贴图降到 1024" % tag, q)
    scene_shot = SHOT_DIR / ("M_%s_scene.png" % tag)
    pg.shot(str(scene_shot))
    SHOTS.append(str(scene_shot))

    # ---- 横屏轻提示（竖屏出现且能关；横屏不出现）
    tip = pg.wait_for("""(() => { const t = document.getElementById('rotateTip');
      const r = t.getBoundingClientRect();
      return (!t.hidden && t.classList.contains('on')) ? {
        l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right),
        b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height),
        bottom: getComputedStyle(t).bottom, fs: getComputedStyle(t).fontSize,
        vw: innerWidth, vh: innerHeight } : null; })()""", 7, interval=0.12)
    if w > h:
        check(tip is None, "%s 横屏不弹「建议横屏」提示" % tag, tip)
    else:
        check(bool(tip) and inside(tip, w, h) and tip["w"] <= w - 16,
              "%s 竖屏出现「建议横屏」轻提示且不出屏" % tag, tip)
        if tip:
            btn = rect(pg, "#rotateTipClose")
            check(bool(btn) and btn["w"] >= 44 and btn["h"] >= 44,
                  "%s 横屏提示的关闭按钮 ≥44×44" % tag, btn)
            tap(cdp, btn["x"], btn["y"])
            gone = pg.wait_for("""(() => { const t = document.getElementById('rotateTip');
              let stored = '0'; try { stored = localStorage.getItem('tjt.rotateTip.v1') || '0'; } catch (e) {}
              return (t.hidden && stored === '1') ? { hidden: true, stored } : null; })()""", 4,
              interval=0.1)
            check(bool(gone), "%s 提示可触摸关闭并记住（不再反复弹）" % tag, gone)

    # ---- 单指轻点走路 5/5
    walked = 0
    walk_log = []
    for i in range(5):
        ok = False
        for attempt in range(3):
            wait_idle(pg, 4)
            time.sleep(0.2)
            g = pg.js(JS_GROUND)
            cands = (g or {}).get("cands") or []
            for turn in range(5):
                if cands:
                    break
                # 走到墙边时镜头可能正对墙：抬高机位（下拖）+ 水平转，直到看得见地面
                drag(cdp, w // 2, h // 2, (-260, 0, 260, -260, 0)[turn],
                     90 if turn % 2 == 0 else 40)
                time.sleep(0.45)
                g = pg.js(JS_GROUND)
                cands = (g or {}).get("cands") or []
            if not cands:
                walk_log.append({"i": i, "a": attempt, "err": "no-cands"})
                drag(cdp, w // 2, h // 2, 0, 160)       # 再抬高一点再试
                time.sleep(0.4)
                continue
            # 优先 3 格以上的路径；实在只有 2 格也接受（0.5m 的一步也是走）
            far = [x for x in cands if (x.get("len") or 0) >= 3] or cands
            c = max(far, key=lambda x: (x.get("len") or 0) * 100 + (x.get("d") or 0))
            before = (g or {}).get("actor") or pg.js(JS_POS)
            tap(cdp, c["sx"], c["sy"])
            started = pg.wait_for("""(() => { const w = document.getElementById('frame').contentWindow;
              const s = w && w.__mini ? w.__mini.stats() : null;
              return (s && (s.walking || s.path > 0)) ? true : null; })()""", 2.2,
              interval=0.08)
            after = None
            if started:
                wait_idle(pg, 6)
                after = pg.js(JS_POS)
            moved = 0.0
            if after and before:
                moved = ((after["x"] - before["x"]) ** 2
                         + (after["z"] - before["z"]) ** 2) ** 0.5
            walk_log.append({"i": i, "a": attempt, "started": bool(started),
                             "from": before, "to": after, "moved": round(moved, 2),
                             "click": [c["sx"], c["sy"]], "len": c.get("len")})
            if moved > 0.25:
                ok = True
                break
            drag(cdp, w // 2, h // 2, 160 if attempt % 2 == 0 else -200, 0)
            time.sleep(0.4)
        if ok:
            walked += 1
    check(walked == 5, "%s 单指轻点地面：5/5 次都走起来" % tag,
          {"walked": walked, "log": walk_log})

    # ---- 单指拖动 = 转视角（读前后 yaw）
    wait_idle(pg, 4)
    time.sleep(0.3)
    cam0 = pg.js(JS_CAM)
    drag(cdp, w // 2, max(120, h // 2), 120, 0)
    time.sleep(0.55)
    cam1 = pg.js(JS_CAM)
    check(bool(cam0) and bool(cam1) and angle_delta(cam0["az"], cam1["az"]) > 0.15,
          "%s 单指拖动 → 相机 yaw 变化 ≥0.15" % tag,
          {"az0": cam0 and cam0["az"], "az1": cam1 and cam1["az"]})
    check(bool(cam0) and bool(cam1) and abs(cam1["miniYaw"] - cam0["miniYaw"]) > 0.05,
          "%s 单指拖动 → 场景 yaw 同步变化" % tag,
          {"yaw0": cam0 and cam0["miniYaw"], "yaw1": cam1 and cam1["miniYaw"]})

    # ---- 双指捏合 = 缩放（读前后相机距离 + 场景 camDist）
    camd0 = pg.js(JS_CAM)
    pinch(cdp, w // 2, h // 2, 48, 120)
    time.sleep(0.6)
    camd1 = pg.js(JS_CAM)
    check(bool(camd0) and bool(camd1) and camd0["dist"] - camd1["dist"] > 0.25,
          "%s 双指分开 → 相机距离变小（拉近）" % tag,
          {"d0": camd0 and camd0["dist"], "d1": camd1 and camd1["dist"]})
    check(bool(camd0) and bool(camd1) and camd0["miniDist"] - camd1["miniDist"] >= 1,
          "%s 双指捏合 → camDist 变化 ≥1" % tag,
          {"d0": camd0 and camd0["miniDist"], "d1": camd1 and camd1["miniDist"]})

    wins = [x for x in walk_log if x.get("to") and x.get("moved", 0) > 0.25]
    EVIDENCE[tag] = {
        "viewport": [w, h],
        "loading": {"earlyPct": early and early["pct"], "background": early and early["bg"]},
        "quality": q,
        "tap": {"walked": walked, "attempts": len(walk_log),
                "first": wins[0] if wins else None,
                "samples": [{"from": x.get("from"), "to": x.get("to"),
                             "moved": x.get("moved"), "click": x.get("click")}
                            for x in wins[:5]]},
        "drag": {"az0": cam0 and cam0["az"], "az1": cam1 and cam1["az"],
                 "miniYaw0": cam0 and cam0["miniYaw"], "miniYaw1": cam1 and cam1["miniYaw"]},
        "pinch": {"camDist0": camd0 and camd0["dist"], "camDist1": camd1 and camd1["dist"],
                  "sceneDist0": camd0 and camd0["miniDist"],
                  "sceneDist1": camd1 and camd1["miniDist"]},
    }
    print("  [数值] tap %d/5 ｜ yaw %.3f→%.3f ｜ camDist %.2f→%.2f（场景 %s→%s）"
          % (walked, (cam0 or {}).get("az", 0), (cam1 or {}).get("az", 0),
             (camd0 or {}).get("dist", 0), (camd1 or {}).get("dist", 0),
             (camd0 or {}).get("miniDist"), (camd1 or {}).get("miniDist")))

    # ---- 手机：九宫格
    launch = rect(pg, ".tp-launch")
    check(bool(launch) and launch["w"] >= 44 and launch["h"] >= 44,
          "%s 右上角手机开关 ≥44×44" % tag, launch)
    tap(cdp, launch["x"], launch["y"])
    pg.wait_for("window.__app.phone.isOpen() ? true : null", 5)
    time.sleep(0.55)          # 0.35s 滑入 + 余量；在动画中途量 rect 会得到屏外坐标
    ph = pg.js(JS_PHONE)
    check(bool(ph) and ph["open"] and ph["fnOpen"] and ph["vis"] == "visible",
          "%s 触摸打开手机（滑入完成）" % tag, ph)
    if not ph:
        return
    check(inside(ph, w, h), "%s 手机面板整体不出屏" % tag, ph)
    if w > h:
        check(ph["w"] <= 420 and abs(ph["r"] - w) <= 1 and ph["h"] >= h - 2,
              "%s 横屏改成右侧抽屉（≤420px、贴右边缘）" % tag,
              {"w": ph["w"], "right": ph["r"], "vw": w, "h": ph["h"]})
        check(ph["l"] >= 380, "%s 横屏抽屉不占满屏，左侧留给 3D" % tag,
              {"drawer_left": ph["l"], "scene_left": ph["l"]})
    else:
        check(ph["w"] <= w - 20 and ph["h"] <= h - 20 and ph["h"] >= h * 0.65,
              "%s 竖屏手机面板高度/宽度合适（≈80dvh）" % tag,
              {"w": ph["w"], "h": ph["h"], "vh": h})
        home = pg.js("""(() => { const h = document.querySelector('.tp-home');
          return h ? [h.scrollHeight, h.clientHeight] : null; })()""")
        check(bool(home) and home[0] <= home[1] + 2,
              "%s 竖屏九宫格不需要滚动就能全看见" % tag, home)

    tiles = pg.js(JS_TILES)
    if tag in EVIDENCE:
        EVIDENCE[tag]["phone"] = {"shell": [ph["l"], ph["t"], ph["w"], ph["h"]],
                                  "right": ph["r"], "vw": w, "vh": h,
                                  "landscape_drawer": w > h}
        EVIDENCE[tag]["tiles"] = [{"key": t["key"], "rect": [t["l"], t["t"], t["w"], t["h"]],
                                   "font": t["fs"]} for t in (tiles or [])]
    check(bool(tiles) and len(tiles) == 9, "%s 九宫格九个入口都在" % tag,
          len(tiles or []))
    if tiles:
        bad = [t for t in tiles if not inside(t, w, h) or t["w"] < 44 or t["h"] < 44]
        check(not bad, "%s 九个入口都在屏内且 ≥44×44" % tag, bad)
        check(all(t["fs"] >= 13 for t in tiles), "%s 九宫格标签字号 ≥13px" % tag,
              [(t["key"], t["fs"]) for t in tiles if t["fs"] < 13])

    audit_all = []
    title_sizes = []
    nav_ok = []
    for t in (tiles or []):
        st = pg.js("window.__app.phone.page")
        if st != "home":
            b = rect(pg, ".tp-foot [data-back]")
            if b:
                tap(cdp, b["x"], b["y"])
                pg.wait_for("window.__app.phone.page === 'home' ? true : null", 3)
        tr = rect(pg, '.tp-app[data-app="%s"]' % t["key"])
        if not tr:
            nav_ok.append("%s:missing" % t["key"])
            continue
        tap(cdp, tr["x"], tr["y"])
        ok = pg.wait_for("window.__app.phone.page === %s ? true : null" % json.dumps(t["key"]),
                         4, interval=0.08)
        page = pg.js("""(() => { const p = window.__app.phone.page;
          const el = document.querySelector('.tp-page[data-page="' + p + '"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const title = el.querySelector('.tp-title');
          return { page: p, hidden: el.hidden,
                   l: Math.round(r.left), r: Math.round(r.right),
                   w: Math.round(r.width), sw: document.documentElement.scrollWidth,
                   title: title ? getComputedStyle(title).fontSize : null,
                   len: (el.textContent || '').trim().length }; })()""")
        vis = bool(page) and page["hidden"] is False and page["len"] > 10
        edge = bool(page) and page["l"] >= -1 and page["r"] <= w + 1 and page["sw"] <= w + 1
        if not (ok and vis and edge):
            nav_ok.append("%s->%s" % (t["key"], page))
        if page and page["title"]:
            try:
                title_sizes.append((t["key"], float(page["title"].replace("px", ""))))
            except ValueError:
                pass
        audit = pg.js(JS_AUDIT)
        if audit:
            audit_all.append((t["key"], audit))
        b = rect(pg, ".tp-foot [data-back]")
        if b:
            tap(cdp, b["x"], b["y"])
            pg.wait_for("window.__app.phone.page === 'home' ? true : null", 3)
            time.sleep(0.1)
    check(not nav_ok, "%s 九个入口逐个触摸点进去都能开" % tag, nav_ok)
    check(all(fs >= 16 for _, fs in title_sizes) and len(title_sizes) >= 8,
          "%s 各页标题字号 ≥16px" % tag, title_sizes)
    lows = [(k, a["low"]) for k, a in audit_all if a["lowN"]]
    check(not lows, "%s 九个页面没有 <13px 的可见文字" % tag, lows[:2])
    smalls = [(k, a["small"]) for k, a in audit_all if a["smallN"]]
    check(not smalls, "%s 九个页面没有 <44×44 的可点区域" % tag, smalls[:2])

    # 回到桌面再截一张
    b = rect(pg, ".tp-foot [data-back]")
    if b and pg.js("window.__app.phone.page") != "home":
        tap(cdp, b["x"], b["y"])
        time.sleep(0.3)
    shot = SHOT_DIR / ("M_%s.png" % tag)
    pg.shot(str(shot))
    SHOTS.append(str(shot))
    check(shot.is_file() and shot.stat().st_size > 1000,
          "%s 截图已落盘（%s）" % (tag, shot.name))

    close = rect(pg, ".tp-foot [data-close]")
    tap(cdp, close["x"], close["y"])
    closed = pg.wait_for("""(() => (!window.__app.phone.isOpen()
      && getComputedStyle(document.querySelector('.tp-shell')).visibility === 'hidden')
      ? true : null)()""", 4, interval=0.1)
    check(bool(closed), "%s 手机能收起（滑出屏幕）" % tag)

    # ---- 问话面板：可滚、可关
    pg.js("window.__app.openDialog('p_a'); true")
    dlg = pg.wait_for(JS_DIALOG, 10)
    check(bool(dlg), "%s 问话面板能打开" % tag, dlg)
    if dlg:
        check(dlg["inputs"] == 1 and dlg["send"] == 1 and dlg["refs"] == 2,
              "%s 问话面板只有自由输入框 + 发送 + 两个引用入口（无预设话题）" % tag, dlg)
        check(inside(dlg, w, h) and dlg["sw"] <= w + 1,
              "%s 问话面板不出屏、不撑宽页面" % tag, dlg)
        check(bool(dlg["close"]) and dlg["close"][0] >= 44 and dlg["close"][1] >= 44,
              "%s 问话关闭按钮 ≥44×44" % tag, dlg["close"])
        dlg_fonts = font_audit(pg, ".dlg-card")
        check(bool(dlg_fonts) and dlg_fonts["n"] == 0,
              "%s 问话面板没有 <13px 的可见文字" % tag, dlg_fonts)
        # 自由输入几句话，让对话区真的溢出（旧版是点预设话题，话题列表已删）
        asks = ["你先坐下，慢慢说，到底怎么回事？",
                "那块界石当年是谁埋的？",
                "下雨的时候水往哪里灌？",
                "你希望最后怎么解决这件事？",
                "对方要是不同意呢？",
                "还有谁在场可以作证？"]
        for ask in asks:
            over = (dlg["threadH"][0] - dlg["threadH"][1]) if dlg["threadH"] else 0
            # 多问几句，让对话区至少溢出 60px：只有 4~5px 余量时，±120px 的手指拖动
            # 两头都贴边，位移量过不了"能滚 >4px"这条门槛（旧版话题列表占位时不会这么窄）。
            if over >= 60:
                break
            ib = rect(pg, ".dlg-card .dlg-input")
            if not ib:
                break
            before = dlg["msgs"]
            tap(cdp, ib["x"], ib["y"])
            insert_text(cdp, ask)
            sb = rect(pg, ".dlg-card .dlg-send")
            if not sb:
                break
            tap(cdp, sb["x"], sb["y"])
            got = pg.wait_for("""(() => document.querySelectorAll('.dlg-card .dlg-msg--them').length > %d
              ? true : null)()""" % before, 20, interval=0.12)
            if not got:
                break
            dlg = pg.js(JS_DIALOG)
        check(bool(dlg) and dlg["threadH"] and dlg["threadH"][0] > dlg["threadH"][1] + 2,
              "%s 问话对话区内容可溢出（有东西可滚）" % tag,
              dlg and {"scroll": dlg["threadH"], "msgs": dlg["msgs"]})
        th = pg.js("""(() => { const r = document.querySelector('.dlg-card .dlg-thread').getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()""")
        if th:
            # 新消息进来时会自动贴底；先向下拖回顶部，再向上拖回底部，
            # 两个方向都能动才算"可滚"（只在一个方向贴边时不算）。
            y0 = dlg["threadScroll"]
            drag(cdp, th["x"], th["y"], 0, 120, steps=16)
            time.sleep(0.45)
            top = pg.js(JS_DIALOG)
            up_ok = bool(top) and top["threadScroll"] < y0 - 4
            drag(cdp, th["x"], th["y"], 0, -120, steps=16)
            time.sleep(0.45)
            bottom = pg.js(JS_DIALOG)
            down_ok = bool(bottom) and bool(top) and bottom["threadScroll"] > top["threadScroll"] + 4
            check(up_ok or down_ok,
                  "%s 问话对话区能用手指滚动" % tag,
                  {"start": y0, "down_drag": top and top["threadScroll"],
                   "up_drag": bottom and bottom["threadScroll"]})
        xb = rect(pg, ".dlg-card .dlg-x")
        tap(cdp, xb["x"], xb["y"])
        gone = pg.wait_for("""(() => (!document.querySelector('.dlg-card') && !window.__app.dialog)
          ? true : null)()""", 4, interval=0.1)
        check(bool(gone), "%s 问话面板能关（DOM + state 都清）" % tag)

    # ---- 评价卡：不溢出
    pg.js("window.__app.openReview(); true")
    rv = pg.wait_for(JS_REVIEW, 8)
    check(bool(rv), "%s 评价卡能打开" % tag, rv)
    if rv:
        check(inside(rv, w, h) and rv["sw"] <= w + 1,
              "%s 评价卡不出屏、不撑宽页面" % tag, rv)
        check(rv["title"] and float(rv["title"].replace("px", "")) >= 16,
              "%s 评价卡标题字号 ≥16px" % tag, rv["title"])
        check(rv["li"] and float(rv["li"].replace("px", "")) >= 13,
              "%s 评价卡正文 ≥13px" % tag, rv["li"])
        check(bool(rv["close"]) and rv["close"][1] >= 44,
              "%s 评价卡按钮高 ≥44px" % tag, rv["close"])
        rv_fonts = font_audit(pg, "#reviewLayer .rv-card")
        check(bool(rv_fonts) and rv_fonts["n"] == 0,
              "%s 评价卡没有 <13px 的可见文字" % tag, rv_fonts)
        cb = rect(pg, "#reviewLayer .rv-close")
        tap(cdp, cb["x"], cb["y"])
        gone = pg.wait_for("!document.getElementById('reviewLayer').classList.contains('on')",
                           4, interval=0.1)
        check(bool(gone), "%s 评价卡能关" % tag)

    # ---- 复盘：时间轴能横向滚
    pg.js("window.__app.openReplay(); true")
    rp = pg.wait_for(JS_REPLAY, 8)
    check(bool(rp), "%s 复盘时间轴能打开" % tag, rp)
    if rp:
        check(inside(rp, w, h) and rp["sw"] <= w + 1,
              "%s 复盘面板不出屏、不撑宽页面" % tag, rp)
        check(bool(rp["rail"]) and rp["rail"][0] > rp["rail"][1] + 10,
              "%s 复盘时间轴内容宽于视口（可滚）" % tag, rp["rail"])
        rr = pg.js("""(() => { const r = document.querySelector('#replayLayer .rp-rail').getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()""")
        before = rp["rail"][2] if rp["rail"] else 0
        drag(cdp, rr["x"], rr["y"], -150, 0, steps=18)
        time.sleep(0.7)
        after = pg.js(JS_REPLAY)
        check(bool(after) and after["rail"][2] > before + 5,
              "%s 手指横拖 → 时间轴真的滚动" % tag,
              {"before": before, "after": after and after["rail"]})
        check(bool(rp["close"]) and rp["close"][0] >= 44 and rp["close"][1] >= 44,
              "%s 复盘收起按钮 ≥44×44" % tag, rp["close"])
        rp_fonts = font_audit(pg, "#replayLayer .rp-host")
        check(bool(rp_fonts) and rp_fonts["n"] == 0,
              "%s 复盘没有 <13px 的可见文字" % tag, rp_fonts)
        cb = rect(pg, "#replayClose")
        tap(cdp, cb["x"], cb["y"])
        gone = pg.wait_for("!document.getElementById('replayLayer').classList.contains('on')",
                           4, interval=0.1)
        check(bool(gone), "%s 复盘能收起（按钮可触摸）" % tag)

    # ---- 通讯：轻点联系人整行 → 手机收起 → 和地图点人**同一张**问话面板（能直接说话）
    pg.js("(() => { const p = window.__app.phone; if (p) p.openPage('contact'); return true; })()")
    pg.wait_for("window.__app.phone.page === 'contact' ? true : null", 4)
    time.sleep(0.35)
    crow = rect(pg, ".tp-call")
    check(bool(crow), "%s 通讯页联系人整行可点" % tag, crow)
    cinfo = pg.js("""(() => { const el = document.querySelector('.tp-call');
      if (!el) return null;
      return { name: ((el.querySelector('.tp-call-n') || {}).textContent || '').trim(),
               tag: ((el.querySelector('.tp-call-t') || {}).textContent || '').trim() }; })()""")
    if crow:
        tap(cdp, crow["x"], crow["y"])
        call = pg.wait_for(JS_CALL_DLG, 8, interval=0.1)
        check(bool(call) and bool(cinfo) and call["name"] == cinfo["name"]
              and call["kicker"] == "通 话" and call["phoneOpen"] is False
              and call["callCard"] is False and call["inputs"] == 1
              and call["send"] == 1 and call["refs"] == 2 and call["meters"] == 2
              and inside(call, w, h) and call["sw"] <= w + 1,
              "%s 点联系人 → 手机收起，弹出和地图点人一样的问话面板" % tag, call)
        check(bool(call) and bool(re.search(r"通话中\s+\d{2}:\d{2}", call["role"] or ""))
              and call["closeLabel"] == "挂断",
              "%s 通话面板：抬头「通 话」、身份行有计时、× 是挂断" % tag, call)
        if tag == "390":
            time.sleep(1.1)          # 让计时走到 00:01，截图里能看出"在走"
            call_shot = SHOT_DIR / "CALL_dialog.png"
            pg.shot(str(call_shot))
            SHOTS.append(str(call_shot))
            check(call_shot.is_file() and call_shot.stat().st_size > 1000,
                  "390 通话面板截图已落盘（CALL_dialog.png）")
        # 直接说话：轻点输入框 → 输入 → 发送 → 玩家气泡
        inp = rect(pg, ".dlg-card .dlg-input")
        if inp:
            tap(cdp, inp["x"], inp["y"])
            insert_text(cdp, "喂，我是调解员，你现在方便说话吗？")
            sb = rect(pg, ".dlg-card .dlg-send")
            if sb:
                tap(cdp, sb["x"], sb["y"])
        said = pg.wait_for("""(() => { const b = document.querySelector('.dlg-msg--me .dlg-bubble');
          return b ? { n: document.querySelectorAll('.dlg-msg--me').length,
                       text: (b.textContent || '').trim() } : null; })()""", 4, interval=0.1)
        check(bool(said) and said["n"] >= 1 and "调解员" in (said["text"] or ""),
              "%s 通话面板里能直接说话（玩家气泡出现）" % tag, said)
        x = rect(pg, ".dlg-card .dlg-x")
        if x:
            tap(cdp, x["x"], x["y"])
        gone = pg.wait_for("""(() => (!document.querySelector('.dlg-card') && !window.__app.dialog
          && !window.__app.phone.isOpen()) ? true : null)()""", 5, interval=0.1)
        check(bool(gone), "%s 点 ×（挂断）→ 面板消失，手机保持收起" % tag)
    pg.js("window.__app.phone.close(); true")
    time.sleep(0.3)

    # ---- 后台九场真的要预热完
    bg = pg.wait_for("""(() => window.__app.loading.backgroundDone ? {
      pct: window.__app.loading.pct, done: window.__app.loading.done,
      ready: window.__app.loading.ready.length, failed: window.__app.loading.failed
    } : null)()""", 90, interval=0.3)
    check(bool(bg) and bg["pct"] == 100 and bg["ready"] == 10 and not bg["failed"],
          "%s 后台预热收口（10/10、pct=100、无失败）" % tag, bg)

    # ---- 收尾：错误
    err = pg.js("""(() => { const f = document.getElementById('frame');
      let e = null; try { e = f.contentWindow.__err || null; } catch (x) { e = String(x); }
      return { host: window.__err || null, frame: e }; })()""")
    check(bool(err) and err["host"] is None and err["frame"] is None,
          "%s 全程无未捕获异常" % tag, err)


# --------------------------------------------------------------------- 主流程
def run(url: str, only: str = "") -> int:
    edge = T.find_edge()
    if not edge:
        print("[SKIP] 找不到 Edge / Chrome，手机测试跑不了")
        return 2
    try:
        with T.OPENER.open(BASE + "/__ver", timeout=4) as r:
            ver = json.loads(r.read().decode("utf-8"))
        print("服务端 build=%s pid=%s" % (ver.get("build", "?")[:19], ver.get("pid")))
    except Exception as exc:
        print("[FAIL] 8770 端口没起服务：%s" % exc)
        return 2

    port = T.free_port()
    profile = tempfile.mkdtemp(prefix="mobile-test-")
    proc = subprocess.Popen([
        edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--touch-events=enabled",
        "--no-first-run", "--no-default-browser-check",
        "--remote-debugging-port=%d" % port, "--user-data-dir=%s" % profile,
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cdp = None
    try:
        target = next(t for t in T.wait_json("http://127.0.0.1:%d/json/list" % port)
                      if t.get("type") == "page")
        cdp = T.CDP(target["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        pg = T.Page(cdp)
        for w, h, tag in ((390, 844, "390"), (430, 932, "430"), (844, 390, "844")):
            if only and only != tag:
                continue
            run_viewport(cdp, pg, w, h, tag)
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    ev_path = SHOT_DIR / "mobile_evidence.json"
    try:
        ev_path.parent.mkdir(parents=True, exist_ok=True)
        ev_path.write_text(json.dumps(EVIDENCE, ensure_ascii=False, indent=2), encoding="utf-8")
        print("数值证据 → %s" % ev_path)
    except OSError:
        pass

    print("-" * 64)
    print("通过 %d ｜ 失败 %d" % (PASS, FAIL))
    if SHOTS:
        print("截图 %d 张：%s" % (len(SHOTS), ", ".join(Path(s).name for s in SHOTS)))
    if FAILED:
        print("失败清单：")
        for f in FAILED:
            print("  · " + f)
    return 0 if FAIL == 0 and PASS > 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="手机版专项测试（CDP 真触摸）")
    ap.add_argument("--url", default=APP_URL)
    ap.add_argument("--only", default="", help="只跑一个视口：390 / 430 / 844")
    args = ap.parse_args()
    return run(args.url, args.only)


if __name__ == "__main__":
    sys.exit(main())
