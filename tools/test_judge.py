#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""判定内核与复盘测试（当前只有三个案子：电话 / 球场 / 院墙）。

钉住的东西：
  · `judge/` 里不出现任何案名、人名（数据驱动）
  · `evaluate()` 收不到对话文本（物理隔离点①）
  · 多解正确：院墙案谈崩后，转办合格、硬凑不合格
  · 覆盖率、结局、报告数字三者对得上（可复盘）

离线运行，不需要服务。
"""
from __future__ import annotations

import inspect
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from judge import MediationJudge  # noqa: E402
from judge import mediation as mediation_mod  # noqa: E402
from judge.kernel import choice, confidence, noul, score, softmax  # noqa: E402

passed = failed = 0

# 三案里选一个 4 维的做主线（球场），一个 5 维的做破裂分支（院墙）
GOOD = {"dim_claim": "o_rule", "dim_bottom": "o_both",
        "dim_evidence": "o_record", "dim_face": "o_face"}
BAD = {"dim_claim": "o_ban", "dim_bottom": "o_first",
       "dim_evidence": "o_words", "dim_face": "o_public"}


def check(ok: bool, msg: str, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print("[PASS] " + msg)
    else:
        failed += 1
        print("[FAIL] " + msg + ("  ← " + detail if detail else ""))


def load_case(cid: str) -> dict:
    return json.loads((ROOT / "src" / "cases" / cid / "case.json").read_text(encoding="utf-8"))


def ctx_for(case: dict, trust: float = 0.7, facts: bool = True) -> dict:
    return {
        "talked": [{"partyId": p, "channel": "separate"} for p in case["parties"]],
        "oversteps": 0,
        "facts": [f["id"] for f in case["facts"]] if facts else [],
        "trust": {p: trust for p in case["parties"]},
    }


def main() -> int:
    case = load_case("case_05_court")
    judge = MediationJudge(case)
    ctx = ctx_for(case)

    # ---------------------------------------------------------- 原语
    check(noul([{"v": 1}, {"v": 3}, {"v": 2}], lambda x: x["v"])["v"] == 3, "noul 选出分值最高的候选")
    dist = softmax([1.0, 0.0, 0.0])
    check(abs(sum(dist) - 1.0) < 1e-6 and dist[0] == max(dist), "softmax 归一且最高分概率最大")
    ch = choice([("a", 1.0), ("b", 0.2)])
    check(ch["top"] == "a" and ch["margin"] > 0.5, "choice 返回 top 与领先幅度")
    check(score(5, 0, 10) == 0.5 and score(-3, 0, 10) == 0.0, "score 做量表映射并截断")

    # ---------------------------------------------------------- 数据驱动
    names = {case["id"], case["title"]} | {p.get("name", "") for p in case["parties"].values()}
    hits = []
    for f in (ROOT / "src" / "judge").glob("*.py"):
        text = f.read_text(encoding="utf-8")
        for n in names:
            if n and n in text:
                hits.append("%s 含 %s" % (f.name, n))
    check(not hits, "judge/ 目录零案名、零案 id、零人名", "；".join(hits))

    # ---------------------------------------------------------- 隔离点
    params = list(inspect.signature(MediationJudge.evaluate).parameters)
    check(not any(k in params for k in ("text", "reply", "utterance", "dialogue")),
          "evaluate() 不接收对话文本（隔离点①）", str(params))
    src = (ROOT / "src" / "judge" / "mediation.py").read_text(encoding="utf-8")
    check("llm" not in re.sub(r"#.*", "", src) and "Dialogue" not in src,
          "judge 不 import 模型层或对话层（判定与生成彻底分开）")

    for const in ("THRESH_ACT", "THRESH_PASS", "RUPTURE_CEILING"):
        check(re.search(r"^%s\s*=\s*[0-9.]+" % const, src, re.M) is not None,
              "阈值 %s 是具名常量" % const)
    check("经验值" in src and "校准" in src, "阈值注明是经验值、待跑数校准（不假装有理论依据）")

    # ---------------------------------------------------------- 场景（球场：4 维）
    r_ok = judge.evaluate(GOOD, ctx, "agreement")
    check(r_ok["ending"] == "reached" and r_ok["verdict"] == "合格",
          "四维都对 + 分别谈 + 证据齐 → 达成", "%s/%s" % (r_ok["ending"], r_ok["verdict"]))
    check(r_ok["coverage"] >= 0.75, "达成时覆盖率 ≥ 0.75（实际 %.2f）" % r_ok["coverage"])

    r_bad = judge.evaluate(BAD, ctx, "agreement")
    check(r_bad["coverage"] < r_ok["coverage"], "全选诱饵 → 覆盖率显著更低",
          "%.2f vs %.2f" % (r_bad["coverage"], r_ok["coverage"]))
    check(r_bad["ending"] == "reached_weak", "低覆盖但仍签字 → 勉强达成（不判「合格」）", r_bad["ending"])

    no_sep = judge.evaluate(GOOD, dict(ctx, talked=[{"partyId": "p_a", "channel": "face"}]), "agreement")
    check(no_sep["ending"] == "no_separate", "没分别谈话就面对面 → 程序不合格", no_sep["ending"])

    no_fact = judge.evaluate(GOOD, ctx_for(case, facts=False), "agreement")
    check(no_fact["ending"] == "need_more" and no_fact["missingFacts"],
          "关键条款缺证据 → 要求补齐，不下结论", no_fact["ending"])

    over = judge.evaluate(GOOD, dict(ctx, oversteps=2), "agreement")
    check(over["ending"] == "overpromised", "越界承诺 ≥2 次 → 判不合格", over["ending"])

    blank = judge.evaluate({}, ctx, "agreement")
    check(blank["ending"] == "need_more" and blank["confidence"] == 0.0,
          "空方案 → 待补、置信度 0", "%s/%.2f" % (blank["ending"], blank["confidence"]))

    bogus = judge.evaluate(dict(GOOD, dim_claim="o_不存在"), ctx, "agreement")
    check(bogus["ending"] == "bad_plan" and bogus["invalidPlan"],
          "未知选项 → 判「无效」，绝不回落到第一个选项", "%s/%s" % (bogus["ending"], bogus["invalidPlan"]))

    # ---------------------------------------------------------- 多解（院墙：5 维）
    wall = load_case("case_06_wall")
    wj = MediationJudge(wall)
    wplan = {"dim_boundary": "o_measure", "dim_ditch": "o_village", "dim_pay": "o_public",
             "dim_evidence": "o_docs", "dim_face": "o_face"}
    w_ok = wj.evaluate(wplan, ctx_for(wall, 0.7), "agreement")
    check(w_ok["ending"] == "reached" and len(wplan) == 5,
          "五维案子也能判（数据驱动，不写死 4 维）", "%s/%d 维" % (w_ok["ending"], len(wplan)))

    w_low = ctx_for(wall, 0.1)
    forced = wj.evaluate(wplan, w_low, "agreement")
    referred = wj.evaluate(wplan, w_low, "refer")
    check(forced["ceiling"] < mediation_mod.RUPTURE_CEILING,
          "谈崩后覆盖率天花板掉到 %.2f（< %.2f）" % (forced["ceiling"], mediation_mod.RUPTURE_CEILING))
    check(forced["ending"] == "forced_agreement" and forced["verdict"] == "不合格",
          "结构性冲突下硬凑协议 → 不合格", forced["ending"])
    check(referred["ending"] == "rupture_referred" and referred["verdict"] == "合格",
          "同一情形下依法转办 → 合格（破裂也是正确答案）", referred["ending"])
    early = wj.evaluate(wplan, ctx_for(wall, 0.7), "refer")
    check(early["ending"] == "early_giveup", "还有余地就转办 → 判不合格", early["ending"])

    # ---------------------------------------------------------- 可复盘
    audit = r_ok["audit"]
    check(len([a for a in audit if a["step"] == "dim"]) == len(case["dimensions"]),
          "审计日志每个维度一条（%d 条）" % len(case["dimensions"]))
    tail = [a for a in audit if a["step"] == "score"]
    check(bool(tail) and tail[0]["coverage"] == r_ok["coverage"] and tail[0]["total"] == r_ok["total"],
          "审计日志末条与返回的覆盖率/总分完全一致")

    from game.report import build_report, report_text  # noqa: E402

    from types import SimpleNamespace
    session = SimpleNamespace(case=case, talked=ctx["talked"],
                              seen=["s_hoop", "s_bench"], facts_seen=["f_noise"])
    rep = build_report(session, r_ok)
    check(rep["scores"]["coverage"] == r_ok["coverage"] and rep["scores"]["total"] == r_ok["total"],
          "报告里的分数与判定结果逐位一致（不二次计算）")
    check(rep["footer"] == "教学演练生成 · 不构成执法意见", "报告页脚合规声明在")
    check("调解训练复盘" in report_text(rep), "报告可导出为纯文本")

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
