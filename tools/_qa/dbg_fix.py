# -*- coding: utf-8 -*-
"""验证修法：把人物组挂回 pickable（scene3d 里被 scene.add 抢走了父节点），
不改任何源文件，只在页面里跑一次修复 JS，再用真实鼠标点人看面板出不出。"""
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

REPAIR = """(() => {
  const w = document.getElementById('frame').contentWindow;
  if (!w || !w.__dbg || w.__pickFixed) return { skip: true };
  const sc = w.__dbg.scene;
  // pickable = 装着所有家具（userData.propId）的那个顶层 Group
  let pick = null;
  for (const c of sc.children) {
    if (!c.isGroup) continue;
    let hasProp = false;
    c.traverse((o) => { if ((o.userData || {}).propId) hasProp = true; });
    if (hasProp) { pick = c; break; }
  }
  if (!pick) return { err: 'no-pickable' };
  // 人物组：父节点是 scene、子树里有 personId 的顶层组
  const moved = [];
  for (const c of sc.children.slice()) {
    if (!c.isGroup) continue;
    let pid = null;
    c.traverse((o) => { if (!pid && (o.userData || {}).personId) pid = o.userData.personId; });
    if (pid) { pick.add(c); moved.push(pid); }
  }
  w.__pickFixed = true;
  return { moved, pickKids: pick.children.length };
})()"""

edge = find_edge()
port = free_port()
prof = tempfile.mkdtemp(prefix="dbgfix-")
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
    time.sleep(0.8)

    print("repair:", json.dumps(pg.js(REPAIR), ensure_ascii=False), flush=True)
    tg = pg.js(Q.JS_TARGETS)
    p = [x for x in tg["people"] if x["id"] == "p_b"][0]
    print("p_b:", p["pt"], p["first"], flush=True)
    print("actor:", pg.js("(() => { const w=document.getElementById('frame').contentWindow;"
                          " return w.__mini.actorPos(); })()"), flush=True)
    Q.click(cdp, p["pt"][0], p["pt"][1], settle=0.3)
    for i in range(24):
        s = pg.js("""({ i: %d, actor: (() => { const w = document.getElementById('frame').contentWindow;
            return w.__mini.actorPos(); })(),
          st: (() => { const w = document.getElementById('frame').contentWindow;
            return w.__mini.stats(); })(),
          ev: (() => { const w = document.getElementById('frame').contentWindow;
            return (w.__events || []).slice(-2); })(),
          card: document.querySelectorAll('.dlg-card').length,
          topics: document.querySelectorAll('.dlg-card .dlg-topic').length,
          name: (document.querySelector('.dlg-card .dlg-name') || {}).textContent || '',
          nodes: window.__app.state.nodes.length,
          err: window.__err || null })""" % i)
        print(json.dumps(s, ensure_ascii=False), flush=True)
        if s["card"]:
            break
        time.sleep(0.4)
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
