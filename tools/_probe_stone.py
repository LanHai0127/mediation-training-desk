# -*- coding: utf-8 -*-
"""真实路径复现：点开始 → 加载 100% → 手机地图传送到院墙 → 鼠标点界石（s_stone）。

记录：目标像素上的 pickTargetAt 结果、goToProp 调用与返回值、actor 位移、
state.seen 变化、证据夹「已收集」数量、hint 文案。
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from test_app import CDP, Page, find_edge, free_port, wait_json  # noqa: E402
import qa_play as Q  # noqa: E402

BASE = "http://127.0.0.1:8770"


def main() -> int:
    edge = find_edge()
    if not edge:
        print("找不到 Edge/Chrome")
        return 2
    port = free_port()
    prof = tempfile.mkdtemp(prefix="stone-")
    proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             "--remote-debugging-port=%d" % port,
                             "--user-data-dir=%s" % prof, "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cdp = None
    try:
        page = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port)
                    if t.get("type") == "page")
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        pg = Page(cdp)
        pg.viewport(1440, 900)
        cdp.call("Page.navigate", {"url": BASE + "/static/app.html"})
        pg.wait_for("!!(window.__app && window.__app.boot)", 25)
        time.sleep(1.0)
        pt = pg.js("(() => { const T = window.__dbg.THREE; const b = window.__app.boot.layout()[0];"
                   " const v = new T.Vector3(b.x,b.y,b.z).project(window.__app.camera);"
                   " return {x: Math.round((v.x*.5+.5)*innerWidth), y: Math.round((-v.y*.5+.5)*innerHeight)}; })()")
        for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
            p = {"type": kind, "x": pt["x"], "y": pt["y"]}
            if kind != "mouseMoved":
                p.update({"button": "left", "clickCount": 1})
            cdp.call("Input.dispatchMouseEvent", p)
            time.sleep(0.05)
        pg.wait_for("!!window.__app.state.started", 70)
        pg.wait_for("window.__app.state.cam === 'play'", 25)
        print("进入首场:", pg.js("window.__app.state.sceneId"), "seen:", pg.js("[...window.__app.state.seen]"))

        # 真实路径：手机 → 地图 → 院墙
        pg.js("window.__app.phone.open(); window.__app.phone.openPage('map'); true")
        time.sleep(0.5)
        rows = pg.js("""(() => { const out = [];
          document.querySelectorAll('.tp-page[data-page="map"] .tp-scene').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || el.tagName !== 'BUTTON') return;
            out.push({ t: (el.textContent || '').trim().slice(0, 8),
                       x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); });
          return out; })()""")
        target = next((r for r in rows if "院墙" in r["t"]), None)
        print("地图行:", json.dumps(rows, ensure_ascii=False))
        if not target:
            return 1
        Q.click(cdp, target["x"], target["y"], settle=0.3)
        pg.wait_for("window.__app.state.sceneId === 'wall' && window.__app.state.mode === 'FOLLOW'"
                    " && window.__app.state.cam === 'play'", 30)
        time.sleep(1.2)
        print("传送到院墙:", pg.js("window.__app.state.sceneId"), "mode:", pg.js("window.__app.state.mode"))

        # 打桩记录 goToProp
        pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          if (!w.__gtPatched) { w.__gtPatched = true; const of = w.__mini.goToProp;
            w.__gtCalls = []; w.__mini.goToProp = function (id) {
              const r = of.apply(this, arguments);
              w.__gtCalls.push({ id: id, ret: r });
              return r;
            }; } return true; })()""")

        tgt = pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
          const T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
          let holder = null;
          sc.traverse((o) => { if (!holder && o.userData && o.userData.propId === 's_stone') {
            let p = o; while (p.parent && !(p.userData && p.userData.propId)) p = p.parent; holder = p; } });
          if (!holder) return null;
          const bb = new T.Box3().setFromObject(holder);
          const c = new T.Vector3(); bb.getCenter(c);
          const pr = c.clone().project(cam);
          const a = w.__mini.actorPos();
          return { sx: Math.round((pr.x*.5+.5)*w.innerWidth), sy: Math.round((-pr.y*.5+.5)*w.innerHeight),
                   center: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
                   actor: [+a.x.toFixed(2), +a.z.toFixed(2)],
                   cam: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)] }; })()""")
        print("界石屏幕位置:", json.dumps(tgt, ensure_ascii=False))
        hit = pg.js(Q.JS_TARGETS.replace("__PLACEHOLDER__", "")) if False else pg.js(
            """(() => { const w = document.getElementById('frame').contentWindow;
              const T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
              const x = %d, y = %d;
              const ndc = new T.Vector2((x / w.innerWidth) * 2 - 1, -(y / w.innerHeight) * 2 + 1);
              const rc = new T.Raycaster(); rc.setFromCamera(ndc, cam);
              const hs = rc.intersectObjects(sc.children, true);
              const out = [];
              for (const h of hs.slice(0, 5)) out.push({ id: h.object.userData && (h.object.userData.propId || h.object.userData.personId || h.object.userData.nameplateFor || ''),
                                                         d: +h.distance.toFixed(2), type: h.object.type });
              const el = window.__app && window.__app.pickTargetAt ? 'host' : 'no';
              return { hits: out, el: el }; })()""" % (tgt["sx"], tgt["sy"]))
        print("该像素命中:", json.dumps(hit, ensure_ascii=False))

        seen0 = pg.js("[...window.__app.state.seen]")
        nodes0 = pg.js("window.__app.state.nodes.length")
        print("点之前 seen:", seen0, "nodes:", nodes0, "hint:", pg.js("document.getElementById('hint').textContent.trim()"))
        Q.click(cdp, tgt["sx"], tgt["sy"], settle=0.3)
        time.sleep(0.4)
        print("点后 0.4s: gtCalls=", pg.js("document.getElementById('frame').contentWindow.__gtCalls"),
              "walking=", pg.js("document.getElementById('frame').contentWindow.__mini.stats().walking"),
              "hint=", pg.js("document.getElementById('hint').textContent.trim()"))
        time.sleep(4.5)
        print("点后 4.9s: seen=", pg.js("[...window.__app.state.seen]"),
              "nodes=", pg.js("window.__app.state.nodes.length"),
              "actor=", pg.js("""(() => { const w = document.getElementById('frame').contentWindow; const a = w.__mini.actorPos(); return [+a.x.toFixed(2), +a.z.toFixed(2)]; })()"""),
              "hint=", pg.js("document.getElementById('hint').textContent.trim()"))
        print("gtCalls:", pg.js("document.getElementById('frame').contentWindow.__gtCalls"))
        print("err:", pg.js("window.__err || ''"), pg.js("document.getElementById('frame').contentWindow.__err || ''"))
        pg.shot(str(ROOT / "tools" / "_logs" / "PROBE_stone_click.png"))
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
