# -*- coding: utf-8 -*-
"""点人 / 点姓名牌 = 直接开口 的现场探针（不入测试套件）。

验四件事：
  1. 点姓名牌：命中可交互人物、立刻发 person:click、主角不位移；
  2. 点身体：同样立刻开口、不位移；
  3. 布景人物的姓名牌不抢点击（raycast 关了）；
  4. `goToPerson` API 仍然走位（测试脚本与"寻路过去"还要用它）。
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

BASE = "http://127.0.0.1:8770"


def click(cdp, x, y):
    for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
        p = {"type": kind, "x": x, "y": y}
        if kind != "mouseMoved":
            p.update({"button": "left", "clickCount": 1})
        cdp.call("Input.dispatchMouseEvent", p)
        time.sleep(0.05)


JS_TARGET = r"""(pid) => {
  const w = window, T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
  let plate = null, root = null;
  sc.traverse((o) => {
    if (o.isSprite && o.userData && o.userData.nameplateFor === pid) plate = o;
    if (!root && o.userData && o.userData.personId === pid) {
      let p = o; while (p && !(p.userData && 'baseY' in p.userData)) p = p.parent;
      root = p;
    }
  });
  if (!plate || !root) return null;
  const W = w.innerWidth, H = w.innerHeight;
  const proj = (v) => {
    const p = v.clone().project(cam);
    return [Math.round((p.x * .5 + .5) * W), Math.round((-p.y * .5 + .5) * H)];
  };
  const pv = new T.Vector3(); plate.getWorldPosition(pv);
  const bb = new T.Box3(); root.traverse((o) => { if (o.isMesh && o.geometry) bb.expandByObject(o); });
  const c = new T.Vector3(); bb.getCenter(c);
  return { plate: proj(pv), body: proj(c),
           plateOp: plate.material.opacity,
           plateRaycast: plate.raycast.toString().indexOf('() => {}') >= 0,
           actor: [ +w.__mini.actorPos().x.toFixed(2), +w.__mini.actorPos().z.toFixed(2) ] };
}"""


def main() -> int:
    edge = find_edge()
    if not edge:
        print("找不到 Edge/Chrome")
        return 2
    port = free_port()
    prof = tempfile.mkdtemp(prefix="talk-")
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
        cdp.call("Page.navigate", {"url": BASE + "/static/scenes/duty.html"})
        time.sleep(3.6)
        print("场景:", pg.js("({mini: !!window.__mini, err: window.__err || ''})"))

        # Page.js 只能传表达式：把函数写成 IIFE
        def target(pid):
            return pg.js("(" + JS_TARGET + ")(" + json.dumps(pid) + ")")

        t = target("npc_young_man")
        print("young_man:", json.dumps(t, ensure_ascii=False))
        if not t:
            return 1
        pg.js("window.__events = []; true")
        pg.js("window.__mini.setCam({dist:11, pitch:0.55, focus:[4.4,1.0,1.4], lock:true})")
        time.sleep(0.8)
        t = target("npc_young_man")
        print("after cam:", json.dumps(t, ensure_ascii=False))
        # 悬停 → 指针
        cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": t["plate"][0], "y": t["plate"][1]})
        time.sleep(0.3)
        cur = pg.js("document.querySelector('#stage canvas').style.cursor")
        click(cdp, t["plate"][0], t["plate"][1])
        time.sleep(0.35)
        ev = pg.js("window.__events.slice()")
        a1 = pg.js("window.__mini.actorPos()")
        print("点姓名牌 → events:", json.dumps(ev, ensure_ascii=False), "cursor:", cur,
              "actor:", [round(a1["x"], 2), round(a1["z"], 2)])

        pg.js("window.__events = []; true")
        t2 = target("npc_young_man")
        click(cdp, t2["body"][0], t2["body"][1])
        time.sleep(0.35)
        ev_body_soon = pg.js("window.__events.slice()")
        time.sleep(2.6)
        ev_body = pg.js("window.__events.slice()")
        a2 = pg.js("window.__mini.actorPos()")
        print("点身体   → 立刻:", json.dumps(ev_body_soon, ensure_ascii=False),
              " 2.6s 后:", json.dumps(ev_body, ensure_ascii=False),
              "actor:", [round(a2["x"], 2), round(a2["z"], 2)])

        # goToPerson 仍然走位（API 兼容）
        pg.js("window.__events = []; true")
        pg.js("window.__mini.goToPerson('npc_young_man')")
        time.sleep(2.2)
        a3 = pg.js("window.__mini.actorPos()")
        ev3 = pg.js("window.__events.slice()")
        print("goToPerson → actor:", [round(a3["x"], 2), round(a3["z"], 2)],
              "events:", json.dumps(ev3, ensure_ascii=False))
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
