# -*- coding: utf-8 -*-
"""首屏 / 手机 / 问话 面板的串联冒烟探针（真实鼠标）。"""
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
LOGS = ROOT / "tools" / "_logs"


def click(cdp, x, y):
    for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
        p = {"type": kind, "x": x, "y": y}
        if kind != "mouseMoved":
            p.update({"button": "left", "clickCount": 1})
        cdp.call("Input.dispatchMouseEvent", p)
        time.sleep(0.04)


edge = find_edge()
port = free_port()
prof = tempfile.mkdtemp(prefix="smoke-")
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
    ok = pg.wait_for("!!(window.__app && window.__app.boot)", 25)
    time.sleep(1.2)
    print("BOOT:", json.dumps(pg.js("""(() => ({
      app: !!window.__app, err: window.__err || '', mode: window.__app && window.__app.state.mode,
      boot: !!(window.__app && window.__app.boot),
      layout: window.__app ? window.__app.boot.layout() : null,
      gate: !!document.getElementById('gate'),
      phoneBtn: (() => { const b = document.querySelector('.tp-launch');
        if (!b) return null; const cs = getComputedStyle(b);
        return { vis: cs.visibility, op: cs.opacity, pe: cs.pointerEvents }; })()
    }))()"""), ensure_ascii=False))
    pg.shot(str(LOGS / "new_boot.png"))

    board = pg.js("window.__app.boot.layout()[0]")
    pt = pg.js("(() => { const w = window.__app; const T = window.__dbg.THREE;"
               " const b = w.boot.layout()[0]; const v = new T.Vector3(b.x,b.y,b.z).project(w.camera);"
               " return { x: Math.round((v.x*.5+.5)*innerWidth), y: Math.round((-v.y*.5+.5)*innerHeight) }; })()")
    print("start board at", pt)
    click(cdp, pt["x"], pt["y"])
    time.sleep(0.5)
    print("AFTER CLICK:", json.dumps(pg.js("""(() => ({
      loadOn: document.getElementById('load').classList.contains('on'),
      loadHidden: document.getElementById('load').hidden,
      started: window.__app.state.started,
      err: window.__err || ''
    }))()"""), ensure_ascii=False))
    pg.shot(str(LOGS / "new_loading.png"))
    pg.wait_for("!!window.__app.state.started", 70)
    pg.wait_for("window.__app.state.cam === 'play'", 12)
    time.sleep(0.8)
    print("IN SCENE:", json.dumps(pg.js("""(() => ({
      sceneId: window.__app.state.sceneId, cam: window.__app.state.cam,
      phoneBtn: (() => { const b = document.querySelector('.tp-launch');
        if (!b) return null; const cs = getComputedStyle(b);
        return { vis: cs.visibility, op: cs.opacity, pe: cs.pointerEvents }; })(),
      err: window.__err || ''
    }))()"""), ensure_ascii=False))
    pg.shot(str(LOGS / "new_scene.png"))

    # 直接开问话面板（duty 里没有可点的人，走对外入口）
    got = pg.js("window.__app.openDialog('p_a').then(d => d ? { topics: d.el.querySelectorAll('.dlg-topic').length } : null)")
    time.sleep(0.5)
    print("DIALOG:", json.dumps(got, ensure_ascii=False), "state.dialog:", pg.js("!!window.__app.dialog"))
    print("PANEL:", json.dumps(pg.js("""(() => {
      const c = document.querySelector('.dlg-card');
      if (!c) return null;
      return { name: c.querySelector('.dlg-name').textContent,
               role: c.querySelector('.dlg-role').textContent,
               topics: Array.from(c.querySelectorAll('.dlg-topic strong')).map(x => x.textContent),
               asks: Array.from(c.querySelectorAll('.dlg-topic small')).map(x => x.textContent),
               count: c.querySelector('.dlg-count').textContent };
    })()"""), ensure_ascii=False))
    pg.shot(str(LOGS / "new_dialog.png"))

    # 点第一个话题，等回答
    pg.js("document.querySelector('.dlg-topic').click(); true")
    pg.wait_for("document.querySelectorAll('.dlg-msg').length >= 2", 12)
    time.sleep(0.4)
    print("ANSWER:", json.dumps(pg.js("""(() => ({
      msgs: Array.from(document.querySelectorAll('.dlg-msg')).map(m => ({
        role: m.className.includes('--me') ? 'me' : 'them',
        text: m.querySelector('.dlg-bubble').textContent.slice(0, 80),
        note: (m.querySelector('.dlg-note') || {}).textContent || ''
      })),
      nodes: window.__app.state.nodes.slice(-2),
      notes: window.__app.phone.getNotes().length
    }))()"""), ensure_ascii=False))
    pg.shot(str(LOGS / "new_answer.png"))

    # Esc 关闭
    cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape",
                                        "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27})
    cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape", "code": "Escape",
                                        "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27})
    time.sleep(0.5)
    print("CLOSED:", json.dumps(pg.js("""(() => ({
      panel: !!document.querySelector('.dlg-card'), dialog: !!window.__app.dialog,
      cam: window.__app.state.cam, play: window.__app.state.cam === 'play',
      err: window.__err || ''
    }))()"""), ensure_ascii=False))
    print("FINAL ERR:", pg.js("window.__err || ''"))
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
