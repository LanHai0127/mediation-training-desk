#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""对话层测试：模型不通也能走完，判定不被对话文本污染。

S5 的三条判据都在这里钉住：
  · 拔掉模型（不配 key）→ 对话仍有内容、流程不中断
  · 同一句话问 3 次 → 态度要有变化（不能是复读机）
  · 说"我要投诉你"→ 情绪反应有，但**判定分不变**（这里表现为：接口不返回任何判定字段）

另加两条硬约束：
  · 越界承诺能被识别（答应了自己做不到的事）
  · 事实白名单：模型编出来的【事实:xxx】只要不在案子里就删掉

需要服务在跑（python src/server.py），端口取 TJ_PORT，默认 8770。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

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


def call(path: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method="POST" if body is not None else "GET",
                                 headers={"Content-Type": "application/json"})
    try:
        with OPENER.open(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return e.code, {}
    except (urllib.error.URLError, OSError) as e:
        return 0, {"error": str(e)}


def say(sid: str, pid: str, text: str, channel: str = "face") -> dict:
    _, d = call("/api/dialogue", {"sessionId": sid, "partyId": pid, "text": text,
                                  "channel": channel, "offline": True})
    return d


def main() -> int:
    # 0. 服务与模型状态
    code, d = call("/api/llm/status")
    check(code == 200 and "llm" in d, "GET /api/llm/status 可用", "code=%s" % code)
    llm_on = bool((d.get("llm") or {}).get("enabled"))
    print("     （模型%s配置，本测试按离线路径断言）" % ("已" if llm_on else "未"))

    code, cases = call("/api/cases")
    check(code == 200 and cases.get("cases"), "GET /api/cases 至少返回一个案子")
    # 白名单测试要用带 f_audio 的案子：现在第一个案子是电话案，没有这条事实
    all_ids = [c["id"] for c in cases.get("cases") or []]
    cid = "case_01_noise" if "case_01_noise" in all_ids else all_ids[0]

    code, s = call("/api/session", {"caseId": cid})
    sid = (s.get("view") or {}).get("sessionId", "")
    check(code == 200 and bool(sid), "POST /api/session 建会话成功", "code=%s" % code)
    if not sid:
        print("-" * 60)
        print("通过 %d ｜ 失败 %d" % (passed, failed))
        return 1

    # 1. 离线可对话：模型不配置也能走完
    r = say(sid, "p_a", "大姐，你先坐下，慢慢说，我听着。")
    check(bool(r.get("reply")), "离线状态下当事人有回复（功能不中断）", "reply=%r" % r.get("reply"))
    check(r.get("degraded") is True, "离线路径标记 degraded=true，前端能显示「无模型」")
    check("reply" in r and "text" not in r, "接口只回台词与状态，不回传判定结果")

    # 2. 同一句问 3 次：态度要有变化
    reps = [say(sid, "p_a", "你能不能小点声")["reply"] for _ in range(3)]
    check(len(set(reps)) >= 2, "同一句问 3 次，回复不全相同（不是复读机）", "；".join(reps))
    trust = [say(sid, "p_a", "你能不能小点声")["state"]["mood"] for _ in range(2)]
    check(trust[1] <= trust[0], "反复追问后情绪不升反降（有真实反应）", str(trust))

    # 3. 触发词：情绪掉，但判定分不变（这里断言"没有判定字段"）
    before = say(sid, "p_b", "我先了解一下情况。")["state"]["mood"]
    after_r = say(sid, "p_b", "你这人怎么这么矫情，忍一忍不行吗")
    after = after_r["state"]["mood"]
    check(after < before, "说到对方痛处（矫情）后情绪下降", "%s → %s" % (before, after))
    check(not any(k in after_r for k in ("verdict", "score", "judge", "result")),
          "对话接口不返回判定字段（LLM 不参与判定）")

    # 4. 越界承诺
    over = say(sid, "p_b", "我保证他三天内肯定把东西全搬走")
    check(over.get("overstep") is True, "识别出越界承诺（答应了自己做不到的事）", str(over.get("overstep")))

    # 5. 单独谈话 + 信任够 → 吐出隐情（只吐一次）
    # 隐情只在信任过线的那一轮吐一次，所以要逐轮收，不能只看最后一轮
    got = ""
    for _ in range(5):
        d = say(sid, "p_a", "我理解你辛苦，你跟我说说，这事儿最让你为难的是什么", "separate")
        if d.get("reveal"):
            got = d["reveal"]
            break
    check(bool(got), "单独谈话到一定信任后，说出隐情", repr(got)[:60])
    d2 = say(sid, "p_a", "再说一次，你最在意什么", "separate")
    check(d2.get("reveal") == "", "隐情只吐一次，不会反复倒带")

    # 6. 事实白名单（单元级）
    from game.dialogue import Dialogue  # noqa: E402
    case = json.loads((ROOT / "src" / "cases" / cid / "case.json").read_text(encoding="utf-8"))
    dlg = Dialogue(case)
    kept = dlg._filter_facts("他承认了【事实:f_audio】，还有【事实:f_fake】这回事")
    check("f_audio" in kept and "f_fake" not in kept,
          "事实白名单：案子里的保留，编出来的删掉", kept)

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
