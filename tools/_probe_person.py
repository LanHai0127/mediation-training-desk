# -*- coding: utf-8 -*-
"""真实链路：点场景里的人 → 走近 → 问话面板 → 问一条 → Esc 关 → 继续走。"""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from test_app import CDP, Page, find_edge, free_port, wait_json  # noqa

URL = "http://127.0.0.1:8770/static/app.html"


def click(cdp, x, y):
    for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
        p = {"type": kind, "x": x, "y": y}
        if kind != "mouseMoved":
            p.update({"button": "left", "clickCount": 1})
        cdp.call("Input.dispatchMouseEvent", p)
        time.sleep(0.04)


JS_PERSON = r"""(() => {
  const w = document.getElementById('frame').contentWindow;
  const s = w.__dbg.scene;
  let g = null;
  s.traverse((o) => {
    if (g) return;
    if (o.userData && o.userData.personId === 'p_a') {
      let p = o; while (p.parent && p.parent !== s) p = p.parent;
      g = p;
    }
  });
  if (!g) return null;
  const v = new w.__dbg.THREE.Vector3();
  g.getWorldPosition(v);
  const c = v.clone(); c.y += 1.1;
  c.project(w.__dbg.camera);
  return { wx: +v.x.toFixed(2), wz: +v.z.toFixed(2),
           x: Math.round((c.x * .5 + .5) * innerWidth),
           y: Math.round((-c.y * .5 + .5) * innerHeight) };
})()"""

edge = find_edge()
port = free_port()
prof = tempfile.mkdtemp(prefix="person-")
proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                         "--no-first-run", "--no-default-browser-check",
                         "--remote-debugging-port=%d" % port,
                         "--user-data-dir=%s" % prof, "about:blank"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
cdp = None
try:
    page = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port) if t["type"] == "page")
    cdp = CDP(page["webSocketDebuggerUrl"])
    cdp.call("Page.enable")
    cdp.call("Runtime.enable")
    pg = Page(cdp)
    pg.viewport(1440, 900)
    cdp.call("Page.navigate", {"url": URL})
    pg.wait_for("!!(window.__app && window.__app.boot)", 25)
    time.sleep(0.9)
    # 点开始
    pt = pg.js("(() => { const T = window.__dbg.THREE; const b = window.__app.boot.layout()[0];"
               " const v = new T.Vector3(b.x, b.y, b.z).project(window.__app.camera);"
               " return { x: Math.round((v.x*.5+.5)*innerWidth), y: Math.round((-v.y*.5+.5)*innerHeight) }; })()")
    click(cdp, pt["x"], pt["y"])
    pg.wait_for("!!window.__app.state.started", 70)
    pg.js("window.__app.enterScene('court'); true")
    pg.wait_for("window.__app.state.cam === 'play'", 25)
    time.sleep(1.2)

    person = pg.js(JS_PERSON)
    print("p_a 屏幕位置:", person)
    print("相机:", pg.js("""(() => { const w = document.getElementById('frame').contentWindow;
      const c = w.__dbg.camera;
      const v = new w.__dbg.THREE.Vector3(); c.getWorldDirection(v);
      return { pos: c.position.toArray().map(n=>+n.toFixed(2)),
               dir: v.toArray().map(n=>+n.toFixed(2)), fov: c.fov }; })()"""))
    if not person:
        print("找不到 p_a")
        sys.exit(1)
    actor0 = pg.js("(() => { const w = document.getElementById('frame').contentWindow;"
                   " return w.__mini.stats().actorXZ; })()")
    print("debugPath:", pg.js("(() => { const w = document.getElementById('frame').contentWindow;"
                              " return w.__mini.debugPath(1.4, 3.05); })()"))
    click(cdp, person["x"], person["y"])
    shown = pg.wait_for("!!document.querySelector('.dlg-card')", 8)
    time.sleep(0.35)
    actor1 = pg.js("(() => { const w = document.getElementById('frame').contentWindow;"
                   " return w.__mini.stats().actorXZ; })()")
    panel = pg.js("""(() => {
      const c = document.querySelector('.dlg-card');
      if (!c) return null;
      return { name: c.querySelector('.dlg-name').textContent,
               role: c.querySelector('.dlg-role').textContent,
               topics: Array.from(c.querySelectorAll('.dlg-topic strong')).map(x => x.textContent),
               asks: Array.from(c.querySelectorAll('.dlg-topic small')).map(x => x.textContent) };
    })()""")
    print("actor:", actor0, "->", actor1, "panel:", json.dumps(panel, ensure_ascii=False))
    pg.shot(str(ROOT / "tools" / "_logs" / "person_panel.png"))

    pg.js("document.querySelector('.dlg-topic').click(); true")
    pg.wait_for("document.querySelectorAll('.dlg-msg').length >= 2", 12)
    time.sleep(0.3)
    ans = pg.js("""(() => ({
      msgs: Array.from(document.querySelectorAll('.dlg-msg')).map(m => m.querySelector('.dlg-bubble').textContent),
      nodes: window.__app.state.nodes.slice(-1),
      notes: window.__app.phone.getNotes().length
    }))()""")
    print("answer:", json.dumps(ans, ensure_ascii=False))
    pg.shot(str(ROOT / "tools" / "_logs" / "person_answer.png"))

    cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape",
                                        "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27})
    cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape",
                                        "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27})
    time.sleep(0.45)
    print("closed:", pg.js("({panel: !!document.querySelector('.dlg-card'),"
                           " dialog: !!window.__app.dialog, cam: window.__app.state.cam})"))
    # 关掉后继续走：点一块地面
    pt2 = pg.js("(() => { const w = document.getElementById('frame').contentWindow;"
                " const T = w.__dbg.THREE; const v = new T.Vector3(-1.0, 0.02, 5.2).project(w.__dbg.camera);"
                " return { x: Math.round((v.x*.5+.5)*innerWidth), y: Math.round((-v.y*.5+.5)*innerHeight) }; })()")
    b2 = pg.js("(() => { const w = document.getElementById('frame').contentWindow; return w.__mini.stats().actorXZ; })()")
    click(cdp, pt2["x"], pt2["y"])
    time.sleep(1.4)
    a2 = pg.js("(() => { const w = document.getElementById('frame').contentWindow; return w.__mini.stats().actorXZ; })()")
    print("walk after close:", b2, "->", a2)
    print("ERR:", pg.js("window.__err || ''"))
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
