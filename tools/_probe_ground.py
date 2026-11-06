#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真实鼠标点地面成功率探针（CDP Input.dispatchMouseEvent，不派假事件）。

每条用例只做一件事：点一下画面上的地面 → 读 __mini.stats().actorXZ 是否真的变了。
覆盖：duty（室内）与 wall（室外）；命中点一律取"从当前主角位置 debugPath 可达"的地面。

用法： py -3 tools/_probe_ground.py [--scene duty|wall] [--n 10]
输出： tools/_logs/ground_probe_<scene>.json
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from test_app import CDP, Page, find_edge, free_port, wait_json  # noqa: E402

APP_URL = "http://127.0.0.1:8770/static/app.html"

CANDIDATES = {
    "duty": {"x0": -4.6, "x1": 4.6, "z0": -2.6, "z1": 3.4},
    "wall": {"x0": -7.0, "x1": 7.0, "z0": 1.6, "z1": 8.0}
}

# 每条用例的统一起点：与 app.js 的 SCENES 落点一致
HOME = {"duty": (0.9, 2.6), "wall": (0.6, 5.4)}

# 直接在屏幕上采样：每个采样点用与场景同一条射线打地面，只保留"可达 + 离主角 1.2~8m"的。
# 这样点的是玩家真看得见的地面，不会出现"世界坐标在视野外"的假失败。
JS_PICK = r"""(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__mini || !w.__dbg) return null;
  const T = w.__dbg.THREE, cam = w.__dbg.camera;
  const W = innerWidth, H = innerHeight;
  const cur = w.__mini.stats().actorXZ;
  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  const plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const hit = new T.Vector3();
  const out = [];
  for (let sx = 150; sx <= W - 150; sx += 110) {
    for (let sy = 140; sy <= H - 140; sy += 80) {
      ndc.set((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      if (!ray.ray.intersectPlane(plane, hit)) continue;
      if (w.__mini.blockedAt(hit.x, hit.z)) continue;   // 只点房间里真正可站的格子
      const d = Math.hypot(hit.x - cur[0], hit.z - cur[1]);
      if (d < 1.2 || d > 8) continue;
      const info = w.__mini.debugPath(hit.x, hit.z);
      if (!info || info.len <= 0) continue;
      out.push({ wx: +hit.x.toFixed(2), wz: +hit.z.toFixed(2), x: sx, y: sy });
    }
  }
  return out;
})()"""

JS_PROJECT_BOARD = r"""(() => {
  const T = window.__dbg.THREE;
  const v = new T.Vector3(%r, %r, %r).project(window.__app.camera);
  return { x: Math.round((v.x * 0.5 + 0.5) * innerWidth),
           y: Math.round((-v.y * 0.5 + 0.5) * innerHeight) };
})()"""

JS_PROJECT = r"""(() => {
  const w = document.getElementById('frame').contentWindow;
  const v = new w.__dbg.THREE.Vector3(%r, 0.02, %r).project(w.__dbg.camera);
  return { x: Math.round((v.x * 0.5 + 0.5) * innerWidth),
           y: Math.round((-v.y * 0.5 + 0.5) * innerHeight) };
})()"""

JS_STATE = r"""(() => {
  const f = document.getElementById('frame');
  let mini = null;
  try { mini = f.contentWindow && f.contentWindow.__mini ? f.contentWindow.__mini.stats() : null; }
  catch (e) { mini = null; }
  const el = document.elementFromPoint(720, 450);
  return {
    mini, mode: window.__app.state.mode, sceneId: window.__app.state.sceneId,
    cam: window.__app.state.cam, play: window.__app.state.cam === 'play',
    framePE: getComputedStyle(f).pointerEvents, frameOn: f.classList.contains('on'),
    stageVis: getComputedStyle(document.getElementById('stage')).visibility,
    loadHidden: document.getElementById('load').hidden,
    bootDisp: getComputedStyle(document.getElementById('boot')).display,
    phoneOpen: !!(window.__app.phone && window.__app.phone.isOpen()),
    topAt: el ? el.tagName + (el.id ? '#' + el.id : '') : null,
    err: window.__err || null
  };
})()"""


def click(cdp, x, y):
    for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
        p = {"type": kind, "x": x, "y": y}
        if kind != "mouseMoved":
            p.update({"button": "left", "clickCount": 1})
        cdp.call("Input.dispatchMouseEvent", p)
        time.sleep(0.03)


def stats(pg):
    return pg.js("(() => { const w = document.getElementById('frame').contentWindow;"
                 " return (w && w.__mini) ? w.__mini.stats() : null; })()")


def run(scene: str, n: int) -> int:
    edge = find_edge()
    if not edge:
        print("找不到 Edge")
        return 2
    port = free_port()
    profile = tempfile.mkdtemp(prefix="ground-probe-")
    proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             "--no-first-run", "--no-default-browser-check",
                             "--remote-debugging-port=%d" % port,
                             "--user-data-dir=%s" % profile, "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cdp = None
    rows = []
    try:
        page = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port)
                    if t.get("type") == "page")
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        pg = Page(cdp)
        pg.viewport(1440, 900)
        cdp.call("Page.navigate", {"url": APP_URL})
        if not pg.wait_for("!!(window.__app && window.__app.boot)", 25):
            print("页面没起来")
            return 1
        time.sleep(1.0)

        # 首屏只有一块板：真实鼠标点它 → 直接进加载页（没有密码门）
        layout = pg.js("window.__app.boot.layout()") or []
        board = layout[0] if layout else None
        print("首屏看板:", board)
        pt = pg.js(JS_PROJECT_BOARD % (board["x"], board["y"], board["z"])) if board else None
        if not pt:
            print("取不到看板投影")
            return 1
        click(cdp, pt["x"], pt["y"])
        print("密码门已移除:", pg.js("!document.getElementById('gate')"))
        if not pg.wait_for("!!(window.__app.state.started)", 70):
            print("没进游戏；state=", json.dumps(pg.js(JS_STATE), ensure_ascii=False))
            return 1
        if scene != "duty":
            pg.js("window.__app.teleport(%r)" % scene)
            pg.wait_for("window.__app.state.mode === 'FLIGHT'", 8)
            pg.wait_for("window.__app.state.mode === 'FOLLOW'", 25)
        pg.wait_for("window.__app.state.cam === 'play'", 12)
        time.sleep(0.6)
        print("起始状态:", json.dumps(pg.js(JS_STATE), ensure_ascii=False))
        print("相机:", json.dumps(pg.js("""(() => {
          const w = document.getElementById('frame').contentWindow;
          const c = w.__dbg.camera;
          const v = new w.__dbg.THREE.Vector3(-1.6, 0.02, 3.0).project(c);
          return { pos: c.position.toArray().map(n => +n.toFixed(2)),
                   rot: [c.rotation.x, c.rotation.y, c.rotation.z].map(n => +n.toFixed(2)),
                   fov: c.fov, aspect: +c.aspect.toFixed(3), inner: [innerWidth, innerHeight],
                   frameInner: [w.innerWidth, w.innerHeight],
                   v: [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)] };
        })()"""), ensure_ascii=False))

        ok = 0
        used = []
        for i in range(n):
            # 等上一条真的走完（path 清空），再回到统一起点；否则旧路径会接着走。
            stop_end = time.time() + 3.5
            while time.time() < stop_end:
                st0 = stats(pg)
                if st0 and st0["path"] == 0 and not st0["walking"]:
                    break
                time.sleep(0.15)
            # 每条用例都从同一个落点出发：镜头视角固定，10 个点才都是"玩家看得见的地面"。
            # 点击本身仍然是真实 CDP 鼠标，走的仍是场景自己的 walkTo。
            pg.js("(() => { const w = document.getElementById('frame').contentWindow;"
                  " w.__mini.setActor(%r, %r); return true; })()"
                  % (HOME.get(scene, HOME["duty"])[0], HOME.get(scene, HOME["duty"])[1]))
            time.sleep(0.75)
            pts = pg.js(JS_PICK) or []
            if not pts:
                print("没有可用的地面点")
                break
            # 10 个点必须在屏幕上彼此分开（横/纵至少挪 140px），且世界坐标不重复
            fresh = [p for p in pts
                     if all(abs(p["x"] - q[0]) + abs(p["y"] - q[1]) >= 140 for q in used)
                     and all(abs(p["wx"] - q[2]) + abs(p["wz"] - q[3]) >= 0.7 for q in used)]
            if not fresh:
                fresh = pts
            # 优先选屏幕下半部、离画面中心近的地面；太靠边会点到墙/家具
            fresh.sort(key=lambda p: (abs(p["x"] - 720) ** 2 + (p["y"] - 620) ** 2))
            p = fresh[0]
            used.append([p["x"], p["y"], p["wx"], p["wz"]])
            before = stats(pg)
            x0, z0 = before["actorXZ"]
            proj = {"x": p["x"], "y": p["y"]}
            click(cdp, proj["x"], proj["y"])
            time.sleep(0.32)
            mid = pg.js("(() => { const w = document.getElementById('frame').contentWindow;"
                        " return { path: w.__mini.stats().path, events: (w.__events||[]).slice(-2) }; })()")
            after = before
            t0 = time.time()
            while time.time() - t0 < 2.2:
                time.sleep(0.12)
                cur2 = stats(pg)
                if cur2 and (abs(cur2["actorXZ"][0] - x0) + abs(cur2["actorXZ"][1] - z0)) > 0.15:
                    after = cur2
                    break
            good = (abs(after["actorXZ"][0] - x0) + abs(after["actorXZ"][1] - z0)) > 0.15
            ok += 1 if good else 0
            rows.append({"i": i, "world": [p["wx"], p["wz"]], "click": [proj["x"], proj["y"]],
                         "before": before["actorXZ"], "after": after["actorXZ"],
                         "pathAfterClick": (mid or {}).get("path"),
                         "events": (mid or {}).get("events"), "ok": good,
                         "diag": None if good else pg.js(JS_STATE)})
            print("[%02d] world=%s click=%s %s -> %s  %s  path=%s" % (
                i + 1, [p["wx"], p["wz"]], [proj["x"], proj["y"]], before["actorXZ"],
                after["actorXZ"], "OK" if good else "FAIL", (mid or {}).get("path")))
            if not good:
                print("    diag:", json.dumps(rows[-1]["diag"], ensure_ascii=False))
            time.sleep(0.45)
        print("-" * 60)
        print("成功率 %d/%d" % (ok, n))
        LOG = ROOT / "tools" / "_logs" / ("ground_probe_%s.json" % scene)
        LOG.write_text(json.dumps({"scene": scene, "ok": ok, "n": n, "rows": rows},
                                  ensure_ascii=False, indent=1), encoding="utf-8")
        return 0 if ok == n else 1
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


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", default="duty")
    ap.add_argument("--n", type=int, default=10)
    a = ap.parse_args()
    sys.exit(run(a.scene, a.n))
