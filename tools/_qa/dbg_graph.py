# -*- coding: utf-8 -*-
"""排查 5：人物是否真的挂在 pickable 下（点人失效的根因）；顺带验物件点击。"""
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

edge = find_edge()
port = free_port()
prof = tempfile.mkdtemp(prefix="dbg5-")
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

    print("=== 场景图：人物 vs 物件 的父链 ===", flush=True)
    print(json.dumps(pg.js("""(() => {
      const w = document.getElementById('frame').contentWindow;
      const sc = w.__dbg.scene;
      let person = null, prop = null;
      sc.traverse((o) => {
        const u = o.userData || {};
        if (!person && u.personId === 'p_b') person = o;
        if (!prop && u.propId === 's_stone') prop = o;
      });
      const chain = (o) => { const a = []; let p = o;
        while (p) { a.push(p.type + (p.name ? ':' + p.name : '')
          + '(kids=' + p.children.length + ')'); p = p.parent; } return a; };
      // 顶层分组里谁装着人物、谁装着物件
      const tops = sc.children.map((c) => {
        let hasPerson = false, hasProp = false;
        c.traverse((o) => { const u = o.userData || {};
          if (u.personId) hasPerson = true; if (u.propId) hasProp = true; });
        return { type: c.type, name: c.name, kids: c.children.length, hasPerson, hasProp };
      });
      return { personChain: chain(person), propChain: chain(prop), tops };
    })()"""), ensure_ascii=False, indent=1), flush=True)

    print("=== 点物件 s_stone（应该能走 + 记证据）===", flush=True)
    tg = pg.js(Q.JS_TARGETS)
    stone = [p for p in tg["props"] if p["id"] == "s_stone"][0]
    print("stone:", stone, flush=True)
    seen0 = pg.js("window.__app.state.seen.size")
    Q.click(cdp, stone["pt"][0], stone["pt"][1], settle=0.3)
    got = Q.poll(pg, "(() => { const a = window.__app.state;"
                     " return a.seen.size > %d ? [...a.seen] : null; })()" % seen0, 10)
    print("seen:", seen0, "->", got, flush=True)
    print("nodes:", pg.js("window.__app.state.nodes.map(n => [n.id, n.tag])"), flush=True)
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
