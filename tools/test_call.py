#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""电话通道测试：拨号、通话轮次、挂断、通话记录，以及"电话算单独沟通"。

这一条很容易做歪：电话案里没有「单独谈」按钮，如果判定还按"必须分别谈话"来卡，
用户把事办成了也会被判程序不合格。所以这里专门钉死。

需要服务在跑。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

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


def call(path: str, body=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data,
                                 method="POST" if body is not None else "GET",
                                 headers={"Content-Type": "application/json"})
    try:
        with OPENER.open(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return e.code, {}
    except (urllib.error.URLError, OSError) as e:
        return 0, {"error": str(e)}


def new_session(cid: str = "case_00_flame") -> str:
    _, d = call("/api/session", {"caseId": cid})
    return (d.get("view") or {}).get("sessionId", "")


def main() -> int:
    sid = new_session()
    check(bool(sid), "能建开胃菜会话（电话案）")
    if not sid:
        return 1

    # 未知联系人
    _, r = call("/api/call", {"sessionId": sid, "op": "start", "partyId": "p_zzz"})
    check(r.get("ok") is False, "给不存在的联系人拨号 → 失败")

    # 拨号
    _, r = call("/api/call", {"sessionId": sid, "op": "start", "partyId": "p_a"})
    cid = r.get("callId", "")
    check(r.get("ok") is True and cid.startswith("C"), "拨号成功并返回通话 id", str(cid))
    check((r.get("call") or {}).get("open") is True, "通话状态为进行中")

    # 通话中说话 → 轮次累加
    _, d = call("/api/dialogue", {"sessionId": sid, "partyId": "p_a",
                                  "text": "我是城西派出所的，你先说说车停在什么位置",
                                  "channel": "phone"})
    check(d.get("ok") is True and bool(d.get("reply")), "通话里能对话并得到回应")
    _, r = call("/api/call", {"sessionId": sid, "op": "end"})
    done = r.get("call") or {}
    check(done.get("open") is False, "挂断后通话关闭")
    check(int(done.get("turns") or 0) >= 1, "轮次被记录下来", str(done.get("turns")))
    check(int(done.get("seconds") or 0) >= 0, "时长被记录下来", str(done.get("seconds")))

    # 重复拨号：上一通要自动收尾，不能挂两条"进行中"
    call("/api/call", {"sessionId": sid, "op": "start", "partyId": "p_a"})
    call("/api/call", {"sessionId": sid, "op": "start", "partyId": "p_b"})
    _, r = call("/api/call", {"sessionId": sid, "op": "end"})
    calls = r.get("calls") or []
    check(sum(1 for c in calls if c.get("open")) == 0, "同时只会有一通在通话中", str(calls))

    # 挂断没有进行中的通话
    _, r = call("/api/call", {"sessionId": sid, "op": "end"})
    check(r.get("ok") is False, "没有进行中的通话时挂断 → 失败而不是报错")

    # 假会话
    _, r = call("/api/call", {"sessionId": "nope", "op": "start", "partyId": "p_a"})
    check(False if r.get("ok") else True, "假会话拨号被拒绝", str(r)[:60])

    # 电话算单独沟通：办成了不该被判"程序不合格"
    call("/api/notes", {"sessionId": sid, "op": "add",
                        "text": "物业报警：消防通道被白车占用四十分钟；车主姓刘，答应十分钟挪。"})
    _, r = call("/api/submit", {"sessionId": sid,
                                "plan": {"dim_claim": "o_clear", "dim_action": "o_call"},
                                "mode": "agreement"})
    check(r.get("ok") is not False and r.get("ending") not in ("no_separate", "bad_plan"),
          "打电话办案不会被判「程序不合格」", str(r.get("ending")))
    check(r.get("ending") == "reached", "正解 + 打电话 → 电话办结", str(r.get("ending")))

    rep = r.get("report") or {}
    check((rep.get("process") or {}).get("phoneCalls", 0) >= 2, "复盘里统计了通话次数",
          str((rep.get("process") or {}).get("phoneCalls")))
    check(bool((rep.get("notes") or [])), "复盘里带上了笔记")

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
