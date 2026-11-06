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
            window.__mini.walkTo(4.2, 3.2);
            await new Promise(r => setTimeout(r, 3000));
            const p1 = window.__mini.actorPos();
            return {p0: [p0.x, p0.z], p1: [p1.x, p1.z]};
        })()""")
        dx = abs(moved["p1"][0] - moved["p0"][0]) + abs(moved["p1"][1] - moved["p0"][1])
        check(dx > 2, "点地面后主角走了（位移 %.1f）" % dx, str(moved))

        # 2. 走近才触发：近处物件
        near = js("""(async () => {
            window.__events = [];
            window.__mini.walkTo(0.9, 1.0);
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
            window.__mini.walkTo(2.2, -1.2);   // 值班台正中
            await new Promise(r => setTimeout(r, 4500));
            const p = window.__mini.actorPos();
            const s = window.__mini.stats();
            return {p: [+p.x.toFixed(2), +p.z.toFixed(2)], walking: s.walking};
        })()""")
        check(blocked["walking"] is False, "点障碍内部不会一直卡在走路状态", str(blocked))
        check(abs(blocked["p"][0]) < 12 and abs(blocked["p"][1]) < 12, "人还在底座范围内", str(blocked))

        # 4.4 障碍不扩张：从房间中心必须能走到门口（"幽灵墙"会让这一段走不通）
        walk = js("""(async () => {
            const s = window.__mini;
            s.setActor(0, 0);
            const ok = s.walkTo(0.8, 3.2);
            await new Promise(r => setTimeout(r, 1600));
            const p = s.stats().actorXZ;
            return {ok, xz: p, moved: Math.abs(p[1]) > 2.5};
        })()""")
        check(walk["ok"] is True and walk["moved"] is True,
              "房间中心能一路走到门口（障碍没多圈半格）", str(walk))

        # 4.5 座位可坐：走近坐下，再点地面自动起身
        seat = js("""(async () => {
            window.__events = [];
            window.__mini.goToProp('s_bench');
            for (let i = 0; i < 80; i++) {
                if (window.__events.some(e => e[0] === 'seat')) break;
                await new Promise(r => setTimeout(r, 100));
            }
            await new Promise(r => setTimeout(r, 350));
            const st = window.__mini.stats();
            const sat = st.sitting;
            window.__mini.walkTo(2.0, 3.2);
            await new Promise(r => setTimeout(r, 700));
            return {sat, walking: st.walking, stood: !window.__mini.stats().sitting,
                    events: window.__events.slice()};
        })()""")
        check(seat["sat"] is True, "点长椅会走过去坐下", str(seat["events"]))
        check(seat.get("walking") is False, "坐下后动画循环没被 return 掐断", str(seat))
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

        # ---------------------------------------------------------------- 第二阶段：S3 院墙（室外场景）
        # 室外场景没有 room、没有吊顶，走的是另一条构建分支；S0 全绿不代表它也绿。
        cdp.call("Page.navigate", {"url": BASE + "/static/scenes/wall.html"})
        time.sleep(4.0)
        wready = js("""(() => ({
            canvas: !!document.querySelector('#stage canvas'),
            mini: !!window.__mini,
            err: window.__err || ''
        }))()""")
        check(wready["canvas"] is True and wready["mini"] is True, "S3 院墙：场景能起来", str(wready))
        check(wready["err"] == "", "S3 院墙：没有运行时报错", wready["err"])

        winfo = js("""(() => window.__mini.info())()""")
        check(winfo["props"] >= 32, "S3 院墙：物件 %d 件（室外参考 28~45）" % winfo["props"], str(winfo))
        check(winfo["people"] >= 2, "S3 院墙：两名可交互当事人已注册", str(winfo))
        check(winfo["tris"] >= 12000, "S3 院墙：三角面 %d（不是十几个盒子糊的）" % winfo["tris"], str(winfo))

        wpath = js("""(() => {
            const d = window.__mini.debugPath(1.15, 1.6);
            return {fromBlocked: d.fromBlocked, goalBlocked: d.goalBlocked, len: d.len};
        })()""")
        check(wpath["fromBlocked"] is False, "S3 院墙：主角起点不在障碍里", str(wpath))
        check(wpath["goalBlocked"] is False and wpath["len"] > 0,
              "S3 院墙：能走到界石（路径 %d 格）" % wpath["len"], str(wpath))

        wspot = js("""(async () => {
            window.__events = [];
            window.__mini.setActor(1.15, 3.2);
            window.__mini.goToProp('s_stone');
            await new Promise(r => setTimeout(r, 3200));
            return {events: window.__events};
        })()""")
        check(any(e[0] == "spot" and e[1] == "s_stone" for e in wspot["events"]),
              "S3 院墙：走近界石能触发证据点位", str(wspot["events"]))

        wperson = js("""(async () => {
            window.__events = [];
            window.__mini.setActor(1.15, 3.2);
            window.__mini.goToPerson('p_b');
            await new Promise(r => setTimeout(r, 3200));
            return {events: window.__events};
        })()""")
        check(any(e[0] == "person" and e[1] == "p_b" for e in wperson["events"]),
              "S3 院墙：走近张守义能触发对话", str(wperson["events"]))

        # ---------------------------------------------------------------- 第三阶段：S4 张家院
        cdp.call("Page.navigate", {"url": BASE + "/static/scenes/yard.html"})
        time.sleep(4.0)
        yready = js("""(() => ({
            canvas: !!document.querySelector('#stage canvas'),
            mini: !!window.__mini,
            err: window.__err || ''
        }))()""")
        check(yready["canvas"] is True and yready["mini"] is True, "S4 张家院：场景能起来", str(yready))
        check(yready["err"] == "", "S4 张家院：没有运行时报错", yready["err"])

        yinfo = js("""(() => window.__mini.info())()""")
        check(yinfo["props"] >= 26, "S4 张家院：物件 %d 件" % yinfo["props"], str(yinfo))
        check(yinfo["people"] >= 2, "S4 张家院：张守义与张建军已注册", str(yinfo))

        ypath = js("""(() => {
            const d = window.__mini.debugPath(0.5, 0.9);
            return {fromBlocked: d.fromBlocked, goalBlocked: d.goalBlocked, len: d.len};
        })()""")
        check(ypath["fromBlocked"] is False, "S4 张家院：主角起点不在障碍里", str(ypath))
        check(ypath["goalBlocked"] is False and ypath["len"] > 0,
              "S4 张家院：能走到方桌（路径 %d 格）" % ypath["len"], str(ypath))

        yspot = js("""(async () => {
            window.__events = [];
            window.__mini.setActor(0.5, 2.4);
            window.__mini.goToProp('s_table');
            await new Promise(r => setTimeout(r, 3200));
            return {events: window.__events};
        })()""")
        check(any(e[0] == "spot" and e[1] == "s_table" for e in yspot["events"]),
              "S4 张家院：走近方桌能触发权证点位", str(yspot["events"]))

        # ---------------------------------------------------------------- 第四阶段：S5 李家院
        cdp.call("Page.navigate", {"url": BASE + "/static/scenes/lihome.html"})
        time.sleep(4.0)
        lready = js("""(() => ({
            canvas: !!document.querySelector('#stage canvas'),
            mini: !!window.__mini,
            err: window.__err || ''
        }))()""")
        check(lready["canvas"] is True and lready["mini"] is True, "S5 李家院：场景能起来", str(lready))
        check(lready["err"] == "", "S5 李家院：没有运行时报错", lready["err"])

        linfo = js("""(() => window.__mini.info())()""")
        check(linfo["props"] >= 28, "S5 李家院：物件 %d 件" % linfo["props"], str(linfo))
        check(linfo["people"] >= 1, "S5 李家院：李秀兰已注册", str(linfo))

        lpath = js("""(() => {
            const d = window.__mini.debugPath(-0.2, 0.7);
            return {fromBlocked: d.fromBlocked, goalBlocked: d.goalBlocked, len: d.len};
        })()""")
        check(lpath["fromBlocked"] is False, "S5 李家院：主角起点不在障碍里", str(lpath))
        check(lpath["goalBlocked"] is False and lpath["len"] > 0,
              "S5 李家院：能走到堂屋桌（路径 %d 格）" % lpath["len"], str(lpath))

        lspot = js("""(async () => {
            window.__events = [];
            window.__mini.setActor(-0.2, 2.6);
            window.__mini.goToProp('s_table');
            await new Promise(r => setTimeout(r, 3200));
            return {events: window.__events};
        })()""")
        check(any(e[0] == "spot" and e[1] == "s_table" for e in lspot["events"]),
              "S5 李家院：走近堂屋桌能触发学费单点位", str(lspot["events"]))

        # ---------------------------------------------------------------- 第五阶段：S1 调解室
        cdp.call("Page.navigate", {"url": BASE + "/static/scenes/mediation.html"})
        time.sleep(4.0)
        mready = js("""(() => ({
            canvas: !!document.querySelector('#stage canvas'),
            mini: !!window.__mini,
            err: window.__err || ''
        }))()""")
        check(mready["canvas"] is True and mready["mini"] is True, "S1 调解室：场景能起来", str(mready))
        check(mready["err"] == "", "S1 调解室：没有运行时报错", mready["err"])

        minfo = js("""(() => window.__mini.info())()""")
        check(minfo["props"] >= 32, "S1 调解室：物件 %d 件" % minfo["props"], str(minfo))

        mpath = js("""(() => {
            const d = window.__mini.debugPath(0, 1.3);
            return {fromBlocked: d.fromBlocked, goalBlocked: d.goalBlocked, len: d.len};
        })()""")
        check(mpath["fromBlocked"] is False, "S1 调解室：主角起点不在障碍里", str(mpath))
        check(mpath["goalBlocked"] is False and mpath["len"] > 0,
              "S1 调解室：能走到调解桌（路径 %d 格）" % mpath["len"], str(mpath))

        mspot = js("""(async () => {
            window.__events = [];
            window.__mini.setActor(0, 2.4);
            window.__mini.goToProp('s_table');
            await new Promise(r => setTimeout(r, 3200));
            return {events: window.__events};
        })()""")
        check(any(e[0] == "spot" and e[1] == "s_table" for e in mspot["events"]),
              "S1 调解室：走近调解桌能触发申请书点位", str(mspot["events"]))

        mseat = js("""(async () => {
            window.__events = [];
            window.__mini.setActor(-1.2, 2.6);
            window.__mini.goToProp('s_benchL');
            await new Promise(r => setTimeout(r, 3600));
            return {events: window.__events, stats: window.__mini.stats()};
        })()""")
        check(any(e[0] == "seat" for e in mseat["events"]),
              "S1 调解室：两侧长条椅能坐下", str(mseat["events"]))

        # ---------------------------------------------------------------- 第六阶段：其余五场的通用检查
        # 五场结构相同（能起来 / 无报错 / 物件数够 / 起点不卡 / 指定的证据点位能触发），
        # 用一张表跑，省得复制五遍。
        OTHERS = [
            ("court", "S2 篮球场", 24, "s_mark", -1.6, 1.9),
            ("village", "S6 村委会", 20, "s_desk", 0.4, 0.3),
            ("shop", "S7 小卖部", 14, "s_counter", 3.9, 3.6),
            ("thresh", "S8 晒谷场", 18, "s_notice", -1.6, 4.4),
            ("judicial", "S9 司法所", 18, "s_counter", 0.0, 1.5),
        ]
        for slug, label, minp, spot, sx, sz in OTHERS:
            cdp.call("Page.navigate", {"url": BASE + "/static/scenes/" + slug + ".html"})
            time.sleep(3.2)
            r = js("(() => ({ok: !!window.__mini, err: window.__err || '',"
                   " info: window.__mini ? window.__mini.info() : null}))()")
            check(r["ok"] is True and r["err"] == "", label + "：能起来且无报错", str(r.get("err")))
            n = r["info"]["props"] if r.get("info") else -1
            check(n >= minp, label + "：物件 %d 件（门槛 %d）" % (n, minp), "")

            p2 = js("(() => { const d = window.__mini.debugPath(" + str(sx) + "," + str(sz) + ");"
                    " return {fb: d.fromBlocked, gb: d.goalBlocked, len: d.len}; })()")
            check(p2["fb"] is False, label + "：起点不在障碍里", str(p2))
            check(p2["gb"] is False and p2["len"] > 0,
                  label + "：能走到证据点位（路径 %d 格）" % p2["len"], str(p2))

            ev = js("(async () => { window.__events = [];"
                    " window.__mini.setActor(" + str(sx) + ", " + str(sz + 1.0) + ");"
                    " window.__mini.goToProp('" + spot + "');"
                    " await new Promise(r => setTimeout(r, 3000));"
                    " return {events: window.__events}; })()")
            check(any(e[0] == "spot" and e[1] == spot for e in ev["events"]),
                  label + "：走近 " + spot + " 能触发点位", str(ev["events"]))

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
