# -*- coding: utf-8 -*-
"""缩放 / 转场落位的验收探针（不入测试套件）。

量三件事：
  1. 场景直开页：滚轮在最小/默认/最大三档是否停得住、有没有跳变；
  2. 外壳 app.html：云朵转场落位那一帧的相机 y / 俯角 / 离主角距离；
  3. 落位后是否回到 FOLLOW + play（自由视角还活着），以及还能不能缩到看全底座。
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from test_app import CDP, Page, find_edge, free_port, wait_json  # noqa: E402

BASE = "http://127.0.0.1:8770"
OUT = ROOT / "tools" / "_logs"


def wheel(cdp, x, y, dy):
    cdp.call("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y,
                                          "deltaX": 0, "deltaY": dy})
    time.sleep(0.05)


def main() -> int:
    edge = find_edge()
    if not edge:
        print("找不到 Edge/Chrome")
        return 2
    port = free_port()
    prof = tempfile.mkdtemp(prefix="zoom-")
    proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             "--remote-debugging-port=%d" % port,
                             "--user-data-dir=%s" % prof, "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cdp = None
    out = {}
    try:
        page = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port)
                    if t.get("type") == "page")
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        pg = Page(cdp)
        pg.viewport(1440, 900)

        # ---- 1 场景直开：滚轮三档
        cdp.call("Page.navigate", {"url": BASE + "/static/scenes/duty.html"})
        time.sleep(3.4)
        rows = []
        for dy in (-260, -260, -260, 260, 260, 260, 260, 260, 260, 260):
            wheel(cdp, 720, 470, dy)
            time.sleep(0.12)
            s = pg.js("window.__mini.stats()")
            rows.append({"dy": dy, "camDist": s["camDist"], "yaw": s["yaw"]})
        rows.append({"after": pg.js("window.__mini.info()")})
        out["sceneWheel"] = rows
        print("场景滚轮档位：", json.dumps(rows, ensure_ascii=False))
        for tag, d in (("min", 0), ("def", 13), ("max", 999)):
            if tag != "def":
                pg.js("window.__mini.setCam({dist:%d, pitch:0.62, focus:[0,0.8,0]})" % (4 if tag == "min" else 999))
            else:
                pg.js("window.__mini.setCam({dist:13, pitch:0.58})")
            time.sleep(1.0)
            pg.shot(str(OUT / ("ZOOM_%s.png" % tag)))
            out["scene_" + tag] = pg.js("window.__mini.info()")
        # 上限本身也读一次（不算 clamp 后的越界值）
        out["sceneClamp"] = pg.js("window.__mini.setCam({dist:999}); window.__mini.info()")
        print("场景 dist 上限：", out["sceneClamp"])

        # ---- 2 外壳：转场落位
        cdp.call("Page.navigate", {"url": BASE + "/static/app.html"})
        pg.wait_for("!!(window.__app && window.__app.boot)", 25)
        time.sleep(1.0)
        pt = pg.js("(() => { const T = window.__dbg.THREE; const b = window.__app.boot.layout()[0];"
                   " const v = new T.Vector3(b.x, b.y, b.z).project(window.__app.camera);"
                   " return { x: Math.round((v.x*.5+.5)*innerWidth),"
                   "          y: Math.round((-v.y*.5+.5)*innerHeight) }; })()")
        for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
            p = {"type": kind, "x": pt["x"], "y": pt["y"]}
            if kind != "mouseMoved":
                p.update({"button": "left", "clickCount": 1})
            cdp.call("Input.dispatchMouseEvent", p)
            time.sleep(0.05)
        pg.wait_for("!!window.__app.state.started", 70)
        pg.wait_for("window.__app.state.cam === 'play'", 20)
        time.sleep(0.8)
        st = pg.js("""(() => { const c = window.__app.camera;
          const T = window.__dbg.THREE, v = new T.Vector3(); c.getWorldDirection(v);
          const w = document.getElementById('frame').contentWindow;
          const a = w.__mini.actorPos();
          const d = Math.hypot(a.x - c.position.x, -c.position.y, a.z - c.position.z);
          const pitch = Math.asin(Math.max(-1, Math.min(1, -v.y)));
          return { mode: window.__app.state.mode, cam: window.__app.state.cam,
                   pos: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)],
                   pitch: +pitch.toFixed(3), distToActor: +d.toFixed(2) }; })()""")
        out["firstLand"] = st
        print("首屏落地（duty）：", json.dumps(st, ensure_ascii=False))

        # 传送到院墙：落位那一帧
        pg.js("window.__app.teleport('wall'); true")
        landed = None
        t0 = time.time()
        while time.time() - t0 < 24:
            s = pg.js("""(() => { const c = window.__app.camera;
              const T = window.__dbg.THREE, v = new T.Vector3(); c.getWorldDirection(v);
              const w = document.getElementById('frame').contentWindow;
              const a = (w && w.__mini) ? w.__mini.actorPos() : null;
              return { mode: window.__app.state.mode, cam: window.__app.state.cam,
                       y: +c.position.y.toFixed(2),
                       pitch: +Math.asin(Math.max(-1, Math.min(1, -v.y))).toFixed(3),
                       dist: a ? +Math.hypot(a.x - c.position.x, -c.position.y, a.z - c.position.z).toFixed(2) : null }; })()""")
            if s and s["mode"] == "FOLLOW" and s["cam"] == "play":
                landed = s
                break
            time.sleep(0.15)
        out["land"] = landed
        print("传送落位（wall）：", json.dumps(landed, ensure_ascii=False))
        pg.shot(str(OUT / "ZOOM_land_wall.png"))

        # 落位后：滚轮一路拉远，看能不能到上限、画面有没有整块底座
        dists = []
        for _ in range(14):
            wheel(cdp, 720, 470, 260)
            time.sleep(0.08)
            v = pg.js("window.__app.flight.view")
            d = math.dist(v["pos"], v["look"])
            dists.append(round(d, 2))
        out["shellZoomOut"] = dists
        print("外壳拉远序列：", dists)
        pg.shot(str(OUT / "ZOOM_shell_max.png"))
        # 拉近到下限
        for _ in range(24):
            wheel(cdp, 720, 470, -260)
            time.sleep(0.06)
        v = pg.js("window.__app.flight.view")
        out["shellMin"] = round(math.dist(v["pos"], v["look"]), 2)
        print("外壳最近距离：", out["shellMin"])
        out["shellMode"] = pg.js("({mode:window.__app.state.mode, cam:window.__app.state.cam})")
        print("落位后状态：", out["shellMode"])

        (OUT / "ZOOM_report.json").write_text(json.dumps(out, ensure_ascii=False, indent=2),
                                              encoding="utf-8")
        return 0
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


if __name__ == "__main__":
    sys.exit(main())
