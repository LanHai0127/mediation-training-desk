#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""调解台的领域层：案子加载、训练会话、当事人对话。

设计边界：
  · 案子是**纯数据**（case.json），代码里不许出现任何案名、人名、id。
  · 会话只存过程状态（走到哪个场景、和谁说过话、信任多少），判定另走 judge/。
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from judge import DecisionKernel, MediationJudge

from .dialogue import Dialogue, public_party
from .llm import LLMClient  # noqa: F401  （对外导出，服务端直接用）
from .report import build_report, report_text  # noqa: F401


# --------------------------------------------------------------------- 加载
def load_case(path: Path) -> dict[str, Any] | None:
    f = path / "case.json"
    if not f.is_file():
        return None
    try:
        case = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not case.get("id") or not case.get("scenes"):
        return None
    return case


def discover_cases(root: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not root.is_dir():
        return out
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        case = load_case(d)
        if case:
            out.append(case)
    return out


def public_dimensions(case: dict[str, Any]) -> list[dict[str, Any]]:
    """下发维度时**必须削掉** quality / trap / note / satisfies / evidence。

    这些字段等于答案：前端拿得到，玩家翻一下控制台就知道该选哪个。
    训练台可以藏答案，但不能藏规则 —— 维度的名字与问题描述照常下发。
    """
    out = []
    for d in case.get("dimensions") or []:
        out.append({
            "id": d["id"],
            "name": d.get("name", ""),
            "ask": d.get("ask", ""),
            "options": [{"id": o["id"], "label": o.get("label", "")} for o in d.get("options") or []],
        })
    return out


def public_case(case: dict[str, Any]) -> dict[str, Any]:
    """下发给前端的案子：去掉隐情、破防条件、参考解。

    训练台可以藏东西，但**不能骗人**：藏的是"当事人心里的话"，
    不是"数据错了"——所以每个被藏起来的字段，在 S6 复盘里都要能还回来。
    """
    return {
        "id": case["id"],
        "title": case.get("title", ""),
        "meta": case.get("meta", {}),
        "alarm": case.get("alarm", {}),
        "facts": case.get("facts", []),
        "partyOrder": case.get("partyOrder", list((case.get("parties") or {}).keys())),
        "parties": {pid: public_party(p) for pid, p in (case.get("parties") or {}).items()},
        "scenes": case.get("scenes", []),
        "dimensions": public_dimensions(case),
    }


# --------------------------------------------------------------------- 会话
class Session:
    def __init__(self, case: dict[str, Any], client: LLMClient | None = None) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.case = case
        self.dialogue = Dialogue(case, client)
        self.judge = MediationJudge(case)
        # 报警记录是出警时就在手上的，不算"现场发现"；其余事实必须自己走过去看
        self.facts_seen: list[str] = [f["id"] for f in (case.get("facts") or []) if f["id"] == "f_alarm"]
        self.result: dict[str, Any] | None = None
        self.report: dict[str, Any] | None = None
        self.scene_id = (case.get("scenes") or [{}])[0].get("id", "")
        self.seen: list[str] = []          # 看过哪些点位（复盘要用）
        self.talked: list[dict[str, str]] = []   # 和谁谈过、什么方式
        self.created = time.time()

    def view(self) -> dict[str, Any]:
        return {
            "sessionId": self.id,
            "caseId": self.case["id"],
            "sceneId": self.scene_id,
            "seen": self.seen,
            "factsSeen": self.facts_seen,
            "talked": self.talked,
            "hasResult": bool(self.result),
            "parties": {pid: {"trust": s["trust"], "mood": s["mood"]}
                        for pid, s in self.dialogue.state.items()},
        }

    def look(self, spot_id: str) -> dict[str, Any]:
        for sc in self.case.get("scenes", []):
            for sp in sc.get("spots", []):
                if sp["id"] == spot_id:
                    if spot_id not in self.seen:
                        self.seen.append(spot_id)
                    fact = sp.get("fact")
                    if fact and fact not in self.facts_seen:
                        self.facts_seen.append(fact)
                    return {"ok": True, "spot": sp}
        return {"ok": False, "error": "没有这个点位"}

    # ------------------------------------------------------------ 判定与复盘
    def submit(self, plan: dict[str, str], mode: str = "agreement") -> dict[str, Any]:
        """提交方案。入参只有方案与模式；对话文本一个字都不进判定。"""
        ctx = {
            "talked": [dict(t) for t in self.talked],
            "oversteps": self.dialogue.oversteps,
            "facts": list(self.facts_seen),
            "trust": {pid: st["trust"] for pid, st in self.dialogue.state.items()},
        }
        res = self.judge.evaluate(plan or {}, ctx, mode if mode in ("agreement", "refer") else "agreement")
        res["context"] = {"factsSeen": list(self.facts_seen), "oversteps": ctx["oversteps"],
                          "trust": ctx["trust"]}
        self.result = res
        self.report = build_report(self, res)
        return res

    def audit_lines(self) -> list[dict[str, Any]]:
        """判定审计日志：复核"这个数从哪来的"就看这里。"""
        return list((self.result or {}).get("audit") or [])
