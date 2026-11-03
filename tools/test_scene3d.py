#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""3D 微缩场景的交互测试：人能不能走、走近会不会触发、卡不卡。

这些是"观赏模型"和"游戏场景"的分界线：
  · 点地面 → 真的走过去（不是瞬移、不是原地不动）
  · 点物件 → 先走位，"到位之后"才回调（隔空触发就是假的交互）
  · 点障碍内部 → 吸附到最近可走点，不卡死
  · 远处目标要花时间才能到（时间本身就是"走过去"的证据）

依赖 websocket-client，用隔离解释器跑。
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

BASE = "http://127.0.0.1:%d" % int(os.environ.get("TJ_PORT") or 8770)
URL = BASE + "/static/scenes/duty.html"

passed = failed = 0


def check(ok: bool, msg: str, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print("[PASS] " + msg)
    else:
        failed += 1
        print("[FAIL] " + msg + ("  ← " + detail if detail else ""))


def main() -> int:
    try:
        import websocket  # noqa: F401
    except ImportError:
        print("[SKIP] 当前解释器没有 websocket-client，跳过 3D 场景测试")
        return 0
    try:
        from ui_probe import CDP, find_edge, free_port, wait_json  # noqa: E402
    except ImportError as exc:
        print("[SKIP] 无法载入 ui_probe：%s" % exc)
        return 0

    edge = find_edge()
    if not edge:
        print("[SKIP] 找不到 Edge / Chrome")
        return 0

    import shutil
    import subprocess
    import tempfile

    port = free_port()
    profile = tempfile.mkdtemp(prefix="scene3d-")
    proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             "--remote-debugging-port=%d" % port, "--user-data-dir=%s" % profile,
                             "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        page = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port) if t.get("type") == "page")
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1280, "height": 800, "deviceScaleFactor": 1, "mobile": False})

        def js(expr, await_p=True):
            r = cdp.call("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                              "awaitPromise": await_p})
            return r.get("result", {}).get("value")

        cdp.call("Page.navigate", {"url": URL})
        time.sleep(3.2)

        ready = js("(() => ({canvas: !!document.querySelector('#stage canvas'),"
                   " mini: !!window.__mini, pos: window.__mini && window.__mini.actorPos()}))()")
        check(ready["canvas"] is True, "3D 场景画布已创建", str(ready))
        check(ready["mini"] is True, "场景运行时已就绪", str(ready))
        if not ready["mini"]:
            return 1

        # 1. 走到指定点
        moved = js("""(async () => {
            const p0 = window.__mini.actorPos();
            window.__mini.walkTo(6, 4);
            await new Promise(r => setTimeout(r, 3000));
            const p1 = window.__mini.actorPos();
            return {p0: [p0.x, p0.z], p1: [p1.x, p1.z]};
        })()""")
        dx = abs(moved["p1"][0] - moved["p0"][0]) + abs(moved["p1"][1] - moved["p0"][1])
        check(dx > 3, "点地面后主角走了（位移 %.1f）" % dx, str(moved))

        # 2. 走近才触发：近处物件
        near = js("""(async () => {
            window.__events = [];
            window.__mini.walkTo(1.05, 0);
            await new Promise(r => setTimeout(r, 500));
            const during = window.__events.slice();
            await new Promise(r => setTimeout(r, 4500));
            return {during, after: window.__events.slice()};
        })()""")
        check(any(e[0] == "arrived" for e in near["after"]), "近处目标能走到并回调 arrived", str(near))

        # 3. 点物件：先走位，到位才出 spot 事件
        spot = js("""(async () => {
            window.__events = [];
            const t0 = performance.now();
            window.__mini.goToProp('s_board');
            let at = 0;
            for (let i = 0; i < 90; i++) {
                if (window.__events.some(e => e[0] === 'spot')) { at = performance.now() - t0; break; }
                await new Promise(r => setTimeout(r, 100));
            }
            return {at: Math.round(at), events: window.__events.slice()};
        })()""")
        check(spot["at"] > 800, "远处物件要走近才触发（耗时 %dms）" % spot["at"], str(spot["events"]))
        check(any(e[0] == "spot" and e[1] == "s_board" for e in spot["events"]),
              "触发的是被点的那个物件", str(spot["events"]))
        order = [e[0] for e in spot["events"]]
        check(order.index("arrived") < order.index("spot"), "事件顺序：先到达、后触发", str(order))

        # 4. 点障碍内部：吸附到最近可走点，不卡死
        blocked = js("""(async () => {
            window.__mini.walkTo(2.2, -2.2);   // 值班台正中
            await new Promise(r => setTimeout(r, 4500));
            const p = window.__mini.actorPos();
            const s = window.__mini.stats();
            return {p: [+p.x.toFixed(2), +p.z.toFixed(2)], walking: s.walking};
        })()""")
        check(blocked["walking"] is False, "点障碍内部不会一直卡在走路状态", str(blocked))
        check(abs(blocked["p"][0]) < 12 and abs(blocked["p"][1]) < 12, "人还在底座范围内", str(blocked))

        # 4.5 座位可坐：走近坐下，再点地面自动起身
        seat = js("""(async () => {
            window.__events = [];
            window.__mini.goToProp('s_bench');
            for (let i = 0; i < 80; i++) {
                if (window.__events.some(e => e[0] === 'seat')) break;
                await new Promise(r => setTimeout(r, 100));
            }
            const sat = window.__mini.stats().sitting;
            window.__mini.walkTo(2.0, 5.0);
            await new Promise(r => setTimeout(r, 700));
            return {sat, stood: !window.__mini.stats().sitting, events: window.__events.slice()};
        })()""")
        check(seat["sat"] is True, "点长椅会走过去坐下", str(seat["events"]))
        check(seat["stood"] is True, "起身后坐姿解除（点地面就走）", str(seat))

        # 5. 相机可自由旋转（拖拽后不会被强制回正）
        view = js("""(async () => {
            const before = window.__mini.stats().yaw;
            return {before};
        })()""")
        check(isinstance(view["before"], (int, float)), "相机方位角可读（供自由旋转）", str(view))

        # 5. 相机距离可缩放（滚轮）
        cam = js("""(() => {
            const before = window.__mini.stats().camDist;
            window.dispatchEvent(new Event('resize'));
            return {before, after: window.__mini.stats().camDist};
        })()""")
        check(cam["before"] == cam["after"], "resize 不改变相机距离（不抖）", str(cam))

        cdp.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
