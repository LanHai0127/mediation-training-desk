# -*- coding: utf-8 -*-
"""14 条通关清单的真实鼠标/键盘实测（第 14 条是十场逐场遍历）。

不往 contentDocument 派假事件：所有点击、拖动、滚轮、打字都走 CDP Input。
"""
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]      # tools/ 的上一级 = 项目根
sys.path.insert(0, str(ROOT / "tools"))
from test_app import CDP, Page, find_edge, free_port, wait_json  # noqa: E402

URL = "http://127.0.0.1:8770/static/app.html"
LOGS = ROOT / "tools" / "_logs"

RESULTS: list[tuple[str, bool, str]] = []
SHOTS: list[str] = []


def ok(cid, cond, msg, detail=""):
    RESULTS.append((cid, bool(cond), msg))
    print(("[PASS] " if cond else "[FAIL] ") + cid + " " + msg
          + (("   ← " + str(detail)) if (detail and not cond) else ""), flush=True)
    return bool(cond)


def info(msg):
    print("       · " + msg, flush=True)


# ------------------------------------------------------------------ 输入
def move(cdp, x, y):
    cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})


def click(cdp, x, y, settle=0.14):
    x, y = int(round(x)), int(round(y))
    move(cdp, x, y)
    time.sleep(0.05)
    cdp.call("Input.dispatchMouseEvent", {
        "type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1,
        "pointerType": "mouse"})
    time.sleep(0.07)
    cdp.call("Input.dispatchMouseEvent", {
        "type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1,
        "pointerType": "mouse"})
    time.sleep(settle)


def drag(cdp, x0, y0, dx, dy, steps=14, hold=0.035):
    x0, y0 = int(x0), int(y0)
    move(cdp, x0, y0)
    time.sleep(0.05)
    cdp.call("Input.dispatchMouseEvent", {
        "type": "mousePressed", "x": x0, "y": y0, "button": "left", "clickCount": 1,
        "pointerType": "mouse"})
    time.sleep(hold)
    for i in range(1, steps + 1):
        cdp.call("Input.dispatchMouseEvent", {
            "type": "mouseMoved", "x": round(x0 + dx * i / steps),
            "y": round(y0 + dy * i / steps), "button": "left", "buttons": 1,
            "pointerType": "mouse"})
        time.sleep(hold)
    cdp.call("Input.dispatchMouseEvent", {
        "type": "mouseReleased", "x": round(x0 + dx), "y": round(y0 + dy),
        "button": "left", "clickCount": 1, "pointerType": "mouse"})
    time.sleep(0.25)


def wheel(cdp, x, y, delta):
    move(cdp, int(x), int(y))
    time.sleep(0.04)
    cdp.call("Input.dispatchMouseEvent", {
        "type": "mouseWheel", "x": int(x), "y": int(y), "deltaX": 0, "deltaY": delta,
        "pointerType": "mouse"})
    time.sleep(0.2)


def typing(cdp, text):
    for ch in text:
        cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "text": ch, "key": ch,
                                            "unmodifiedText": ch})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": ch})
        time.sleep(0.015)


def insert_text(cdp, text):
    """输入框里的中文：走 CDP 的 insertText（等价于输入法上屏，仍是真实输入事件）。"""
    cdp.call("Input.insertText", {"text": text})
    time.sleep(0.15)


def shot(pg, name):
    p = LOGS / ("QA_%s.png" % name)
    try:
        pg.shot(str(p))
        SHOTS.append(str(p))
        info("截图 " + p.name)
    except Exception as exc:  # noqa: BLE001
        info("截图失败 %s：%s" % (name, exc))


def poll(pg, expr, timeout=10.0, interval=0.12):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = pg.js(expr)
        except RuntimeError:
            v = None
        if v:
            return v
        time.sleep(interval)
    return None


def phone_home(cdp, pg):
    """保证手机是「打开 + 停在桌面」，后面才点得到九宫格。"""
    st = pg.js("({ open: window.__app.phone.isOpen(), page: window.__app.phone.page })")
    if not st or not st["open"]:
        l = rect(pg, ".tp-launch")
        if l:
            click(cdp, l["x"], l["y"], settle=0.5)
        st = pg.js("({ open: window.__app.phone.isOpen(), page: window.__app.phone.page })")
    if st and st["open"] and st["page"] != "home":
        b = rect(pg, ".tp-foot [data-back]")
        if b:
            click(cdp, b["x"], b["y"], settle=0.35)
    return pg.js("({ open: window.__app.phone.isOpen(), page: window.__app.phone.page })")


def phone_close(cdp, pg):
    if pg.js("window.__app.phone.isOpen()"):
        b = rect(pg, ".tp-foot [data-close]")
        if b:
            click(cdp, b["x"], b["y"], settle=0.55)
        else:
            pg.js("window.__app.phone.close(); true")
            time.sleep(0.55)


def fresh_target(pg, kind, ids=None, min_dist=0.0):
    """现算现点：相机在跟随补间里还在动，投影必须用最新一帧。
    min_dist：离主角太近的物件不选 —— 场景的 walkTo 在"已经站在交互点旁边"时
    会返回 false（路径不足 2 格），点了不会有反应，那属于另一个边界情况。"""
    tg = pg.js(JS_TARGETS)
    if not tg:
        return None
    want = "person" if kind == "people" else "prop"
    actor = tg.get("actor") or [0, 0]
    items = tg.get(kind, [])
    if ids:
        order = {k: i for i, k in enumerate(ids)}
        items = sorted([x for x in items if x["id"] in order],
                       key=lambda x: order[x["id"]])
    for p in items:
        f = p["first"] or {}
        if f.get("kind") != want or f.get("id") != p["id"]:
            continue
        c = p.get("center") or [0, 0, 0]
        if min_dist and ((c[0] - actor[0]) ** 2 + (c[2] - actor[1]) ** 2) ** 0.5 < min_dist:
            continue
        return p
    return None


def rect(pg, sel):
    return pg.js("""(() => { const el = document.querySelector(%s);
      if (!el) return null; const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
               l: Math.round(r.left), t: Math.round(r.top),
               w: Math.round(r.width), h: Math.round(r.height),
               vis: getComputedStyle(el).visibility, op: getComputedStyle(el).opacity,
               dis: !!el.disabled }; })()""" % json.dumps(sel))


# ------------------------------------------------------------------ JS
JS_STATE = """(() => {
  const f = document.getElementById('frame');
  const a = window.__app;
  let mini = null, err = null, camY = null;
  try {
    const w = f.contentWindow;
    if (w && w.__mini) {
      mini = { actor: w.__mini.actorPos(), stats: w.__mini.stats() };
      camY = +w.__dbg.camera.position.y.toFixed(2);
    }
    err = w ? (w.__err || null) : null;
  } catch (e) { err = String(e); }
  return { mode: a.state.mode, sceneId: a.state.sceneId, started: a.state.started,
           cam: a.state.cam, mini, err, camY, errHost: window.__err || null,
           frameOn: f.classList.contains('on'),
           frameOp: getComputedStyle(f).opacity,
           stageVis: getComputedStyle(document.getElementById('stage')).visibility,
           seen: [...a.state.seen], nodes: a.state.nodes.length,
           trans: a.flight.transition };
})()"""

JS_TARGETS = """(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__dbg) return null;
  const T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
  const rc = new T.Raycaster();
  const W = innerWidth, H = innerHeight;
  const proj = (v) => { const p = v.clone().project(cam);
    return [Math.round((p.x * .5 + .5) * W), Math.round((-p.y * .5 + .5) * H), +p.z.toFixed(3)]; };
  const firstHit = (pt) => {
    if (pt[0] < 4 || pt[0] > W - 4 || pt[1] < 4 || pt[1] > H - 4) return { kind: 'off' };
    const ndc = new T.Vector2((pt[0] / W) * 2 - 1, -(pt[1] / H) * 2 + 1);
    rc.setFromCamera(ndc, cam);
    const hs = rc.intersectObjects(sc.children, true);
    // 场景自己的 pickAt 只对 pickable（有 personId/propId 的）做射线：
    // 墙、地面、底座都不挡点击，所以这里也只看"可拾取对象"里的第一个
    for (const h of hs) {
      const u = h.object.userData || {};
      // 姓名牌也是可点的"人"（scene3d 里牌子上挂的是 nameplateFor，不是 personId）
      if (u.nameplateFor) {
        return { id: u.nameplateFor, kind: 'person', d: +h.distance.toFixed(2), occludedBy: null };
      }
      if (u.personId || u.propId) {
        return { id: u.personId || u.propId,
                 kind: u.personId ? 'person' : 'prop',
                 d: +h.distance.toFixed(2),
                 occludedBy: (hs[0].object.userData || {}).personId
                   || (hs[0].object.userData || {}).propId ? null : 'scene' };
      }
    }
    return hs.length ? { id: null, kind: 'other', d: +hs[0].distance.toFixed(2) } : null;
  };
  const byPerson = new Map(), byProp = new Map();
  const box = new T.Box3(), tmp = new T.Vector3();
  sc.traverse((o) => {
    const u = o.userData || {};
    if (!u.personId && !u.propId) return;
    const key = u.personId || u.propId;
    const m = u.personId ? byPerson : byProp;
    if (!m.has(key)) m.set(key, new T.Box3());
    box.setFromObject(o);
    if (!box.isEmpty()) m.get(key).union(box);
  });
  const out = (m, kind) => {
    const arr = [];
    for (const [id, b] of m) {
      b.getCenter(tmp);
      const pt = proj(tmp);
      arr.push({ id, pt, first: firstHit(pt), center: [+tmp.x.toFixed(2), +tmp.y.toFixed(2), +tmp.z.toFixed(2)] });
    }
    return arr;
  };
  return { people: out(byPerson, 'person'), props: out(byProp, 'prop'),
           actor: (() => { const a = w.__mini.actorPos();
                           return [+a.x.toFixed(2), +a.z.toFixed(2)]; })(),
           cam: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)] };
})()"""

# 某个人物姓名牌的屏幕坐标（折中方案的第二条通道：点牌 = 原地直接开口）
JS_PLATE_AT = """(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__dbg) return null;
  const T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
  const pid = %s;
  let plate = null;
  sc.traverse((o) => {
    if (!plate && o.isSprite && o.userData && o.userData.nameplateFor === pid) plate = o;
  });
  if (!plate) return null;
  const v = new T.Vector3(); plate.getWorldPosition(v);
  const p = v.clone().project(cam);
  const W = innerWidth, H = innerHeight;
  const x = Math.round((p.x * .5 + .5) * W), y = Math.round((-p.y * .5 + .5) * H);
  return { x: x, y: y, inView: p.z < 1 && x > 8 && x < W - 8 && y > 8 && y < H - 8 };
})()"""

JS_GROUND = """(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__dbg || !w.__mini) return null;
  const T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
  const a = w.__mini.actorPos();
  const rc = new T.Raycaster();
  const W = innerWidth, H = innerHeight;
  const dir = new T.Vector3(a.x - cam.position.x, 0, a.z - cam.position.z);
  if (dir.length() < 0.01) dir.set(0, 0, 1);
  dir.normalize();
  const cands = [];
  for (const dist of [2.4, 3.2, 4.0, 4.8, 5.6, 1.8]) {
    for (const ang of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) {
      const c = Math.cos(ang), s = Math.sin(ang);
      const dx = dir.x * c - dir.z * s, dz = dir.x * s + dir.z * c;
      const x = a.x + dx * dist, z = a.z + dz * dist;
      const p = w.__mini.debugPath(x, z);
      if (!p || p.len < 2) continue;
      const v = new T.Vector3(x, 0, z).project(cam);
      const sx = Math.round((v.x * .5 + .5) * W), sy = Math.round((-v.y * .5 + .5) * H);
      if (sx < 60 || sx > W - 60 || sy < 120 || sy > H - 70) continue;
      const ndc = new T.Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
      rc.setFromCamera(ndc, cam);
      const hs = rc.intersectObjects(sc.children, true);
      // 这一像素上必须"没有任何真正可点的物件/人"才算纯地面。
      // 规则和外壳的 pickTargetAt 完全一致：跳过地面/路面（又平又大），
      // 只看剩下的第一个带 personId / propId 的命中。
      let identified = false;
      for (const h of hs) {
        const u = h.object.userData || {};
        if (u.personId || u.nameplateFor) { identified = true; break; }
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
      cands.push({ sx, sy, x: +x.toFixed(2), z: +z.toFixed(2), len: p.len, dist });
      if (cands.length >= 3) break;
    }
    if (cands.length >= 3) break;
  }
  return { actor: a, cands, cam: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2),
                                  +cam.position.z.toFixed(2)] };
})()"""

# 地面候选统一用上面这一份：取 1.8~5.6 米、要求至少 2 格路径。
# 场景的 walkTo 在"路径不足 2 格"时会静默返回 false；1 格候选点下去看着像
# "点了没反应"（5.1 曾因此出现过 3/5 的假红）。十场遍历直接复用同一份。
JS_GROUND_TOUR = JS_GROUND

JS_LOAD = """(() => {
  const a = window.__app;
  const dots = document.querySelectorAll('#loadDots b');
  let okN = 0; dots.forEach((d) => { if (d.classList.contains('ok')) okN += 1; });
  const c = document.getElementById('loadCloud');
  let hash = 0, painted = 0;
  try {
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 1600) { hash = (hash * 31 + d[i] + d[i + 3]) % 2147483647; }
    for (let i = 3; i < d.length; i += 4000) { if (d[i] > 0) painted += 1; }
  } catch (e) { hash = -1; }
  let camY = null;
  try {
    const w = document.getElementById('frame').contentWindow;
    if (w && w.__dbg) camY = +w.__dbg.camera.position.y.toFixed(2);
  } catch (e) { camY = null; }
  return { pct: a.loading.pct, done: a.loading.done, started: a.state.started,
           dots: dots.length, ok: okN, hash, painted, camY,
           on: document.getElementById('load').classList.contains('on'),
           hidden: document.getElementById('load').hidden,
           fill: document.getElementById('loadFill').style.width };
})()"""


# ------------------------------------------------------------------ 步骤
def boot(cdp, pg):
    pg.viewport(1440, 900)
    cdp.call("Page.navigate", {"url": URL})
    if not pg.wait_for("!!(window.__app && window.__app.boot && window.__app.phone)", 30):
        ok("S0", False, "页面 30s 没起来")
        return False
    time.sleep(1.4)
    return True


def s1_first_screen(cdp, pg):
    print("\n=== 1 首屏 ===", flush=True)
    st = pg.js("""(() => { const a = window.__app; const b = document.querySelector('.tp-launch');
      const cs = b ? getComputedStyle(b) : null;
      return { boards: a.boot.layout(), mode: a.state.mode, gate: !!document.getElementById('gate'),
               launch: cs ? { vis: cs.visibility, op: cs.opacity, pe: cs.pointerEvents,
                              r: b.getBoundingClientRect().toJSON() } : null,
               err: window.__err || null }; })()""")
    ok("1.1", len(st["boards"]) == 1 and st["boards"][0]["id"] == "start",
       "首屏只有一块「开始调解」板", st["boards"])
    ok("1.2", st["launch"] and st["launch"]["vis"] == "hidden" and st["launch"]["op"] == "0"
       and st["launch"]["pe"] == "none", "右上角手机图标首屏不可见", st["launch"])
    yaw0 = pg.js("""(() => { const T = window.__dbg.THREE; const v = new T.Vector3();
      window.__app.camera.getWorldDirection(v); return +Math.atan2(v.x, v.z).toFixed(4); })()""")
    move(cdp, 80, 430)
    time.sleep(0.15)
    move(cdp, 1380, 500)
    time.sleep(1.2)
    yaw1 = pg.js("""(() => { const T = window.__dbg.THREE; const v = new T.Vector3();
      window.__app.camera.getWorldDirection(v); return +Math.atan2(v.x, v.z).toFixed(4); })()""")
    prog = pg.js("window.__app.boot.progress")
    ok("1.3", abs((yaw1 or 0) - (yaw0 or 0)) >= 0.1,
       "鼠标移动 → 相机视差（yaw 变化 ≥0.1）", {"yaw0": yaw0, "yaw1": yaw1})
    ok("1.4", prog and abs(prog["yaw"]) >= 0.05,
       "鼠标移动 → 看板本体也偏转（boot.progress.yaw）", prog)
    shot(pg, "01_board")


def s2_start(cdp, pg):
    print("\n=== 2 点开始 → 加载页 ===", flush=True)
    pt = pg.js("""(() => { const T = window.__dbg.THREE;
      const b = window.__app.boot.layout()[0];
      const v = new T.Vector3(b.x, b.y, b.z).project(window.__app.camera);
      return [Math.round((v.x * .5 + .5) * innerWidth),
              Math.round((-v.y * .5 + .5) * innerHeight)]; })()""")
    move(cdp, 720, 450)
    time.sleep(0.8)
    pt = pg.js("""(() => { const T = window.__dbg.THREE;
      const b = window.__app.boot.layout()[0];
      const v = new T.Vector3(b.x, b.y, b.z).project(window.__app.camera);
      return [Math.round((v.x * .5 + .5) * innerWidth),
              Math.round((-v.y * .5 + .5) * innerHeight)]; })()""")
    click(cdp, pt[0], pt[1], settle=0.55)
    st = pg.js("""({ loadOn: document.getElementById('load').classList.contains('on'),
      loadHidden: document.getElementById('load').hidden,
      started: window.__app.state.started, gate: !!document.getElementById('gate'),
      pwd: document.querySelectorAll('input[type="password"]').length,
      gateState: 'gate' in window.__app.state,
      pct: window.__app.loading.pct,
      text: (document.getElementById('loadCur').textContent || '').trim() })""")
    ok("2.1", st and st["loadOn"] and not st["loadHidden"] and not st["started"],
       "真实点击板面 → 直接进加载页（未进场景）", st)
    ok("2.2", st and not st["gate"] and st["pwd"] == 0 and not st["gateState"],
       "没有密码门（无 gate DOM / 无密码输入框 / 无 gate 状态）", st)
    ok("2.3", st and st["text"], "加载页有当前场景文案", st and st["text"])
    shot(pg, "02_loading")


def s3_loading(cdp, pg):
    print("\n=== 3 加载页 ===", flush=True)
    a = pg.js(JS_LOAD)
    time.sleep(1.4)
    b = pg.js(JS_LOAD)
    ok("3.1", a and b and a["hash"] != b["hash"] and a["hash"] > 0,
       "云背景在动（两次采样像素哈希不同）",
       {"a": a and a["hash"], "b": b and b["hash"]})
    ok("3.2", a and b and (b["pct"] > a["pct"] or b["ok"] > a["ok"]),
       "进度条推进（pct 或亮点数增加）", {"a": [a and a["pct"], a and a["ok"]],
                                        "b": [b and b["pct"], b and b["ok"]]})
    ok("3.3", a and a["dots"] == 10, "十个圆点都在（10 个）", a and a["dots"])

    series = []
    t0 = time.time()
    started_at = None
    while time.time() - t0 < 60:
        s = pg.js(JS_LOAD)
        series.append(s)
        if s and s["started"]:
            started_at = s
            break
        time.sleep(0.25)
    oks = [s["ok"] for s in series if s]
    mono = all(oks[i] <= oks[i + 1] for i in range(len(oks) - 1))
    ok("3.4", mono and oks and max(oks) == 10,
       "十个圆点逐个亮（单调递增到 10）", oks)
    early = [s for s in series if s and s["pct"] < 100 and s["started"]]
    ok("3.5", not early, "100% 之前不进场景", early[:2])
    ok("3.6", started_at is not None and started_at["pct"] >= 100,
       "100% 之后才进场景", started_at and started_at["pct"])
    # 进度条 DOM 宽度真的跟着 pct
    fill = [s["fill"] for s in series if s]
    ok("3.7", len(set(fill)) >= 3, "进度条宽度在变（≥3 个不同值）", fill[:6])
    shot(pg, "03_loading_mid")
    return series


def s4_transition(cdp, pg, series):
    print("\n=== 4 转场（云散 → 下移 → 落位）===", flush=True)
    # 下移发生在「pct 满 100 → started 变 true」之间：从加载页的采样里取相机高度
    ys = [(i, s["camY"], s["pct"], s["started"]) for i, s in enumerate(series or [])
          if s and s.get("camY") is not None]
    high = max([y for (_, y, _, _) in ys] or [0])
    low = min([y for (_, y, _, _) in ys] or [99])
    ok("4.1", high >= 14.0 and low <= 10.0,
       "云散后相机从高位下移到常规位（相机 y 从高位降到低位）",
       {"ys": ys[:18], "high": high, "low": low})
    ok("4.2", any(s for (_, _, _, s) in ys),
       "下移过程中/之后进入场景（started）", ys[:6])
    time.sleep(1.2)
    st = pg.js(JS_STATE)
    ok("4.3", st["frameOn"] and float(st["frameOp"]) > 0.95 and st["stageVis"] == "hidden",
       "落位后场景可见（iframe on / opacity 1 / 看板层让开）", st)
    ok("4.4", st["mode"] == "FOLLOW" and st["sceneId"] == "duty",
       "落位后进入 FOLLOW 且场景是 duty", {"mode": st["mode"], "sceneId": st["sceneId"]})
    ok("4.5", st["err"] is None and st["errHost"] is None,
       "转场结束无异常", {"iframe": st["err"], "host": st["errHost"]})
    shot(pg, "04_scene_duty")
    return st


def s5_freeview(cdp, pg):
    print("\n=== 5 自由视角（各 5 次）===", flush=True)
    # ---- 5A 点地面走人
    # 用与十场遍历同一套 ground_walk：点一次不动的偶发（上一段走位/转场余波）
    # 会在同一次"点地面"里换候选点重试；断言仍看 5 次里成功走了几次。
    hitn = 0
    details = []
    for i in range(5):
        got = ground_walk(cdp, pg, tries=2)
        if got:
            hitn += 1
            wait_idle(pg, 3.0)
            details.append({"click": got.get("click"), "moved": got})
        else:
            details.append({"click": None, "moved": None, "miss": i + 1})
    ok("5.1", hitn == 5, "点地面 → 主角走动（5/5）", {"hit": hitn, "details": details})

    # ---- 5B 按住拖动 → yaw
    hitn = 0
    details = []
    for i in range(5):
        before = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          const a = window.__app; const c = a.camera;
          const T = window.__dbg.THREE; const v = new T.Vector3();
          c.getWorldDirection(v);
          return { yaw: +Math.atan2(v.x, v.z).toFixed(4),
                   sy: w.__mini.stats().yaw, cx: +c.position.x.toFixed(3),
                   cz: +c.position.z.toFixed(3) }; })()""")
        d = 160 if i % 2 == 0 else -160
        drag(cdp, 720, 470, d, 0)
        time.sleep(0.35)
        after = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          const a = window.__app; const c = a.camera;
          const T = window.__dbg.THREE; const v = new T.Vector3();
          c.getWorldDirection(v);
          return { yaw: +Math.atan2(v.x, v.z).toFixed(4),
                   sy: w.__mini.stats().yaw, cx: +c.position.x.toFixed(3),
                   cz: +c.position.z.toFixed(3) }; })()""")
        dyaw = abs(after["yaw"] - before["yaw"])
        dsy = abs(after["sy"] - before["sy"])
        moved = ((after["cx"] - before["cx"]) ** 2 + (after["cz"] - before["cz"]) ** 2) ** 0.5
        if dyaw > 0.15 or dsy > 0.05:
            hitn += 1
        details.append({"i": i, "dyaw": round(dyaw, 3), "dstats_yaw": round(dsy, 3),
                        "cam_moved": round(moved, 2)})
    ok("5.2", hitn == 5, "按住拖动 → 视角 yaw 变化（5/5）", {"hit": hitn, "details": details})

    # ---- 5C 滚轮 → camDist
    hitn = 0
    details = []
    for i in range(5):
        before = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          const a = window.__app; const v = a.flight.view;
          const d = Math.hypot(v.pos[0] - v.look[0], v.pos[1] - v.look[1], v.pos[2] - v.look[2]);
          return { miniDist: w.__mini.stats().camDist, dist: +d.toFixed(3) }; })()""")
        wheel(cdp, 720, 470, -260 if i % 2 == 0 else 260)
        time.sleep(0.25)
        after = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          const a = window.__app; const v = a.flight.view;
          const d = Math.hypot(v.pos[0] - v.look[0], v.pos[1] - v.look[1], v.pos[2] - v.look[2]);
          return { miniDist: w.__mini.stats().camDist, dist: +d.toFixed(3) }; })()""")
        dm = after["miniDist"] - before["miniDist"]
        dd = after["dist"] - before["dist"]
        if abs(dm) >= 1 or abs(dd) > 0.2:
            hitn += 1
        details.append({"i": i, "dMiniDist": dm, "dDist": round(dd, 2)})
    ok("5.3", hitn == 5, "滚轮 → camDist 变化（5/5）", {"hit": hitn, "details": details})
    st = pg.js(JS_STATE)
    ok("5.4", st["mode"] == "FOLLOW", "自由视角期间仍是 FOLLOW", st["mode"])
    shot(pg, "05_freeview")


def s6_phone(cdp, pg):
    print("\n=== 6 手机九宫格 ===", flush=True)
    launch = rect(pg, ".tp-launch")
    ok("6.1", launch and launch["vis"] == "visible" and launch["op"] == "1"
       and launch["x"] > 1200, "进场景后右上角手机图标出现", launch)
    click(cdp, launch["x"], launch["y"], settle=0.5)
    op = pg.js("""({ open: window.__app.phone.isOpen(),
      attr: document.querySelector('.tp-root').getAttribute('data-open'),
      vis: getComputedStyle(document.querySelector('.tp-shell')).visibility })""")
    ok("6.2", op and op["open"] and op["attr"] == "true" and op["vis"] == "visible",
       "真实点手机图标 → 手机滑入", op)

    keys = ["case", "people", "evidence", "notes", "laws", "map", "contact", "learn", "review"]
    details = []
    allok = True
    for k in keys:
        # 回桌面（真实点击底部「桌面」）
        back = rect(pg, '.tp-page[data-page="home"] .tp-app, .tp-foot [data-back]')
        tiles = pg.js("""(() => { const list = [];
          document.querySelectorAll('.tp-app').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 1) list.push(el.getAttribute('data-app'));
          }); return list; })()""")
        if not tiles:
            pg.js("(() => { const b = document.querySelector('.tp-foot [data-back]'); return !!b; })()")
            b = rect(pg, ".tp-foot [data-back]")
            if b:
                click(cdp, b["x"], b["y"], settle=0.3)
        t = rect(pg, '.tp-app[data-app="%s"]' % k)
        if not t:
            details.append((k, "no-tile"))
            allok = False
            continue
        click(cdp, t["x"], t["y"], settle=0.4)
        st = pg.js("""(() => { const p = window.__app.phone.page;
          const page = document.querySelector('.tp-page[data-page="' + p + '"]');
          return { page: p, hidden: page ? page.hidden : null,
                   locked: page ? page.querySelectorAll('.tp-locked').length : -1,
                   textLen: page ? (page.textContent || '').trim().length : 0 }; })()""")
        good = st["page"] == k and st["hidden"] is False and st["textLen"] > 10
        if not good:
            allok = False
        details.append((k, st))
    ok("6.3", allok, "九宫格九个入口全部可点、都能进（无入口锁死）", details)
    shot(pg, "06_phone_grid")
    return details


def s7_dialog(cdp, pg):
    print("\n=== 7 问话 ===", flush=True)
    phone_close(cdp, pg)
    tg = pg.js(JS_TARGETS)
    names = [p["id"] for p in (tg or {}).get("people", [])]
    before = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
      return w.__mini.actorPos(); })()""")
    person = None
    dlg = None
    for pid in names[:2]:
        time.sleep(1.0)          # 等相机落定
        person = fresh_target(pg, "people", ids=[pid])
        if not person:
            continue
        info("点人物 %s @ %s" % (person["id"], person["pt"]))
        click(cdp, person["pt"][0], person["pt"][1], settle=0.3)
        dlg = poll(pg, "(() => { const c = document.querySelector('.dlg-card');"
                       " return c ? { name: (c.querySelector('.dlg-name')||{}).textContent,"
                       "  inputs: c.querySelectorAll('.dlg-input').length,"
                       "  send: c.querySelectorAll('.dlg-send').length,"
                       "  refs: c.querySelectorAll('[data-ref]').length } : null; })()", 14)
        if dlg:
            break
    ok("7.1", bool(dlg) and dlg["inputs"] == 1 and dlg["send"] == 1 and dlg["refs"] == 2
       and bool(dlg["name"]),
       "点场景里的人 → 直接弹出问话面板（自由输入框 + 两个引用入口）",
       {"targets": names, "dlg": dlg})
    if not dlg:
        return False
    after = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
      return w.__mini.actorPos(); })()""")
    moved = ((after["x"] - before["x"]) ** 2 + (after["z"] - before["z"]) ** 2) ** 0.5
    cards = pg.js("document.querySelectorAll('.dlg-card').length")
    # 2026-11 折中方案：点**身体** = 走过去、到位才弹面板（恢复空间感），且只弹一个
    ok("7.2", moved > 0.3 and cards == 1,
       "点身体 → 主角走过去，到位才弹面板（只弹一个）",
       {"from": before, "to": after, "d": round(moved, 2), "cards": cards})
    shot(pg, "07_dialog")

    # ---- 7.2b：关掉面板，点同一个人的姓名牌 → 原地直接开口，不走位
    xb = rect(pg, ".dlg-card .dlg-x")
    if xb:
        click(cdp, xb["x"], xb["y"], settle=0.3)
        pg.wait_for("!document.querySelector('.dlg-card')", 3)
    before2 = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
      return w.__mini.actorPos(); })()""")
    plate = pg.js(JS_PLATE_AT % json.dumps(person["id"]))
    if plate and not plate.get("inView") and person.get("center"):
        face_point(cdp, pg, person["center"])
        plate = pg.js(JS_PLATE_AT % json.dumps(person["id"]))
    msg2 = None
    if plate and plate.get("inView"):
        info("点姓名牌 %s @ [%s, %s]" % (person["id"], plate["x"], plate["y"]))
        click(cdp, plate["x"], plate["y"], settle=0.25)
        msg2 = poll(pg, "(() => { const c = document.querySelector('.dlg-card');"
                        " return c ? { name: (c.querySelector('.dlg-name')||{}).textContent,"
                        "  cards: document.querySelectorAll('.dlg-card').length } : null; })()", 6)
    after2 = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
      return w.__mini.actorPos(); })()""")
    moved2 = ((after2["x"] - before2["x"]) ** 2 + (after2["z"] - before2["z"]) ** 2) ** 0.5
    ok("7.2b", bool(msg2) and msg2["cards"] == 1 and moved2 < 0.3,
       "点姓名牌 → 原地直接开口（不走位，只弹一个面板）",
       {"plate": plate, "dlg": msg2, "from": before2, "to": after2, "d": round(moved2, 2)})

    inp = rect(pg, ".dlg-card .dlg-input")
    click(cdp, inp["x"], inp["y"], settle=0.15)
    insert_text(cdp, "你先坐下，慢慢说，到底是怎么回事？")
    send = rect(pg, ".dlg-card .dlg-send")
    click(cdp, send["x"], send["y"], settle=0.25)
    ans = poll(pg, "(() => { const rows = document.querySelectorAll('.dlg-msg--them .dlg-bubble');"
                   " if (!rows.length) return null;"
                   " return { n: rows.length, text: rows[rows.length-1].textContent.trim().slice(0, 60) }; })()", 20)
    if not ans:
        send = rect(pg, ".dlg-card .dlg-send")
        if send:
            click(cdp, send["x"], send["y"], settle=0.25)
            ans = poll(pg, "(() => { const rows = document.querySelectorAll('.dlg-msg--them .dlg-bubble');"
                           " if (!rows.length) return null;"
                           " return { n: rows.length, text: rows[rows.length-1].textContent.trim().slice(0, 60) }; })()", 20)
    ok("7.3", bool(ans) and ans["n"] >= 1 and len(ans["text"]) > 4,
       "输入一句话 → 点发送 → 有回答（气泡有字）", ans)
    x = rect(pg, ".dlg-card .dlg-x")
    click(cdp, x["x"], x["y"], settle=0.3)
    gone = poll(pg, "(() => { const n = document.querySelectorAll('.dlg-card').length;"
                    " return (n === 0 && !window.__app.dialog)"
                    " ? { card: 0, dlg: false } : null; })()", 3.0)
    if not gone:
        gone = pg.js("({ card: document.querySelectorAll('.dlg-card').length,"
                     " dlg: !!window.__app.dialog })")
    ok("7.4", gone["card"] == 0 and not gone["dlg"], "问话面板能关（DOM 移除 + state 清空）", gone)

    walked = None
    cands = []
    for attempt in range(3):
        time.sleep(0.7)
        g = pg.js(JS_GROUND)
        cands = (g or {}).get("cands") or []
        if not cands:
            info("第 %d 次：没有纯地面候选点" % (attempt + 1))
            continue
        b4 = g.get("actor") or pg.js("""(() => {
          const w = document.getElementById('frame').contentWindow;
          return w.__mini.actorPos(); })()""")
        c = cands[0]
        click(cdp, c["sx"], c["sy"], settle=0.3)
        t0 = time.time()
        while time.time() - t0 < 4.0:
            st = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
              return w.__mini.actorPos(); })()""")
            if st and ((st["x"] - b4["x"]) ** 2 + (st["z"] - b4["z"]) ** 2) ** 0.5 > 0.12:
                walked = {"from": b4, "to": st, "click": c}
                break
            time.sleep(0.12)
        if walked:
            break
        info("这一下没走动；现场：%s" % json.dumps(pg.js("""(() => {
          const w = document.getElementById('frame').contentWindow;
          return { actor: w.__mini.actorPos(), st: w.__mini.stats(),
                   nodes: window.__app.state.nodes.length,
                   dlg: document.querySelectorAll('.dlg-card').length }; })()"""),
          ensure_ascii=False))
    ok("7.5", bool(walked), "关掉问话后还能继续走（点地面有反应）", walked)
    return True


def s8_teleport(cdp, pg):
    print("\n=== 8 地图传送 ===", flush=True)
    phone_home(cdp, pg)
    tile = rect(pg, '.tp-app[data-app="map"]')
    click(cdp, tile["x"], tile["y"], settle=0.45)
    rows = pg.js("""(() => { const out = [];
      document.querySelectorAll('.tp-page[data-page="map"] .tp-scene').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1) return;
        out.push({ t: (el.textContent || '').trim().slice(0, 10), tag: el.tagName.toLowerCase(),
                   x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); });
      return out; })()""")
    ok("8.1", len(rows) == 10, "手机地图列 10 场", [r["t"] for r in rows] if rows else rows)
    target = [r for r in rows if "院墙" in r["t"] and r["tag"] == "button"]
    if not target:
        ok("8.2", False, "地图上找不到可点的「院墙地界」", rows)
        return False
    before_id = pg.js("window.__app.state.sceneId")
    click(cdp, target[0]["x"], target[0]["y"], settle=0.25)
    series = []
    t0 = time.time()
    while time.time() - t0 < 16:
        st = pg.js(JS_STATE)
        tr = st.get("trans") or {}
        series.append({"t": round(time.time() - t0, 2), "phase": tr.get("phase"),
                       "k": tr.get("k"), "mode": st["mode"], "sceneId": st["sceneId"],
                       "started": st["started"], "camY": st["camY"]})
        if st["sceneId"] == "wall" and st["mode"] == "FOLLOW" and tr == {}:
            break
        time.sleep(0.14)
    phases = [s["phase"] for s in series]
    ks = [s["k"] for s in series if s["k"] is not None]
    ok("8.2", "lift" in phases and "rise" in phases and "hold" in phases,
       "传送时序：抬升 → 云起 → 云盖住（phase 齐全）", phases[:20])
    ok("8.3", ks and max(ks) >= 0.99 and min(ks) <= 0.01,
       "云真的盖满（k 到 1）又散开（回 0）", {"max": max(ks or [0]), "min": min(ks or [0])})
    high = [s["camY"] for s in series if s["camY"] is not None]
    ok("8.4", high and max(high) > 12, "抬升时相机升到高位", high[:10])
    st = pg.js(JS_STATE)
    ok("8.5", st["sceneId"] == "wall" and before_id != "wall",
       "传送后 state.sceneId 变成目标（%s → %s）" % (before_id, st["sceneId"]),
       {"sceneId": st["sceneId"]})
    ok("8.6", st["mode"] == "FOLLOW" and st["cam"] == "play",
       "落地后回到 FOLLOW / 自由视角", {"mode": st["mode"], "cam": st["cam"]})
    ok("8.7", st["err"] is None and st["errHost"] is None, "传送全程无异常",
       {"iframe": st["err"], "host": st["errHost"]})
    time.sleep(0.8)
    shot(pg, "08_wall")
    return True


def s9_evidence_notes(cdp, pg):
    print("\n=== 9 证据 / 笔记 ===", flush=True)
    wants = ["s_stone", "s_ditch", "s_wallOld", "s_wallNew", "s_field", "s_wood"]
    seen0 = pg.js("window.__app.state.seen.size")
    got = None
    for attempt in range(4):
        time.sleep(1.1)          # 等相机落定，投影才是这一帧的
        p = fresh_target(pg, "props", ids=wants, min_dist=1.8)
        if not p:
            info("第 %d 次：没有可点的物件候选" % (attempt + 1))
            continue
        info("点物件 %s @ %s" % (p["id"], p["pt"]))
        click(cdp, p["pt"][0], p["pt"][1], settle=0.3)
        got = poll(pg, "(() => window.__app.state.seen.size > %d ?"
                       " [...window.__app.state.seen] : null)()" % seen0, 6)
        if got:
            break
        info("没进证据；现场：%s" % json.dumps(pg.js("""(() => {
          const w = document.getElementById('frame').contentWindow;
          const el = document.elementFromPoint(%d, %d);
          return { actor: w.__mini.actorPos(), st: w.__mini.stats(),
                   top: el ? el.tagName + '#' + el.id : null,
                   nodes: window.__app.state.nodes.length }; })()"""
          % (p["pt"][0], p["pt"][1])), ensure_ascii=False))
    ok("9.1", bool(got) and len(got) > seen0,
       "真实点物件 → 走近 → 证据进 state.seen", {"seen": got})

    phone_home(cdp, pg)
    t = rect(pg, '.tp-app[data-app="evidence"]')
    if t is None:
        b = rect(pg, ".tp-foot [data-back]")
        if b:
            click(cdp, b["x"], b["y"], settle=0.3)
        t = rect(pg, '.tp-app[data-app="evidence"]')
    click(cdp, t["x"], t["y"], settle=0.45)
    ev = pg.js("""(() => { const page = document.querySelector('.tp-page[data-page="evidence"]');
      if (!page) return null;
      const cards = [...page.querySelectorAll('.tp-evi')];
      return { n: cards.length,
               collected: cards.filter((c) => !c.classList.contains('is-missing')).length,
               missing: cards.filter((c) => c.classList.contains('is-missing')).length,
               titles: cards.filter((c) => !c.classList.contains('is-missing'))
                 .map((c) => (c.querySelector('.tp-evi-t') || {}).textContent)
                 .slice(0, 4),
               text: (page.textContent || '').replace(/\\s+/g, ' ').slice(0, 160) }; })()""")
    ok("9.2", bool(ev) and ev["n"] >= 1 and ev["collected"] >= 1,
       "证据夹里能看到条目，且刚看过的那件是「已收集」", ev)

    # ---- 笔记：真实键盘输入 + 真实点击保存/删除
    b = rect(pg, ".tp-foot [data-back]")
    if b:
        click(cdp, b["x"], b["y"], settle=0.3)
    t = rect(pg, '.tp-app[data-app="notes"]')
    click(cdp, t["x"], t["y"], settle=0.45)
    ta = rect(pg, '.tp-page[data-page="notes"] .tp-note-input')
    ok("9.3", bool(ta), "笔记页有输入框", ta)
    if ta:
        click(cdp, ta["x"], ta["y"], settle=0.2)
        typing(cdp, "QA note: listen first")
        val = pg.js("document.querySelector('.tp-page[data-page=\"notes\"] .tp-note-input').value")
        ok("9.4", "QA" in (val or ""), "真实键盘能往笔记里打字", val)
        save = pg.js("""(() => { const list = [];
          document.querySelectorAll('.tp-page[data-page="notes"] .tp-btn').forEach((b) => {
            const r = b.getBoundingClientRect();
            if (r.width < 1) return;
            if ((b.textContent || '').indexOf('存下') >= 0)
              list.push([Math.round(r.left + r.width/2), Math.round(r.top + r.height/2)]);
          }); return list[0] || null; })()""")
        ok("9.5", bool(save), "笔记页有「存下」按钮", save)
        if save:
            click(cdp, save[0], save[1], settle=0.4)
            n1 = pg.js("document.querySelectorAll('.tp-page[data-page=\"notes\"] .tp-note').length")
            ok("9.6", n1 == 1, "点「存下」→ 笔记 +1", n1)
            d = rect(pg, '.tp-page[data-page="notes"] .tp-note-del')
            ok("9.7", bool(d), "笔记有条目删除按钮", d)
            if d:
                click(cdp, d["x"], d["y"], settle=0.4)
                n2 = pg.js("({ dom: document.querySelectorAll('.tp-page[data-page=\"notes\"] .tp-note').length,"
                           " api: window.__app.phone.getNotes().length })")
                ok("9.8", n2["dom"] == 0 and n2["api"] == 0, "点删除 → 笔记清零（DOM + API）", n2)
    shot(pg, "09_notes")


def s10_review(cdp, pg):
    print("\n=== 10 评价 ===", flush=True)
    phone_home(cdp, pg)
    t = rect(pg, '.tp-app[data-app="review"]')
    click(cdp, t["x"], t["y"], settle=0.45)
    end = pg.js("""(() => { const b = document.querySelector('.tp-page[data-page="review"] [data-end]');
      if (!b) return null; const r = b.getBoundingClientRect();
      return r.width > 1 ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
                             t: (b.textContent || '').trim() } : null; })()""")
    ok("10.1", bool(end), "手机评价页有「结案并出评价」", end)
    if not end:
        return False
    click(cdp, end["x"], end["y"], settle=0.7)
    card = pg.js("""(() => { const c = document.querySelector('#reviewLayer .rv-card');
      if (!c) return null;
      const num = (sel) => { const el = c.querySelector(sel); return el ? +el.textContent : null; };
      const dims = {};
      c.querySelectorAll('[data-k]').forEach((el) => { dims[el.getAttribute('data-k')] = +el.textContent; });
      const secs = [...c.querySelectorAll('.rv-sec')].map((s) => ({
        h: (s.querySelector('h4, b, .rv-sec-h') || {}).textContent || '',
        n: s.querySelectorAll('li').length,
        text: (s.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) }));
      return { total: num('.rv-total'), dims, grade: c.dataset.grade,
               seal: (c.querySelector('.rv-seal-l') || {}).textContent,
               secs, replay: !!c.querySelector('.rv-replay'),
               layerOn: document.getElementById('reviewLayer').classList.contains('on') }; })()""")
    ok("10.2", bool(card) and card["layerOn"], "结案 → 出评价卡", card)
    if not card:
        return False
    ok("10.3", len(card["dims"]) >= 3, "评价卡三维分都在", card["dims"])
    sm = sum(card["dims"].values())
    ok("10.4", sm == card["total"], "三维之和 = 总分", {"sum": sm, "total": card["total"]})
    ok("10.5", card["grade"] in ("A", "B", "C") and card["seal"] == card["grade"],
       "有评级且印章一致", {"grade": card["grade"], "seal": card["seal"]})
    ok("10.6", len(card["secs"]) >= 4 and all(s["n"] >= 1 for s in card["secs"]),
       "四段文字都有（每段至少 1 条）", card["secs"])
    ok("10.7", card["replay"], "卡上有「看复盘」", card["replay"])
    shot(pg, "10_review")
    return card


def s11_replay(cdp, pg):
    print("\n=== 11 复盘 ===", flush=True)
    b = rect(pg, "#reviewLayer .rv-replay")
    ok("11.1", bool(b), "评价卡上有可点的「看复盘」", b)
    if not b:
        return False
    click(cdp, b["x"], b["y"], settle=0.6)
    rp = pg.js("""(() => { const l = document.getElementById('replayLayer');
      return { on: l.classList.contains('on'),
               n: l.querySelectorAll('.rp-node').length,
               first: (l.querySelector('.rp-node') || {}).textContent }; })()""")
    ok("11.2", rp["on"] and rp["n"] >= 10, "点「看复盘」→ 时间轴出节点", rp)
    if not rp["on"]:
        return False
    before = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
      return { mode: window.__app.state.mode,
               cam: w.__dbg ? [+w.__dbg.camera.position.x.toFixed(2),
                               +w.__dbg.camera.position.y.toFixed(2),
                               +w.__dbg.camera.position.z.toFixed(2)] : null }; })()""")
    node = pg.js("""(() => { const n = document.querySelectorAll('#replayLayer .rp-node')[2];
      if (!n) return null; const r = n.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()""")
    click(cdp, node["x"], node["y"], settle=1.4)
    after = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
      return { mode: window.__app.state.mode,
               seeks: (window.__app.state.replay || {}).seeks,
               cam: w.__dbg ? [+w.__dbg.camera.position.x.toFixed(2),
                               +w.__dbg.camera.position.y.toFixed(2),
                               +w.__dbg.camera.position.z.toFixed(2)] : null,
               err: window.__err || null }; })()""")
    moved = 0.0
    if before["cam"] and after["cam"]:
        moved = sum(abs(a - b) for a, b in zip(before["cam"], after["cam"]))
    ok("11.3", after["mode"] == "REPLAY", "点节点 → mode 变 REPLAY", after)
    ok("11.4", moved > 1.0, "相机真的飞回去（位移 > 1m）",
       {"before": before["cam"], "after": after["cam"], "moved": round(moved, 2)})

    # 11.5/11.6 换第 9 个节点再点一次：旧版所有节点的 actor 都是场景默认落机位，
    # 第二下点下去相机不动、详情还停在上一个节点 —— 用户报的"点哪都一样"。
    node2 = pg.js("""(() => { const n = document.querySelectorAll('#replayLayer .rp-node')[8];
      if (!n) return null; const r = n.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()""")
    second = None
    d2 = 0.0
    if node2:
        click(cdp, node2["x"], node2["y"], settle=1.5)
        second = pg.js("""(() => {
          const nodes = [...document.querySelectorAll('#replayLayer .rp-node')];
          const on = nodes.findIndex((n) => n.classList.contains('is-on'));
          const w = document.getElementById('frame').contentWindow;
          return { on,
                   cam: w.__dbg ? [+w.__dbg.camera.position.x.toFixed(2),
                                   +w.__dbg.camera.position.y.toFixed(2),
                                   +w.__dbg.camera.position.z.toFixed(2)] : null,
                   act: (document.querySelector('#replayLayer .rp-d-act') || {}).textContent || '',
                   nodeAct: on >= 0 ? ((nodes[on].querySelector('.rp-act') || {}).textContent || '') : '' }; })()""")
        if second and second["cam"] and after["cam"]:
            d2 = math.dist(after["cam"], second["cam"])
    ok("11.5", bool(second) and d2 > 0.5,
       "两个不同节点 → 两个不同机位（相机距离 > 0.5m）",
       {"node3": after["cam"], "node9": second and second["cam"], "dist": round(d2, 2)})
    ok("11.6", bool(second) and second["on"] == 8
       and (second["act"] or "").strip() == (second["nodeAct"] or "").strip(),
       "复盘高亮与详情跟到被点的那个节点（不是永远第一个）", second)
    ok("11.7", after["err"] is None, "复盘期间无异常", after["err"])
    shot(pg, "11_replay")
    pg.js("window.__app.closeReplay(); true")
    time.sleep(0.5)
    return True


def s12_narrow(cdp, pg):
    print("\n=== 12 窄屏 390×844 ===", flush=True)
    pg.viewport(390, 844, mobile=True, scale=2)
    time.sleep(1.0)
    ov = pg.js("""({ vw: innerWidth, sw: document.documentElement.scrollWidth,
      bw: document.body.scrollWidth,
      offenders: [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.right > innerWidth + 1 || r.left < -1);
      }).slice(0, 6).map((el) => el.tagName + '.' + (el.className || '').toString().slice(0, 24)
        + '@' + Math.round(el.getBoundingClientRect().right)) })""")
    ok("12.1", ov["sw"] <= ov["vw"] + 1 and ov["bw"] <= ov["vw"] + 1,
       "390 宽无横向溢出", ov)

    pg.js("window.__app.phone.open(); true")
    time.sleep(0.6)
    ph = pg.js("""(() => { const sh = document.querySelector('.tp-shell').getBoundingClientRect();
      return { l: Math.round(sh.left), r: Math.round(sh.right),
               vw: innerWidth, sw: document.documentElement.scrollWidth }; })()""")
    ok("12.2", ph["l"] >= -1 and ph["r"] <= ph["vw"] + 1 and ph["sw"] <= ph["vw"] + 1,
       "窄屏下手机不出屏、不撑宽", ph)

    phone_home(cdp, pg)
    tile = rect(pg, '.tp-app[data-app="map"]')
    click(cdp, tile["x"], tile["y"], settle=0.5)
    mp = pg.js("""(() => { const p = document.querySelector('.tp-page[data-page="map"]');
      const r = p.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), vw: innerWidth,
               sw: document.documentElement.scrollWidth }; })()""")
    ok("12.3", mp["l"] >= -1 and mp["r"] <= mp["vw"] + 1 and mp["sw"] <= mp["vw"] + 1,
       "窄屏下地图页不出屏", mp)
    shot(pg, "12_narrow_phone")
    pg.js("window.__app.phone.close(); true")
    time.sleep(0.6)

    # 问话面板在窄屏也不出屏
    pg.js("window.__app.openDialog('p_a').then(d => !!d)")
    time.sleep(0.8)
    dl = pg.js("""(() => { const c = document.querySelector('.dlg-card');
      if (!c) return null; const r = c.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), vw: innerWidth,
               sw: document.documentElement.scrollWidth,
               inputs: c.querySelectorAll('.dlg-input').length,
               send: c.querySelectorAll('.dlg-send').length }; })()""")
    ok("12.4", bool(dl) and dl["l"] >= -1 and dl["r"] <= dl["vw"] + 1
       and dl["sw"] <= dl["vw"] + 1 and dl["inputs"] == 1 and dl["send"] == 1,
       "窄屏下问话面板不出屏（自由输入框 + 发送都在）", dl)
    pg.js("window.__app.closeDialog(); true")
    time.sleep(0.4)
    pg.viewport(1440, 900)
    time.sleep(0.6)


def s13_errors(cdp, pg):
    print("\n=== 13 控制台 ===", flush=True)
    st = pg.js(JS_STATE)
    ok("13.1", st["errHost"] is None, "全程外壳 window.__err 为空", st["errHost"])
    ok("13.2", st["err"] is None, "全程 iframe __mini 侧无异常", st["err"])
    ok("13.3", st["mini"] is not None and st["mini"]["stats"] is not None,
       "iframe 里 __mini 仍可用", bool(st["mini"]))


# ------------------------------------------------------------------ 十场遍历
# 第 14 条：把十场逐个走一遍——传送进去（scene:ready）→ 点地面 5/5 →
# 点一件该场可交互物件出证据 → 点一个人物出面板（有人的场）→ 走出来 → 传下一场。
# 场景表直接读 app.js 的 SCENES 常量（window.__app.SCENE_ORDER / SCENES），不另抄一份。
TOUR_ROWS: list[dict] = []
TOUR_READY = """(() => {
  const a = window.__app, f = document.getElementById('frame');
  let mini = false, src = "";
  try {
    mini = !!(f.contentWindow && f.contentWindow.__mini);
    src = String(f.contentWindow.location.pathname || "");
  } catch (e) { mini = false; }
  const qa = window.__qaTour || { ready: [] };
  const cr = qa.ready.length ? qa.ready[qa.ready.length - 1] : null;
  return { id: a.state.sceneId, mode: a.state.mode, trans: a.flight.transition || {},
           ready: !!a.state.frameReady, mini, src,
           readyN: qa.ready.length, lastReady: cr ? cr.id : "",
           err: window.__err || null,
           sceneCase: (a.state.data && a.state.data.id) || "" };
})()"""

TOUR_DIALOG = """(() => {
  const c = document.querySelector('.dlg-card');
  if (!c) return null;
  return { name: (c.querySelector('.dlg-name') || {}).textContent || '',
           role: (c.querySelector('.dlg-role') || {}).textContent || '',
           inputs: c.querySelectorAll('.dlg-input').length,
           send: c.querySelectorAll('.dlg-send').length,
           refs: c.querySelectorAll('[data-ref]').length,
           foot: (c.querySelector('.dlg-count') || {}).textContent || '' };
})()"""


def interactive_props(sid):
    """从场景源码里读"带 interact 落点"的物件：(id, x, z)。

    场景的点击链路只对 props[i].interact 生效；直接猜一个 propId 有 80% 会点到
    纯陈设。这里按文件现读，场景改名/改点位时遍历自动跟着变。
    """
    path = ROOT / "src" / "web" / "scenes" / (sid + ".js")
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    found = {}
    pat = re.compile(r"interact\s*:\s*\{\s*x:\s*(-?\d+(?:\.\d+)?)\s*,\s*z:\s*(-?\d+(?:\.\d+)?)")
    for m in pat.finditer(text):
        prev = text[max(0, m.start() - 900):m.start()]
        ids = re.findall(r'id:\s*"(s_[A-Za-z0-9_]+)"', prev)
        if ids:
            found[ids[-1]] = (float(m.group(1)), float(m.group(2)))
    return [(pid, xz[0], xz[1]) for pid, xz in found.items()]


def interactive_prop_ids(sid):
    return [pid for pid, _, _ in interactive_props(sid)]


JS_PATH_LEN = """(() => { const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__mini) return null;
  const p = w.__mini.debugPath(%r, %r);
  return p ? { len: p.len } : null; })()"""


def map_state(pg):
    return pg.js("""(() => {
      const page = document.querySelector('.tp-page[data-page="map"]');
      if (!page) return null;
      const body = page.querySelector('.tp-body');
      const br = body ? body.getBoundingClientRect() : null;
      const rows = [...page.querySelectorAll('.tp-scene')].map((el) => {
        const r = el.getBoundingClientRect();
        return { t: (el.textContent || '').replace(/\\s+/g, ' ').trim(),
                 tag: el.tagName.toLowerCase(),
                 x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                 top: Math.round(r.top), bottom: Math.round(r.bottom) };
      });
      return { rows, page: window.__app.phone.page,
               body: br ? { t: Math.round(br.top), b: Math.round(br.bottom),
                            x: Math.round(br.left + br.width / 2),
                            y: Math.round(br.top + br.height / 2) } : null,
               scroll: body ? Math.round(body.scrollTop) : -1 }; })()""")


def open_phone_map(cdp, pg):
    phone_home(cdp, pg)
    if pg.js("window.__app.phone.page") != "map":
        t = rect(pg, '.tp-app[data-app="map"]')
        if not t:
            return False
        click(cdp, t["x"], t["y"], settle=0.45)
    return bool(poll(pg, "window.__app.phone.page === 'map' ? true : null", 4))


def map_click_scene(cdp, pg, sid, name):
    """在手机地图里真实点那一行；行在滚动区外时先用真实滚轮滚过去。
    点完立刻核对 state.sceneId —— 没换场就重开地图再点，别干等 26 秒超时。"""
    for attempt in range(3):
        if not open_phone_map(cdp, pg):
            return False
        time.sleep(0.35)
        row = None
        for _ in range(14):
            st = map_state(pg)
            if not st:
                break
            row = next((r for r in st["rows"] if name in r["t"]), None)
            if not row:
                info("地图里找不到「%s」：%s" % (name, [r["t"][:8] for r in st["rows"]]))
                return False
            body = st["body"] or {"t": 0, "b": 900, "x": 720, "y": 450}
            if row["top"] >= body["t"] + 2 and row["bottom"] <= body["b"] - 2:
                break
            wheel(cdp, body["x"], body["y"], 240 if row["bottom"] > body["b"] else -240)
            time.sleep(0.25)
            row = None
        if not row:
            phone_close(cdp, pg)
            continue
        if row["tag"] != "button":
            info("「%s」是当前地点，不需要传送" % name)
            return False
        click(cdp, row["x"], row["y"], settle=0.25)
        landed = poll(pg, "window.__app.state.sceneId === %s ? true : null" % json.dumps(sid), 3.0)
        if landed:
            return True
        info("第 %d 次点地图没换场，重开地图再试" % (attempt + 1))
        phone_close(cdp, pg)
        time.sleep(0.4)
    return False


def wait_scene_ready(pg, sid, timeout=26.0):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        st = pg.js(TOUR_READY)
        last = st
        if st and st["id"] == sid and st["mode"] == "FOLLOW" and not st["trans"] and st["mini"]:
            return st
        time.sleep(0.15)
    return last


JS_GROUND_SCREEN = """(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__mini || !w.__dbg) return null;
  const T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
  const W = w.innerWidth, H = w.innerHeight;
  const cur = w.__mini.stats().actorXZ;
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  const plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
  const out = [];
  for (let sx = 120; sx <= W - 120; sx += 90) {
    for (let sy = 160; sy <= H - 120; sy += 70) {
      ndc.set((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      if (!ray.ray.intersectPlane(plane, hit)) continue;
      if (w.__mini.blockedAt(hit.x, hit.z)) continue;
      const d = Math.hypot(hit.x - cur[0], hit.z - cur[1]);
      if (d < 1.6 || d > 7.5) continue;
      const info = w.__mini.debugPath(hit.x, hit.z);
      if (!info || info.len < 2) continue;
      // 这一像素上不能有可点的物件/人，否则这一下会变成"查看"而不是"走路"
      const hs = ray.intersectObjects(sc.children, true);
      let identified = false;
      for (const h of hs) {
        const u = h.object.userData || {};
        if (u.personId || u.nameplateFor) { identified = true; break; }
        if (u.propId) {
          let flat = false;
          try {
            const bb = new T.Box3().setFromObject(h.object);
            const s = bb.getSize(new T.Vector3());
            flat = s.y < 0.35 && Math.max(s.x, s.z) > 8;
          } catch (e) { flat = false; }
          if (!flat) { identified = true; break; }
        }
      }
      if (identified) continue;
      out.push({ sx, sy, len: info.len, dist: +d.toFixed(1) });
      if (out.length >= 6) return out;
    }
  }
  return out;
})()"""


def ground_walk(cdp, pg, tries=3):
    """真实点一次地面，等主角真的挪动；挪不动就换候选点 / 换个朝向再试。"""
    for attempt in range(tries):
        g = pg.js(JS_GROUND_TOUR)
        cands = (g or {}).get("cands") or []
        if attempt > 0 or not cands:
            # 世界点投影失败时改成"屏幕上采样地面"：点的一定是这一帧看得见的地
            screen = pg.js(JS_GROUND_SCREEN) or []
            cands = screen or (pg.js(JS_GROUND) or {}).get("cands") or []
            g = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
              return { actor: (() => { const a = w.__mini.actorPos(); return { x: a.x, z: a.z }; })() }; })()""")
        if not cands:
            drag(cdp, 720, 470, 150 if attempt % 2 == 0 else -230, 0)
            time.sleep(0.45)
            continue
        c = max(cands, key=lambda x: x.get("len") or 0)
        before = (g or {}).get("actor") or {"x": 0, "z": 0}
        click(cdp, c["sx"], c["sy"], settle=0.22)
        t0 = time.time()
        while time.time() - t0 < 2.6:
            st = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
              return w && w.__mini ? w.__mini.actorPos() : null; })()""")
            if st:
                d = ((st["x"] - before["x"]) ** 2 + (st["z"] - before["z"]) ** 2) ** 0.5
                if d > 0.12:
                    return {"from": before, "to": st, "d": round(d, 2),
                            "wait": round(time.time() - t0, 2), "click": c}
            time.sleep(0.12)
        drag(cdp, 720, 470, 140 if attempt % 2 == 0 else -220, 0)
        time.sleep(0.4)
    return None


def wait_idle(pg, timeout=4.0):
    """等主角站定 + 相机跟上：投影会随镜头漂，落定前算出来的屏幕点会点偏。"""
    end = time.time() + timeout
    while time.time() < end:
        st = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          return w && w.__mini ? w.__mini.stats() : null; })()""")
        if st and not st["walking"] and st["path"] == 0:
            return True
        time.sleep(0.12)
    return False


def face_point(cdp, pg, center, tries=4):
    """真实拖动把镜头转向某个世界坐标，让人/物件进画面。

    拖动灵敏度取自 flight.orbit：yaw 每次减 dx*0.006。这里按当前相机朝向
    算差值，再用真实 mouseMoved 拖过去，不直接改相机。
    """
    for _ in range(tries):
        cam = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          if (!w || !w.__dbg) return null;
          const c = w.__dbg.camera, T = w.__dbg.THREE, v = new T.Vector3();
          c.getWorldDirection(v);
          return [c.position.x, c.position.z, Math.atan2(v.x, v.z)]; })()""")
        if not cam:
            return False
        dx = center[0] - cam[0]
        dz = center[2] - cam[1]
        want = math.atan2(dx, dz)
        delta = (want - cam[2] + math.pi) % (2 * math.pi) - math.pi
        if abs(delta) < 0.16:
            return True
        px = int(max(-420, min(420, -delta / 0.006)))
        drag(cdp, 720, 470, px, 0)
        time.sleep(0.4)
    return False


def prop_center(pg, pid):
    tg = pg.js(JS_TARGETS) or {}
    for p in tg.get("props") or []:
        if p["id"] == pid:
            return p.get("center")
    return None


def find_visible_prop(pg, pid):
    tg = pg.js(JS_TARGETS) or {}
    for p in tg.get("props") or []:
        if p["id"] != pid:
            continue
        f = p.get("first") or {}
        if f.get("kind") == "prop" and f.get("id") == pid:
            return p
    return None


def find_visible_person(pg, pid):
    tg = pg.js(JS_TARGETS) or {}
    for p in tg.get("people") or []:
        if p["id"] != pid:
            continue
        f = p.get("first") or {}
        if f.get("kind") == "person" and f.get("id") == pid:
            return p
    return None


JS_HIT_AT = """(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__dbg) return null;
  const T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
  const x = %d, y = %d;
  const ndc = new T.Vector2((x / w.innerWidth) * 2 - 1, -(y / w.innerHeight) * 2 + 1);
  const rc = new T.Raycaster();
  rc.setFromCamera(ndc, cam);
  const hs = rc.intersectObjects(sc.children, true);
  for (const h of hs) {
    const u = h.object.userData || {};
    if (u.personId) return { kind: 'person', id: u.personId };
    if (u.nameplateFor) return { kind: 'person', id: u.nameplateFor };
    if (u.propId) {
      let flat = false;
      try {
        const bb = new T.Box3().setFromObject(h.object);
        const s = bb.getSize(new T.Vector3());
        flat = s.y < 0.35 && Math.max(s.x, s.z) > 8;
      } catch (e) { flat = false; }
      if (!flat) return { kind: 'prop', id: u.propId };
    }
  }
  return null;
})()"""


def hit_at(pg, x, y):
    return pg.js(JS_HIT_AT % (int(x), int(y)))


def click_identity(cdp, pg, pid, kind, pt):
    """在投影点周围试几个像素：只点"按身份射线第一个命中就是目标"的那一个。
    场景里家具描边、玻璃、半堵墙都会挡住 bbox 中心，单点一次很容易点空。"""
    size = pg.js("(() => { const w = document.getElementById('frame').contentWindow;"
                 " return w ? { w: w.innerWidth, h: w.innerHeight } : null; })()") \
        or {"w": 1440, "h": 900}
    offsets = [(0, 0), (0, -26), (0, -48), (0, -72), (-18, 0), (18, 0),
               (-36, 0), (36, 0), (0, 22), (0, 46), (-26, -30), (26, -30)]
    for dx, dy in offsets:
        x, y = pt[0] + dx, pt[1] + dy
        if x < 6 or y < 6 or x > size["w"] - 6 or y > size["h"] - 6:
            continue
        hit = hit_at(pg, x, y)
        if not hit or hit.get("kind") != kind or hit.get("id") != pid:
            continue
        click(cdp, x, y, settle=0.3)
        return True
    return False


def trigger_evidence(cdp, pg, sid):
    seen0 = pg.js("window.__app.state.seen.size")
    nodes0 = pg.js("window.__app.state.nodes.length")
    tg = pg.js(JS_TARGETS) or {}
    actor = tg.get("actor") or [0, 0]
    # 先按直线距离粗排，再用场景自己的 debugPath 按真实路程精排：
    # 挑"走得到、且路最短"的那件，省掉一次十几秒的空走。
    rough = []
    for pid, x, z in interactive_props(sid):
        d = ((x - actor[0]) ** 2 + (z - actor[1]) ** 2) ** 0.5
        rough.append((d, pid, x, z))
    if not rough:
        # 场景源码正在被改 / 解析不到 interact 时：退回按 propId 找，不空手
        for p in tg.get("props") or []:
            c = p.get("center") or [0, 0, 0]
            d = ((c[0] - actor[0]) ** 2 + (c[2] - actor[1]) ** 2) ** 0.5
            rough.append((d, p["id"], c[0], c[2]))
    rough.sort()
    fine = []
    for _, pid, x, z in rough[:6]:
        ln = pg.js(JS_PATH_LEN % (x, z))
        if ln and ln.get("len", 0) > 0:
            fine.append((ln["len"], pid))
    fine.sort()
    if not fine:
        fine = [(d, pid) for d, pid, _, _ in rough[:3]]
    for _, pid in fine[:4]:
        center = prop_center(pg, pid)
        if not center:
            continue
        face_point(cdp, pg, center)
        wait_idle(pg)
        time.sleep(0.4)
        tg = pg.js(JS_TARGETS) or {}
        p = None
        for q in tg.get("props") or []:
            if q["id"] == pid:
                p = q
                break
        if not p or (p.get("first") or {}).get("kind") == "off":
            continue
        info("点物件 %s @ %s" % (p["id"], p["pt"]))
        if not click_identity(cdp, pg, pid, "prop", p["pt"]):
            info("像素扫描没找到 %s 的身份命中" % pid)
            continue
        got = poll(pg, """(() => { const a = window.__app.state;
          if (a.seen.size > %d || a.nodes.length > %d) {
            return { seen: [...a.seen], nodes: a.nodes.length };
          }
          return null; })()""" % (seen0, nodes0), 8)
        if not got:
            # 走位要时间：等站定再看一眼，别急着点下一件（会把走位改道）
            wait_idle(pg, 6)
            if pg.js("window.__app.state.seen.size") > seen0 or \
                    pg.js("window.__app.state.nodes.length") > nodes0:
                got = {"seen": pg.js("[...window.__app.state.seen]"),
                       "nodes": pg.js("window.__app.state.nodes.length")}
        if got:
            return {"prop": p["id"], "seen": got["seen"], "nodes": got["nodes"]}
    return None


def trigger_person(cdp, pg, party_ids):
    tg = pg.js(JS_TARGETS) or {}
    actor = tg.get("actor") or [0, 0]
    ranked = []
    for p in tg.get("people") or []:
        if p["id"] not in party_ids:
            continue
        c = p.get("center") or [0, 0, 0]
        ranked.append((((c[0] - actor[0]) ** 2 + (c[2] - actor[1]) ** 2) ** 0.5, p["id"]))
    ranked.sort()
    ids = [pid for _, pid in ranked]
    for pid in ids[:4]:
        dlg = try_talk(cdp, pg, pid)
        if dlg:
            return {"person": pid, "dlg": dlg}
        # 人被房子 / 家具挡住、点不到像素时：先让场景把他带到人边上（只负责走位），
        # 站定后再来一次真实点击 —— 面板仍然只由这一下鼠标点击打开。
        pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          try { w.__mini.goToPerson(%s); } catch (e) {}
          return true; })()""" % json.dumps(pid))
        wait_idle(pg, 12)
        time.sleep(0.6)
        dlg = try_talk(cdp, pg, pid)
        if dlg:
            return {"person": pid, "dlg": dlg, "walked": True}
    return None


def try_talk(cdp, pg, pid):
    tg = pg.js(JS_TARGETS) or {}
    p = None
    for q in tg.get("people") or []:
        if q["id"] == pid:
            p = q
            break
    if not p:
        return None
    center = p.get("center")
    if center:
        face_point(cdp, pg, center)
    wait_idle(pg)
    time.sleep(0.5)
    tg = pg.js(JS_TARGETS) or {}
    p = None
    for q in tg.get("people") or []:
        if q["id"] == pid:
            p = q
            break
    if not p:
        return None
    info("点人物 %s @ %s" % (p["id"], p["pt"]))
    if not click_identity(cdp, pg, pid, "person", p["pt"]):
        info("像素扫描没找到 %s 的身份命中" % pid)
        return None
    dlg = poll(pg, TOUR_DIALOG, 9)
    if dlg:
        # 面板要等案卷/法条资料到齐才画全：等一下再读，别把中间态当结果
        time.sleep(0.6)
        dlg = pg.js(TOUR_DIALOG) or dlg
        return dlg
    return None


def close_tour_dialog(cdp, pg):
    x = rect(pg, ".dlg-card .dlg-x")
    if x:
        click(cdp, x["x"], x["y"], settle=0.3)
    gone = poll(pg, "(() => (document.querySelectorAll('.dlg-card').length === 0 "
                    "&& !window.__app.dialog) ? true : null)()", 3)
    if not gone:
        pg.js("window.__app.closeDialog(); true")
        time.sleep(0.35)
    return bool(gone)


def ensure_case(pg, cid):
    now = pg.js("(window.__app.state.data && window.__app.state.data.id) || ''")
    if now == cid:
        return True
    pg.js("window.__app.setCase(%s); true" % json.dumps(cid))
    return bool(poll(pg, "(window.__app.state.data && window.__app.state.data.id) === %s"
                     % json.dumps(cid), 10))


def s14_scene_tour(cdp, pg):
    print("\n=== 14 十场逐场遍历 ===", flush=True)
    if not pg.js("window.__app.state.started"):
        # 单独跑第 14 条（--only 14）时的入口：直接起院墙场景，后面再逐场传送
        pg.js("window.__app.enterScene('wall'); true")
        poll(pg, "(() => { try { return !!document.getElementById('frame').contentWindow.__mini; }"
                 " catch (e) { return false; } })()", 25)
        time.sleep(2.4)
    scenes = pg.js("window.__app.SCENE_ORDER.map((id) => ({ id, name: window.__app.SCENES[id].name }))")
    ok("14.0", bool(scenes) and len(scenes) == 10, "SCENES 常量里是十场", scenes)
    if not scenes or len(scenes) != 10:
        return False

    # 在宿主页装一个只读观察器：只收 iframe 自己发的 scene:ready，不伪造任何事件
    pg.js("""(() => {
      window.__qaTour = window.__qaTour || { ready: [] };
      if (!window.__qaTour.bound) {
        window.__qaTour.bound = true;
        window.addEventListener('message', (ev) => {
          const d = ev.data || {};
          if (d.source === 'mini3d' && d.type === 'scene:ready') {
            window.__qaTour.ready.push({ id: (window.__app.state || {}).sceneId || '' });
          }
        }, true);
      }
      return true; })()""")

    for idx, sc in enumerate(scenes, 1):
        sid, name = sc["id"], sc["name"]
        t0 = time.time()
        case_id = "case_00_flame" if sid == "duty" else (
            "case_05_court" if sid == "court" else "case_06_wall")
        case_ok = ensure_case(pg, case_id)
        phone_close(cdp, pg)
        if not open_phone_map(cdp, pg):
            ok("14.%d.1" % idx, False, "%s 手机地图打不开" % name)
            TOUR_ROWS.append({"id": sid, "name": name, "ready": False, "walk": "-",
                              "evidence": "-", "person": "-", "err": "map"})
            continue
        ready_n0 = pg.js("(window.__qaTour.ready || []).length")
        clicked = map_click_scene(cdp, pg, sid, name)
        st = wait_scene_ready(pg, sid) if clicked else None
        ready_ok = bool(clicked and st and st["id"] == sid and st["mode"] == "FOLLOW"
                        and st["mini"] and st["readyN"] > ready_n0
                        and st["lastReady"] == sid)
        ok("14.%d.1" % idx, ready_ok,
           "%s 传送到位（收到 scene:ready → FOLLOW）" % name,
           {"clicked": clicked, "st": st})
        if not ready_ok:
            TOUR_ROWS.append({"id": sid, "name": name, "case": case_id,
                              "ready": False, "walk": "-", "evidence": "",
                              "person": "-", "secs": round(time.time() - t0, 1)})
            continue

        time.sleep(1.0)
        shot(pg, "scene_" + sid)
        wait_idle(pg, 3)

        # ---- 物件 → 证据（先在落点附近看，走位最短）
        ev = trigger_evidence(cdp, pg, sid)
        ok("14.%d.3" % idx, bool(ev), "%s 点物件 → 证据进 state.seen" % name, ev)

        # ---- 点地面 5/5
        hits, attempts, misses = 0, 0, []
        for _ in range(5):
            attempts += 1
            got = ground_walk(cdp, pg, tries=3)
            if got:
                hits += 1
                wait_idle(pg, 3)
            else:
                misses.append("第 %d 次没走动" % (hits + len(misses) + 1))
            time.sleep(0.12)
        ok("14.%d.2" % idx, hits == 5, "%s 点地面走 5/5（实际点了 %d 次）" % (name, attempts),
           {"hits": hits, "attempts": attempts, "misses": misses})

        # ---- 人物 → 面板（只算本案当事人；amb_* 布景 NPC 不算"人"）
        party_ids = pg.js("Object.keys((window.__app.state.data && "
                          "window.__app.state.data.parties) || {})") or []
        targets = pg.js(JS_TARGETS) or {}
        people = [p for p in (targets.get("people") or []) if p["id"] in party_ids]
        people_n = len(people)
        if people_n:
            talk = trigger_person(cdp, pg, party_ids)
            dlg = talk["dlg"] if talk else None
            person_ok = bool(dlg and dlg["inputs"] == 1 and dlg["send"] == 1 and dlg["name"])
            person_txt = ("%s（自由输入）" % dlg["name"]) if dlg else "未弹出"
            topic_answer = ""
            if dlg:
                ib = rect(pg, ".dlg-card .dlg-input")
                if ib:
                    click(cdp, ib["x"], ib["y"], settle=0.15)
                    insert_text(cdp, "你先坐下，慢慢说，到底是怎么回事？")
                    sb = rect(pg, ".dlg-card .dlg-send")
                    if sb:
                        click(cdp, sb["x"], sb["y"], settle=0.25)
                        ans = poll(pg, "(() => { const r = document.querySelectorAll("
                                       "'.dlg-msg--them .dlg-bubble'); if (!r.length) return null;"
                                       " return r[r.length-1].textContent.trim().slice(0, 40); })()", 20)
                        topic_answer = ans or ""
                close_tour_dialog(cdp, pg)
                wait_idle(pg, 3)
            ok("14.%d.4" % idx, person_ok, "%s 点人物 → 问话面板：%s" % (name, person_txt),
               {"people": people_n, "talk": talk, "answer": topic_answer})
        else:
            person_txt = "无人物（跳过）"
            ok("14.%d.4" % idx, True, "%s 该场无人物，面板检查按设计跳过" % name)

        # ---- 走出来：确认面板没了再点地面
        if pg.js("document.querySelectorAll('.dlg-card').length"):
            close_tour_dialog(cdp, pg)
        wait_idle(pg, 3)
        out = ground_walk(cdp, pg, tries=2)
        ok("14.%d.5" % idx, bool(out), "%s 收尾能自己走出来（点地面还有反应）" % name, out)

        TOUR_ROWS.append({
            "id": sid, "name": name, "case": case_id, "case_ok": bool(case_ok),
            "ready": bool(ready_ok), "walk": "%d/5" % hits, "attempts": attempts,
            "evidence": ev["prop"] if ev else "", "person": person_txt,
            "secs": round(time.time() - t0, 1),
        })
        info("本场 %.1fs：%s｜地面 %d/5｜证据 %s｜人物 %s"
             % (time.time() - t0, "传送OK" if ready_ok else "传送失败", hits,
                ev["prop"] if ev else "未触发", person_txt))

    # ---- 最后一场之后：还能打开地图、十场都还在
    phone_close(cdp, pg)
    map_ok = open_phone_map(cdp, pg)
    st = map_state(pg) if map_ok else None
    rows = (st or {}).get("rows") or []
    ok("14.90", bool(st) and len(rows) == 10, "走完十场后地图仍列全 10 场", [r["t"] for r in rows])
    phone_close(cdp, pg)

    LOGS.mkdir(parents=True, exist_ok=True)
    (LOGS / "QA_scene_tour.json").write_text(
        json.dumps(TOUR_ROWS, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n  场次            传送  点地面   证据        人物")
    for r in TOUR_ROWS:
        print("  %-12s %-4s %-7s %-11s %s" % (
            r["id"], "OK" if r["ready"] else "FAIL", r["walk"],
            r["evidence"] or "-", r["person"]))
    return all(r["ready"] and r["walk"] == "5/5" and r["evidence"] for r in TOUR_ROWS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="只跑某几步，如 1,2,3 或 14")
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    args = ap.parse_args()
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    def want(n):
        return not only or str(n) in only

    edge = find_edge()
    if not edge:
        print("找不到 Edge/Chrome")
        return 2
    port = free_port()
    prof = tempfile.mkdtemp(prefix="qa-play-")
    proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             "--no-first-run", "--no-default-browser-check",
                             "--remote-debugging-port=%d" % port,
                             "--user-data-dir=%s" % prof, "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cdp = None
    try:
        page = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port)
                    if t.get("type") == "page")
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        pg = Page(cdp)
        if not boot(cdp, pg):
            return 1
        if want(1):
            s1_first_screen(cdp, pg)
        if want(2):
            s2_start(cdp, pg)
        started_at = s3_loading(cdp, pg) if want(3) else None
        if want(4):
            s4_transition(cdp, pg, started_at)
        if want(5):
            s5_freeview(cdp, pg)
        if want(6):
            s6_phone(cdp, pg)
        if want(8):
            s8_teleport(cdp, pg)
        # 先看证据、再点人：证据要"从远处点 → 走过去"，人则要走近 —— 两条都要从
        # 传送落点附近出发，顺序反了会让第二段从"已经贴着物件"的位置开始。
        if want(9):
            s9_evidence_notes(cdp, pg)
        if want(7):
            s7_dialog(cdp, pg)
        if want(14):
            s14_scene_tour(cdp, pg)
        if want(10):
            s10_review(cdp, pg)
        if want(11):
            s11_replay(cdp, pg)
        if want(12):
            s12_narrow(cdp, pg)
        if want(13):
            s13_errors(cdp, pg)
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        import shutil
        shutil.rmtree(prof, ignore_errors=True)

    bad = [r for r in RESULTS if not r[1]]
    print("\n" + "-" * 60)
    print("通过 %d ｜ 失败 %d" % (len(RESULTS) - len(bad), len(bad)))
    for cid, _, msg in bad:
        print("  x %s %s" % (cid, msg))
    if SHOTS:
        print("截图 %d 张，首张 %s" % (len(SHOTS), Path(SHOTS[0]).name))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
