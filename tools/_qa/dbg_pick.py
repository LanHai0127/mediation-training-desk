# -*- coding: utf-8 -*-
"""排查 9b：同一个屏幕点上，pickable 射线 vs 整场景射线，到底差在哪。"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import qa_play as Q  # noqa: E402
from test_app import CDP, Page, find_edge, free_port, wait_json  # noqa: E402

JS = """(() => {
  const w = document.getElementById('frame').contentWindow;
  const T = w.__dbg.THREE, cam = w.__dbg.camera, sc = w.__dbg.scene;
  const W = innerWidth, H = innerHeight;
  const box = new T.Box3(), tmp = new T.Vector3();
  sc.traverse((o) => { if ((o.userData || {}).propId === 's_stone') box.expandByObject(o); });
  box.getCenter(tmp);
  const p = tmp.clone().project(cam);
  const pt = [Math.round((p.x * .5 + .5) * W), Math.round((-p.y * .5 + .5) * H)];
  const ndc = new T.Vector2((pt[0] / W) * 2 - 1, -(pt[1] / H) * 2 + 1);
  const rc = new T.Raycaster();
  rc.setFromCamera(ndc, cam);
  const all = rc.intersectObjects(sc.children, true);
  // 找 pickable：装着家具（propId）的顶层组
  let pick = null;
  for (const c of sc.children) {
    if (!c.isGroup) continue;
    let n = 0;
    c.traverse((o) => { if ((o.userData || {}).propId) n += 1; });
    if (n > 5) { pick = c; break; }
  }
  const inPick = pick ? rc.intersectObjects(pick.children, true) : [];
  const desc = (h) => ({ id: (h.object.userData || {}).propId
      || (h.object.userData || {}).personId || null, d: +h.distance.toFixed(2) });
  return { pt, canvasRect: w.__dbg.renderer.domElement.getBoundingClientRect().toJSON(),
           innerW: W, innerH: H,
           pickKids: pick ? pick.children.length : -1,
           pickParent: pick && pick.parent ? pick.parent.type : null,
           allHits: all.slice(0, 5).map(desc),
           pickHits: inPick.slice(0, 5).map(desc),
           inPickCount: inPick.length };
})()"""

edge = find_edge()
port = free_port()
prof = tempfile.mkdtemp(prefix="dbg9b-")
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
    Q.boot(cdp, pg)
    Q.s2_start(cdp, pg)
    pg.wait_for("window.__app.state.started", 60)
    time.sleep(1.6)
    Q.s8_teleport(cdp, pg)
    time.sleep(1.4)
    print(json.dumps(pg.js(JS), ensure_ascii=False, indent=1), flush=True)
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
