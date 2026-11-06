# -*- coding: utf-8 -*-
"""姓名牌 / 人物建模的机位截图（验收用）。

每个场景三档机位：
  1 近景 —— 站到当事人正前方 5m、抬一点俯角，能看清脸、头发、五官和头顶名牌；
  2 中景 —— 场景默认视角附近（13~20m），验证"隔几米还看得清名字"；
  3 远景 —— 拉到上限 40m，验证整块底座进画面、标签淡出后仍然可读。

用法：
    python tools/_shot_names.py duty wall court
    python tools/_shot_names.py duty wall court --zoom   # 追加 4/13/40 三档缩放
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
OUT = ROOT / "tools" / "_logs"

# 每个场景的近景对象：有 personId 的最好（名牌带珊瑚条），没有就取第一个人
SHOT_JS = r"""(name, scaleMode) => null"""


def js_find(slug: str) -> str:
    return r"""(() => {
      const mini = window.__mini;
      const T = window.__dbg.THREE, sc = window.__dbg.scene;
      let g = null, pid = '';
      sc.traverse((o) => {
        const u = o.userData || {};
        if (g || !u.personId) return;
        let p = o;
        while (p && !(p.userData && 'baseY' in p.userData)) p = p.parent;
        if (!p) return;
        g = p; pid = u.personId;
      });
      if (!g) return null;
      const v = new T.Vector3(); g.getWorldPosition(v);
      return { pid, x: +v.x.toFixed(2), z: +v.z.toFixed(2),
               facing: +g.rotation.y.toFixed(3), head: +g.userData.headTop.toFixed(3),
               plates: mini.plates() };
    })()"""


def main() -> int:
    scenes = [a for a in sys.argv[1:] if not a.startswith("-")] or ["duty", "wall", "court"]
    zoom = "--zoom" in sys.argv
    edge = find_edge()
    if not edge:
        print("找不到 Edge/Chrome")
        return 2
    port = free_port()
    prof = tempfile.mkdtemp(prefix="names-")
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
        report = {}
        for slug in scenes:
            cdp.call("Page.navigate", {"url": "%s/static/scenes/%s.html" % (BASE, slug)})
            time.sleep(3.6)
            err = pg.js("window.__err || ''")
            if err:
                print("[%s] 报错：%s" % (slug, err))
            who = pg.js(js_find(slug))
            if not who:
                print("[%s] 没有人物" % slug)
                continue
            info = pg.js("window.__mini.info()")
            print("[%s] info=%s  近景对象=%s" % (slug, json.dumps(info), who["pid"]))
            # 近景让主角站到一边、且钉住视点：否则相机跟随会把人从取景框里拽走
            pg.js("window.__mini.setActor(%r, %r); window.__mini.hideActor(true);"
                  " window.__mini.setCam({lock:true}); true"
                  % (who["x"] + 2.4, who["z"] + 2.4))
            # 1 近景：站到人物正前方 5m，视线落在胸口上一点
            pg.js("window.__mini.setCam({yaw:%r, pitch:0.30, dist:5.0, focus:[%r,1.15,%r]})"
                  % (who["facing"], who["x"], who["z"]))
            time.sleep(1.4)
            pg.shot(str(OUT / ("NAME_%s_1.png" % slug)))
            plates1 = pg.js("window.__mini.plates()")
            # 2 中景：场景默认附近
            pg.js("window.__mini.setCam({yaw:%r, pitch:0.58, dist:13.5, focus:[%r,1.0,%r]})"
                  % (who["facing"] + 0.55, who["x"], who["z"]))
            time.sleep(1.2)
            pg.shot(str(OUT / ("NAME_%s_2.png" % slug)))
            plates2 = pg.js("window.__mini.plates()")
            # 3 远景：上限 36m，看整块底座
            pg.js("window.__mini.setCam({yaw:0.42, pitch:0.72, dist:36, focus:[0,0.6,0]})")
            time.sleep(1.4)
            pg.shot(str(OUT / ("NAME_%s_3.png" % slug)))
            plates3 = pg.js("window.__mini.plates()")
            # 4 淡出档（24m 机位 → 水平约 21m）：刚过 18m 阈值，看淡出后还读不读得出
            pg.js("window.__mini.setCam({yaw:%r, pitch:0.30, dist:21, focus:[%r,1.35,%r]})"
                  % (who["facing"] + 0.25, who["x"], who["z"]))
            time.sleep(1.2)
            pg.shot(str(OUT / ("NAME_%s_4.png" % slug)))
            plates4 = pg.js("window.__mini.plates()")
            report[slug] = {"info": info, "target": who["pid"],
                            "near": plates1, "mid": plates2, "far": plates3, "fade": plates4}
            print("  近景 plates=%s" % json.dumps(plates1, ensure_ascii=False))
            print("  中景 plates=%s" % json.dumps(plates2, ensure_ascii=False))
            print("  远景 plates=%s" % json.dumps(plates3, ensure_ascii=False))
            print("  淡出 plates=%s" % json.dumps(plates4, ensure_ascii=False))
            if zoom:
                for tag, d in (("min4", 4), ("def13", 13), ("max36", 36)):
                    pg.js("window.__mini.setCam({yaw:0.42, pitch:0.62, dist:%r, focus:[0,0.8,0]})" % d)
                    time.sleep(1.2)
                    pg.shot(str(OUT / ("NAME_%s_zoom_%s.png" % (slug, tag))))
        (OUT / "NAME_report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
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
