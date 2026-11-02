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

from .dialogue import Dialogue, public_party
from .llm import LLMClient  # noqa: F401  （对外导出，服务端直接用）


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
    }


# --------------------------------------------------------------------- 会话
class Session:
    def __init__(self, case: dict[str, Any], client: LLMClient | None = None) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.case = case
        self.dialogue = Dialogue(case, client)
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
            "talked": self.talked,
            "parties": {pid: {"trust": s["trust"], "mood": s["mood"]}
                        for pid, s in self.dialogue.state.items()},
        }

    def look(self, spot_id: str) -> dict[str, Any]:
        for sc in self.case.get("scenes", []):
            for sp in sc.get("spots", []):
                if sp["id"] == spot_id:
                    if spot_id not in self.seen:
                        self.seen.append(spot_id)
                    return {"ok": True, "spot": sp}
        return {"ok": False, "error": "没有这个点位"}
