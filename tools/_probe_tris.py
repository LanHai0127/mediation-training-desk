# -*- coding: utf-8 -*-
"""人物建模 / 姓名标签的量化探针（不入测试套件）。

做三件事：
  1. `__mini.info()` 的渲染面数（与测试断言同一个口子）；
  2. 全场景几何三角面合计（走 traverse，和机位无关，能横向比"十场涨没涨"）；
  3. 每个人物的三角面 / 包围盒高度（label 要挂在头顶，不能拍脑袋给 y）。

用法：
    python tools/_probe_tris.py                     # duty
    python tools/_probe_tris.py duty wall court     # 多场
    python tools/_probe_tris.py duty --shot         # 顺手存一张截图
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

JS_STATS = r"""(() => {
  const w = window;
  const mini = w.__mini;
  const THREE = w.__dbg.THREE, sc = w.__dbg.scene;
  const info = mini.info();
  let total = 0, meshes = 0, sprites = 0;
  const seen = new Set();
  sc.traverse((o) => {
    if (o.isMesh && o.geometry) {
      meshes += 1;
      const g = o.geometry;
      const n = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      total += n / 3;
    }
    if (o.isSprite) sprites += 1;
  });
  const people = [];
  const byId = new Map();
  sc.traverse((o) => {
    const u = o.userData || {};
    if (!u.personId) return;
    // 人物根节点是 makePerson 造的 Group：它身上有 userData.baseY 这个标记。
    // 往上一路爬到它，不能再往上（pickable 是所有道具的父级，会把整场算成一个人）。
    let g = o;
    while (g && !(g.userData && 'baseY' in g.userData)) { g = g.parent; }
    if (!g || !(g.userData && 'baseY' in g.userData)) return;
    byId.set(u.personId, g);
  });
  for (const [id, g] of byId) {
    let tris = 0, rm = 0;
    const bb = new THREE.Box3();
    g.traverse((o) => {
      const u = o.userData || {};
      if (o.isMesh && o.geometry) {
        const gg = o.geometry;
        const n = gg.index ? gg.index.count : (gg.attributes.position ? gg.attributes.position.count : 0);
        tris += n / 3; rm += 1;
      }
    });
    bb.setFromObject(g);
    people.push({ id, tris, meshes: rm,
                  minY: +bb.min.y.toFixed(3), maxY: +bb.max.y.toFixed(3),
                  x: +g.position.x.toFixed(2), z: +g.position.z.toFixed(2),
                  sit: !!g.userData.sit });
  }
  return { info, total: Math.round(total), meshes, sprites, people };
})()"""


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    shot = "--shot" in sys.argv
    scenes = args or ["duty"]
    edge = find_edge()
    if not edge:
        print("找不到 Edge/Chrome")
        return 2
    port = free_port()
    prof = tempfile.mkdtemp(prefix="tris-")
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
        out = {}
        for slug in scenes:
            cdp.call("Page.navigate", {"url": "%s/static/scenes/%s.html" % (BASE, slug)})
            time.sleep(3.4)
            err = pg.js("window.__err || ''")
            if err:
                print("%s 报错：%s" % (slug, err))
            s = pg.js(JS_STATS)
            if not s:
                print("%s 没有 __mini" % slug)
                continue
            out[slug] = s
            print("===== %s" % slug)
            print("  info   : %s" % json.dumps(s["info"], ensure_ascii=False))
            print("  total  : %d 三角面 / %d mesh / %d sprite" % (s["total"], s["meshes"], s["sprites"]))
            for p in s["people"]:
                print("  person : %s tris=%-5d meshes=%-3d y=[%s,%s] at (%s,%s)%s"
                      % (p["id"], p["tris"], p["meshes"], p["minY"], p["maxY"],
                         p["x"], p["z"], " 坐" if p["sit"] else ""))
            if shot:
                pg.shot(str(ROOT / "tools" / "_logs" / ("tris_%s.png" % slug)))
        (ROOT / "tools" / "_logs" / "tris.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
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
