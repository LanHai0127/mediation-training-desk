#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""训练复盘报告 —— 本地生成，不依赖模型。

一条硬规矩：**报告里的每个数字都必须能在判定审计日志里找到来源**。
所以这里不做任何二次计算，只把 `result`（含 audit）换个说法排出来。
对不上就是 bug，不是"四舍五入"。
"""
from __future__ import annotations

import time
from typing import Any

FOOTER = "教学演练生成 · 不构成执法意见"


def _label(case: dict[str, Any], ending: str) -> dict[str, str]:
    e = (case.get("endings") or {}).get(ending) or {}
    return {"label": e.get("label", ending), "text": e.get("text", "")}


def build_report(session: Any, result: dict[str, Any]) -> dict[str, Any]:
    case = session.case
    dims = result.get("dims") or []
    ending = _label(case, result.get("ending", ""))
    needs = {n["id"]: n for n in case.get("needs") or []}

    # ---- 四维对照：把"你选的"和"这一维最好的"并排放
    rows = []
    for d in dims:
        dim_def = next((x for x in case.get("dimensions") or [] if x["id"] == d["id"]), {})
        opts = dim_def.get("options") or []
        best = max(opts, key=lambda o: float(o.get("quality", 0)), default={})
        same = best.get("id") == d.get("chosen")
        rows.append({
            "name": d.get("name", d["id"]),
            "chosen": d.get("label", "（未作答）"),
            "quality": d.get("quality", 0),
            "best": "" if same else best.get("label", ""),
            "bestId": best.get("id", ""),
            "sameChoice": same,
            "bestQuality": float(best.get("quality", 0)),
            "lackFactsText": "、".join(d.get("lackFacts") or []),
            "note": d.get("note", ""),
            "trap": bool(d.get("trap")),
            "lackFacts": d.get("lackFacts") or [],
            "gap": round(float(best.get("quality", 0)) - float(d.get("quality", 0)), 3),
        })

    # ---- 关键失误 Top3：只取"明显低于该维最优"的，附替代话术
    misses = [r for r in rows if r["gap"] > 0.2 and r["best"]]
    misses.sort(key=lambda r: r["gap"], reverse=True)
    def instead_of(r):
        """选的本来就是这一维的最优解时，"换成…"要换个说法 —— 问题不在选择，在证据。"""
        if r.get("sameChoice") and r["lackFacts"]:
            return "还是这条，但先把证据拿到手：%s" % "、".join(r["lackFacts"])
        if r.get("sameChoice"):
            return "选择本身没有问题，问题在别处"
        return r["best"]

    top3 = [{
        "dim": r["name"],
        "what": r["chosen"],
        "cost": "这一维只拿到 %.2f" % r["quality"],
        "instead": instead_of(r),
        "why": r["note"],
    } for r in misses[:3]]

    # ---- 没碰过的诉求
    satisfied = set(result.get("satisfiedNeeds") or [])
    untouched = [{"id": nid, "text": n.get("text", "")}
                 for nid, n in needs.items() if nid not in satisfied]

    # ---- 过程画像
    talked = [t for t in (session.talked or [])]
    separate = [t for t in talked if t.get("channel") == "separate"]
    process = result.get("process") or {}

    return {
        "caseId": case.get("id", ""),
        "generatedAt": time.strftime("%Y-%m-%d %H:%M"),
        "caseTitle": case.get("title", ""),
        "subtitle": (case.get("meta") or {}).get("subtitle", ""),
        "ending": ending,
        "verdict": result.get("verdict", ""),
        "why": result.get("why", ""),
        "scores": {
            "coverage": result.get("coverage", 0),
            "ceiling": result.get("ceiling", 0),
            "total": result.get("total", 0),
            "confidence": result.get("confidence", 0),
            "route": result.get("route", ""),
        },
        "dims": rows,
        "top3": top3,
        "untouched": untouched,
        "process": {
            "separateTalk": bool(process.get("separateTalk")),
            "separateCount": len(separate),
            "talkedParties": sorted({t.get("partyId", "") for t in talked}),
            "oversteps": int(process.get("oversteps") or 0),
            "spotsSeen": len(session.seen or []),
            "factsSeen": len(session.facts_seen or []),
            "processScore": process.get("score", 0),
        },
        "notes": [{"text": n.get("text", "")} for n in (getattr(session, "notes", None) or [])],
        "missingFacts": result.get("missingFacts") or [],
        "auditLines": len(result.get("audit") or []),
        "footer": FOOTER,
    }


def report_text(rep: dict[str, Any]) -> str:
    """给"复制成文本"用的纯文本版：民警要拿去做台账，不能只有网页。"""
    lines = []
    lines.append("调解训练复盘 · %s" % rep.get("caseTitle", ""))
    lines.append("=" * 34)
    lines.append("结论：%s（%s）" % (rep["ending"]["label"], rep.get("verdict", "")))
    lines.append("说明：%s" % rep["ending"]["text"])
    lines.append("")
    s = rep["scores"]
    lines.append("覆盖率 %.2f ｜ 天花板 %.2f ｜ 总分 %.2f ｜ 置信度 %.2f（%s）"
                 % (s["coverage"], s["ceiling"], s["total"], s["confidence"], s["route"]))
    lines.append("")
    lines.append("【四维】")
    for r in rep["dims"]:
        lines.append("- %s：%.2f ｜ 你选了：%s" % (r["name"], r["quality"], r["chosen"]))
        if r["gap"] > 0.2 and r["best"]:
            lines.append("    更好的做法：%s" % r["best"])
    if rep.get("notes"):
        lines.append("")
        lines.append("【我的笔记】")
        for i, n in enumerate(rep["notes"], 1):
            lines.append("%d. %s" % (i, n["text"]))
    if rep["untouched"]:
        lines.append("")
        lines.append("【全程没碰到的诉求】")
        for n in rep["untouched"]:
            lines.append("- %s" % n["text"])
    p = rep["process"]
    lines.append("")
    lines.append("【过程】分别谈话：%s（%d 次）｜ 越界承诺：%d 次 ｜ 看过 %d 处、记下 %d 条事实"
                 % ("有" if p["separateTalk"] else "没有", p["separateCount"],
                    p["oversteps"], p["spotsSeen"], p["factsSeen"]))
    lines.append("")
    lines.append(rep["footer"])
    return "\n".join(lines)
