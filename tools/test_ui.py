#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""浏览器交互测试：用真事件点页面，验"人能不能走通"。

覆盖的是接口测试看不到的那一层：
  · 首屏骨架消失、画布出现
  · 选案切换后标题真的变了
  · 方案没选完点提交 → 弹层不出现、未选维度被标红（**不能静默什么都不发生**）
  · 选完提交 → 复盘弹层出现、结局文案在
  · ESC 关闭 → "看复盘"入口出现，能再打开
  · 手机 390 宽：无横向溢出
  · 关掉模型（离线）→ 对话仍有回复

依赖 websocket-client，用隔离解释器跑：
    ~/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/test_ui.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

BASE = "http://127.0.0.1:%d" % int(os.environ.get("TJ_PORT") or 8770)
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

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
        print("[SKIP] 当前解释器没有 websocket-client，跳过浏览器测试（不算通过、也不算失败）")
        print("       用隔离解释器跑：~/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/test_ui.py")
        return 0
    try:
        from ui_probe import CDP, find_edge, free_port, wait_json  # noqa: E402
    except ImportError as exc:
        print("[SKIP] 无法载入 ui_probe：%s" % exc)
        return 0

    edge = find_edge()
    if not edge:
        print("[SKIP] 找不到 Edge / Chrome，跳过浏览器测试")
        return 0

    import subprocess
    import tempfile

    port = free_port()
    profile = tempfile.mkdtemp(prefix="ui-test-")
    proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             "--remote-debugging-port=%d" % port, "--user-data-dir=%s" % profile,
                             "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        page = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port) if t.get("type") == "page")
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})

        def js(expr, await_p=False):
            r = cdp.call("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                              "awaitPromise": await_p})
            return r.get("result", {}).get("value")

        def goto(url: str, wait: float = 2.6):
            cdp.call("Page.navigate", {"url": url})
            time.sleep(wait)

        # ---------- 1. 首屏：骨架消失、画布有尺寸
        goto(BASE + "/")
        ready = js("(() => {const s=document.getElementById('skeleton');"
                   "const c=document.getElementById('scene');"
                   "return {skel: s? s.classList.contains('gone'):null,"
                   " cw: c? c.clientWidth:0, ch: c? c.clientHeight:0};})()")
        check(ready["skel"] is True, "首屏骨架已消失", str(ready))
        check(ready["cw"] > 400 and ready["ch"] > 200, "场景画布已铺开", str(ready))

        # ---------- 1.5 拖动平移镜头（手机视野窄，靠它看全屋子）
        cam0 = js("Math.round(window.__scene.cam.x)")
        cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": 600, "y": 400,
                                              "button": "left", "clickCount": 1})
        for x in (570, 540, 510, 480):
            cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": 400,
                                                  "button": "left"})
            time.sleep(0.03)
        cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": 480, "y": 400,
                                              "button": "left", "clickCount": 1})
        time.sleep(0.5)
        cam1 = js("Math.round(window.__scene.cam.x)")
        check(cam1 > cam0, "按住拖动可以平移镜头", "%s → %s" % (cam0, cam1))
        check(js("window.__scene.path === null") is True, "拖动不会被当成点击走路")

        # ---------- 2. 选案切换
        goto(BASE + "/?case=case_02_pet")
        title = js("document.getElementById('caseTitle').textContent")
        check("狗" in (title or ""), "选案参数生效（切到第二个案子）", title)

        # ---------- 2.5 手机记事本：打开 → 新写 → 保存 → 徽标 +1
        js("document.getElementById('btnPhone').click(); true")
        time.sleep(0.4)
        check(js("!document.getElementById('phoneOverlay').hidden") is True, "手机能打开")
        check(js("(document.getElementById('ppHome').hidden === false)") is True, "手机默认停在桌面")
        js("document.querySelector('.app[data-app=\"notes\"]').click(); true")
        time.sleep(0.3)
        js("document.getElementById('noteNew').click(); document.getElementById('noteText').value="
           "'测试笔记：他到底要什么，最不肯让的是什么'; document.getElementById('noteSave').click(); true")
        time.sleep(1.0)
        noted = js("(() => ({count: document.querySelectorAll('#notesList .p-item').length,"
                   " badge: document.getElementById('noteBadge').textContent,"
                   " api: (window.__app.notes||[]).length}))()")
        check(noted["api"] == 1, "笔记写进会话（后端确认）", str(noted))
        check(noted["badge"] == "1", "顶栏徽标变成 1", str(noted))
        check(noted["count"] >= 1, "记事本列表里能看到这条", str(noted))
        js("document.getElementById('phClose').click(); true")
        time.sleep(0.3)
        check(js("document.getElementById('phoneOverlay').hidden") is True, "手机能收起")

        # ---------- 3. 没选完就提交：弹层不许出现，未选维度要标红
        # 按钮在首屏下面，先滚进视口再点 —— 视口外的坐标点不到，那样测的就不是应用了
        js("document.getElementById('btnAgree').scrollIntoView({block:'center'}); true")
        time.sleep(0.4)
        clicked = js("(() => {const b=document.getElementById('btnAgree');"
                     "const r=b.getBoundingClientRect();"
                     "return {x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2)};})()")
        for t in ("mousePressed", "mouseReleased"):
            cdp.call("Input.dispatchMouseEvent", {"type": t, "x": clicked["x"], "y": clicked["y"],
                                                  "button": "left", "clickCount": 1})
        time.sleep(0.6)
        state = js("(() => ({modal: !document.getElementById('reportModal').hidden,"
                   " missing: document.querySelectorAll('.plan-dim.missing').length,"
                   " toast: document.querySelectorAll('.toast').length}))()")
        check(state["modal"] is False, "没选完点提交，复盘弹层不出现", str(state))
        check(state["missing"] >= 1, "未选的维度被标红（给出可操作反馈）", str(state))
        check(state["toast"] >= 1, "同时弹了提示（移动端也看得见）", str(state))

        # ---------- 4. 选完四个维度再提交 → 弹层出现
        js("document.querySelectorAll('.plan-dim').forEach(function(c){"
           "const i=c.querySelector('input'); if(i) i.click();}); true")
        time.sleep(0.3)
        js("document.getElementById('btnAgree').click(); true")
        time.sleep(2.8)
        rep = js("(() => {const m=document.getElementById('reportModal');"
                 "const t=document.getElementById('reportBody').textContent;"
                 "return {open: !m.hidden, len: t.length,"
                 " head: t.slice(0,60), verdict: (document.querySelector('.verdict-main i')||{}).textContent};})()")
        check(rep["open"] is True, "选完提交，复盘弹层打开", str(rep)[:120])
        check(rep["len"] > 200, "复盘里有实质内容", "len=%s" % rep["len"])
        check(bool(rep["verdict"]), "复盘给出评级（合格 / 待补 / 不合格）", str(rep["verdict"]))
        check("教学演练生成" in (js("document.getElementById('reportBody').textContent") or ""),
              "复盘页脚带合规声明")

        # ---------- 5. ESC 关闭 → 看复盘入口出现 → 能再打开
        cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape", "code": "Escape",
                                            "windowsVirtualKeyCode": 27})
        time.sleep(0.4)
        closed = js("(() => ({open: !document.getElementById('reportModal').hidden,"
                    " fab: !document.getElementById('btnReopen').hidden,"
                    " lock: document.body.classList.contains('modal-open')}))()")
        check(closed["open"] is False and closed["fab"] is True,
              "ESC 关闭后出现「看复盘」入口", str(closed))
        check(closed["lock"] is False, "关闭后背景滚动锁解除", str(closed))

        js("document.getElementById('btnReopen').click(); true")
        time.sleep(0.5)
        check(js("!document.getElementById('reportModal').hidden") is True, "「看复盘」能重新打开")

        # ---------- 6. 离线对话仍然有回复
        js("document.getElementById('btnOffline').click(); true")
        js("(() => {const p=document.querySelector('.party'); if(p) p.click();"
           "document.getElementById('say').value='你先坐下慢慢说';"
           "document.getElementById('composer').dispatchEvent(new Event('submit'));return true;})()")
        time.sleep(2.2)
        them = js("document.querySelectorAll('.msg.them').length")
        check(them and them >= 1, "离线状态下对话仍有回复", "them=%s" % them)

        # ---------- 7. 手机 390：没有横向溢出
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True})
        goto(BASE + "/?case=case_03_falling")
        mobile = js("(() => ({vw: innerWidth, sw: document.documentElement.scrollWidth,"
                    " cw: document.getElementById('scene').clientWidth}))()")
        check(mobile["sw"] <= mobile["vw"] + 1,
              "390 宽无横向溢出", "%s/%s" % (mobile["sw"], mobile["vw"]))

        cdp.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        import shutil
        shutil.rmtree(profile, ignore_errors=True)

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
