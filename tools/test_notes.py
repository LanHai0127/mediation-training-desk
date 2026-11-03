#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""记事本测试：增删改、边界、会话隔离，以及"空着不许交方案"的门槛。

手机记事本是这套训练台的规矩之一：**诉求要你自己写下来，系统不替你记**。
所以这里除了 CRUD，还要钉住那条门槛——否则前端忘了拦，后端也没拦，就成了摆设。

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
PLAN = {"dim_claim": "o_sleep", "dim_bottom": "o_both",
        "dim_evidence": "o_facts", "dim_face": "o_face_both"}


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


def new_session() -> str:
    _, d = call("/api/session", {"caseId": "case_01_noise"})
    return (d.get("view") or {}).get("sessionId", "")


def note(sid: str, op: str, text: str = "", nid: str = ""):
    _, d = call("/api/notes", {"sessionId": sid, "op": op, "id": nid, "text": text})
    return d


def main() -> int:
    sid = new_session()
    check(bool(sid), "能建会话")
    if not sid:
        return 1

    _, d = call("/api/notes", {"sessionId": sid})
    check(d.get("notes") == [], "新会话的记事本是空的")

    # 门槛：空着不许交方案
    _, r = call("/api/submit", {"sessionId": sid, "plan": PLAN, "mode": "agreement"})
    check(r.get("ok") is False and r.get("need") == "notes",
          "记事本空着时提交被拦下，并指出缺什么", "%s/%s" % (r.get("ok"), r.get("need")))
    check("记事本" in str(r.get("message", "")), "拦下时给的是人话，不是错误码")
    check(not any(k in r for k in ("ending", "coverage")), "被拦时不会偷偷给一个判定结果")

    # 新增
    r = note(sid, "add", "周敏底线=夜里安静；王建国底线=工期")
    check(r.get("ok") is True and len(r.get("notes") or []) == 1, "新增一条笔记")
    nid = (r.get("notes") or [{}])[0].get("id")
    check(str(nid).startswith("N"), "笔记有可引用的 id（N 开头）", str(nid))
    check("at" in (r.get("notes") or [{}])[0], "笔记带时间戳（复议时能按顺序看）")

    # 修改
    r = note(sid, "update", "周敏底线=睡眠；王建国底线=工期；台阶=不当众点他", nid)
    check(r.get("ok") is True and "台阶" in (r.get("notes") or [{}])[0].get("text", ""), "修改笔记内容")
    check(len(r.get("notes") or []) == 1, "修改不会新增一条")

    # 空文本与超长
    r = note(sid, "add", "   ")
    check(r.get("ok") is False, "空白笔记被拒绝")
    long_text = "这是很长的一段记录。" * 200
    r = note(sid, "add", long_text)
    saved = (r.get("notes") or [{}])[-1].get("text", "")
    check(r.get("ok") is True and len(saved) <= 600, "超长笔记被截断到 600 字内", "len=%d" % len(saved))

    # 未知 id
    r = note(sid, "update", "改不了", "N999")
    check(r.get("ok") is False, "改不存在的笔记 → 失败")
    r = note(sid, "delete", "", "N999")
    check(r.get("ok") is False, "删不存在的笔记 → 失败")

    # 跨会话隔离
    sid2 = new_session()
    _, d2 = call("/api/notes", {"sessionId": sid2})
    check(d2.get("notes") == [], "另一个会话看不到这边的笔记（不串台）")

    # 有笔记就能交
    _, r = call("/api/submit", {"sessionId": sid, "plan": PLAN, "mode": "agreement"})
    check(r.get("ok") is not False and bool(r.get("ending")),
          "有笔记后能正常提交并出结局", str(r.get("ending")))
    check(r.get("report", {}).get("process", {}).get("oversteps") is not None,
          "复盘里带过程数据")

    # 删除后又被门槛拦住（防止"删光笔记就绕过"）
    _, r = call("/api/notes", {"sessionId": sid2, "op": "add", "text": "临时"})
    nid2 = (r.get("notes") or [{}])[0].get("id")
    note(sid2, "delete", "", nid2)
    _, r = call("/api/submit", {"sessionId": sid2, "plan": PLAN, "mode": "agreement"})
    check(r.get("ok") is False and r.get("need") == "notes",
          "把笔记删光后再提交，仍然被拦（门槛不是一次性开关）")

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
