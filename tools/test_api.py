#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""接口边界测试：把"乱传参数"这条路堵死。

这些用例都是真实踩过或几乎踩到的：
  · 传一个不存在的选项 id → 曾经会**静默命中第一个选项**（往往是满分项），乱填也拿 1.00
  · plan 里塞数字 / 列表 / null → 不能让判定崩，也不能被当成有效选择
  · 超长对话文本 → 截断，不许直接送模型
  · 同一 session 并发提交 → 不许 500
  · 没有判定结果就取报告 → 404，而不是空报告

需要服务在跑。
"""
from __future__ import annotations

import json
import os
import sys
import threading
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
        with OPENER.open(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return e.code, {}
    except (urllib.error.URLError, OSError) as e:
        return 0, {"error": str(e)}


def new_session(cid: str = "case_05_court", with_note: bool = True) -> str:
    """建会话；默认顺手写一条笔记——提交有「记事本不许空」的门槛，不写就测不到后面的东西。"""
    _, d = call("/api/session", {"caseId": cid})
    sid = (d.get("view") or {}).get("sessionId", "")
    if sid and with_note:
        call("/api/notes", {"sessionId": sid, "op": "add", "text": "测试用：先记一条"})
    return sid


def main() -> int:
    _, cases = call("/api/cases")
    ids = [c["id"] for c in cases.get("cases") or []]
    check(len(ids) == 3, "三个案子都在（%d）" % len(ids))

    # 不存在的案子
    code, d = call("/api/session", {"caseId": "case_does_not_exist"})
    check(code == 404, "不存在的 caseId → 404", "code=%s" % code)

    sid = new_session()
    check(bool(sid), "能建会话")
    if not sid:
        return 1

    # 不存在的会话
    for path, body in (("/api/look", {"sessionId": "nope", "spotId": "s_sofa"}),
                       ("/api/submit", {"sessionId": "nope", "plan": {}}),
                       ("/api/dialogue", {"sessionId": "nope", "partyId": "p_a", "text": "你好"})):
        code, _ = call(path, body)
        check(code == 404, "%s 用假会话 → 404" % path, "code=%s" % code)

    code, _ = call("/api/report/nope")
    check(code == 404, "没判定就取报告 → 404", "code=%s" % code)

    # 不存在的当事人
    _, d = call("/api/dialogue", {"sessionId": sid, "partyId": "p_zzz", "text": "你好"})
    check(d.get("ok") is False and "当事人" in str(d.get("error", "")),
          "未知 partyId → ok=false 且说明原因", str(d)[:80])

    # 未知选项：不许静默回落到第一个选项
    plan_bad = {"dim_claim": "o_不存在", "dim_bottom": "o_both",
                "dim_evidence": "o_facts", "dim_face": "o_face_both"}
    code, r = call("/api/submit", {"sessionId": sid, "plan": plan_bad, "mode": "agreement"})
    check(code == 200 and r.get("ending") == "bad_plan",
          "未知选项 → 判「无效」，不回落到满分项", "%s/%s" % (code, r.get("ending")))
    check(r.get("invalidPlan"), "返回里点名了哪个维度的选项非法", str(r.get("invalidPlan"))[:80])
    check(r.get("coverage", 0) <= 0.6, "未知选项时覆盖率不会虚高（实际 %.2f）" % r.get("coverage", 0))

    # 非字符串值：被边界丢弃，等同于没填
    code, r = call("/api/submit", {"sessionId": sid, "plan": {"dim_claim": 123}, "mode": "agreement"})
    check(code == 200 and r.get("ending") in ("need_more",),
          "plan 传数字 → 视为未作答（need_more）", str(r.get("ending")))

    # 空 plan
    code, r = call("/api/submit", {"sessionId": sid, "plan": {}, "mode": "agreement"})
    check(code == 200 and r.get("ending") == "need_more" and r.get("coverage") == 0,
          "空 plan → 待补且覆盖率 0", "%s/%.2f" % (r.get("ending"), r.get("coverage", -1)))

    # 超长文本：截断，不报错
    long_text = "这是一段很长的输入。" * 200
    code, d = call("/api/dialogue", {"sessionId": sid, "partyId": "p_a",
                                     "text": long_text, "channel": "face", "offline": True})
    check(code == 200 and d.get("ok") is True, "6000 字对话文本不报错（服务端截断）", "code=%s" % code)
    check(len(str(d.get("reply", ""))) < 400, "回复长度正常")

    # 非法 mode → 归一到 agreement
    code, r = call("/api/submit", {"sessionId": sid,
                                   "plan": {"dim_claim": "o_sleep", "dim_bottom": "o_both",
                                            "dim_evidence": "o_facts", "dim_face": "o_face_both"},
                                   "mode": "hack"})
    check(code == 200 and r.get("mode") == "agreement", "非法 mode 归一到 agreement", str(r.get("mode")))

    # 并发提交：同一 session 连打 8 次，不许 5xx
    sid2 = new_session()
    good = {"dim_claim": "o_sleep", "dim_bottom": "o_both",
            "dim_evidence": "o_facts", "dim_face": "o_face_both"}
    results = []

    def fire():
        code, _ = call("/api/submit", {"sessionId": sid2, "plan": good, "mode": "agreement"})
        results.append(code)

    ts = [threading.Thread(target=fire) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    check(all(c == 200 for c in results), "并发 8 次提交全部 200", str(results))

    # 报告可复现：同一 session 两次取报告，分数一致
    _, a = call("/api/report/" + sid2)
    _, b = call("/api/report/" + sid2)
    check(a.get("report", {}).get("scores") == b.get("report", {}).get("scores"),
          "两次取报告，分数完全一致（可复盘）")
    check(bool(a.get("text")) and "教学演练生成" in a.get("text", ""), "报告文本带合规页脚")

    # 换案子后维度数量不同，也必须能提交
    sid3 = new_session("case_06_wall")
    _, cs = call("/api/case/case_06_wall")
    dims = [d["id"] for d in cs.get("dimensions") or []]
    plan4 = {dims[0]: (cs["dimensions"][0]["options"][0]["id"]),
             dims[1]: (cs["dimensions"][1]["options"][0]["id"]),
             dims[2]: (cs["dimensions"][2]["options"][0]["id"]),
             dims[3]: (cs["dimensions"][3]["options"][0]["id"])}
    code, r = call("/api/submit", {"sessionId": sid3, "plan": plan4, "mode": "agreement"})
    check(code == 200 and r.get("ending") not in ("bad_plan",),
          "五维三方院墙案能正常判（%s）" % r.get("ending"))

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
