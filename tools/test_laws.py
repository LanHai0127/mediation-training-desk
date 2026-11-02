#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""法条库测试：可溯源、不编条号、检索不出乱给。

合规红线里最硬的一条是「不许编法条号」。这里钉四件事：
  · 每条都必须有 law + article + gist + id，缺一不可
  · id 唯一，且能被前端拿去做溯源引用
  · 检索按关键词能命中，且命中的确实是相关那条
  · 检索不到就返回空 —— 宁可不说，也不让模型现编

离线运行，不依赖服务。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from game import rag  # noqa: E402

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
    meta = rag.load(ROOT / "src")
    arts = json.loads((ROOT / "src" / "laws" / "laws.json").read_text(encoding="utf-8"))["articles"]

    check(meta.get("count", 0) >= 6, "条文库至少 6 条（实际 %s）" % meta.get("count"))
    check("非逐字原文" in meta.get("note", "") and "以现行有效文本为准" in meta.get("note", ""),
          "条文库声明了「要点摘录、以正式文本为准」（不假装是原文）")

    missing = [a["id"] for a in arts if not all(a.get(k) for k in ("id", "law", "article", "gist"))]
    check(not missing, "每条都有 法名 + 条号 + 要点", "缺字段：%s" % "、".join(missing))
    ids = [a["id"] for a in arts]
    check(len(ids) == len(set(ids)), "条 id 唯一（可做溯源引用）")
    check(all(a["article"].startswith("第") for a in arts), "条号格式统一（第 X 条）")

    # 检索：噪音 → 治安管理处罚法第 58 条 / 相邻关系
    hit = rag.search("楼上装修 噪音 晚上 吵", 3)
    check(bool(hit), "检索「噪音」能命中", "空结果")
    check(any(a["id"] in ("l_ap_58", "l_adj_288") for a in hit),
          "噪音类命中治安管理处罚法第 58 条或相邻关系条款",
          "；".join(a["id"] for a in hit))

    hit2 = rag.search("高空抛物 花盆 砸坏 雨棚 查不清是谁", 3)
    check(any(a["id"] == "l_tort_1254" for a in hit2), "高空抛物命中民法典第一千二百五十四条",
          "；".join(a["id"] for a in hit2))

    hit3 = rag.search("工人 欠薪 工资 包工头", 3)
    check(any(a["id"] == "l_pm_17" for a in hit3), "欠薪场景能命中调解法（转办/拒绝调解）",
          "；".join(a["id"] for a in hit3))

    check(rag.search("", 3) == [], "空查询返回空（不乱给）")
    check(rag.search("量子纠缠与钢琴调音", 3) == [], "完全无关的查询返回空（宁可不给，也不凑）")

    by = rag.by_ids(["l_pm_31"])
    check(len(by) == 1 and by[0]["article"] == "第三十一条", "by_ids 能按 id 精确取回条文")

    # 案件自动匹配：每个案子都能给出至少 2 条可引用条文
    for f in sorted((ROOT / "src" / "cases").glob("*/case.json")):
        case = json.loads(f.read_text(encoding="utf-8"))
        q = " ".join([case["title"], case.get("meta", {}).get("subtitle", ""),
                      case.get("meta", {}).get("brief", "")])
        got = rag.search(q, 3)
        check(len(got) >= 2, "%s 能匹配到 ≥2 条条文" % case["id"], "只匹配到 %d 条" % len(got))

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
