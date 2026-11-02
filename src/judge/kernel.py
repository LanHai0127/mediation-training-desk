#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""判定内核：三个原语 + 温度缩放 softmax + 置信度校准。

它是**纯计算**的，不认案子、不认人、不读对话文本。
所有案子共用这一套；案子换了，这里一行都不用改。
"""
from __future__ import annotations

import math
from typing import Any, Callable, Sequence

# 温度：压低分布峰值。0.8 是拍的经验值，为了让"两个选项差不多好"时
# 置信度真的降下来，而不是永远接近 1。
TEMPERATURE = 0.8


# ---------------------------------------------------------------- 原语一：noul
def noul(candidates: Sequence[Any], key: Callable[[Any], float]) -> Any | None:
    """从候选里选一个（不需要模型，纯规则打分）。

    并列时取靠前的那个 —— 保持确定性，评审现场同一个输入必须得同一个结果。
    """
    best = None
    best_v = -math.inf
    for c in candidates:
        v = key(c)
        if v > best_v:
            best, best_v = c, v
    return best


# ---------------------------------------------------------------- 原语二：choice
def softmax(scores: Sequence[float], temperature: float = TEMPERATURE) -> list[float]:
    if not scores:
        return []
    t = max(1e-6, temperature)
    mx = max(scores)
    exps = [math.exp((s - mx) / t) for s in scores]
    total = sum(exps) or 1.0
    return [e / total for e in exps]


def choice(buckets: Sequence[tuple[str, float]], temperature: float = TEMPERATURE) -> dict[str, Any]:
    """从若干带分选项里选（带 softmax 分布）。

    返回 {top, topScore, margin, dist}。margin = 第一 - 第二，用来判断"是不是很难选"。
    """
    if not buckets:
        return {"top": "", "topScore": 0.0, "margin": 0.0, "dist": {}}
    names = [b[0] for b in buckets]
    scores = [b[1] for b in buckets]
    dist = softmax(scores, temperature)
    order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    top = names[order[0]]
    margin = (scores[order[0]] - scores[order[1]]) if len(order) > 1 else scores[order[0]]
    return {"top": top, "topScore": scores[order[0]], "margin": margin,
            "dist": {names[i]: round(dist[i], 4) for i in range(len(names))}}


# ---------------------------------------------------------------- 原语三：score
def score(value: float, low: float = 0.0, high: float = 1.0) -> float:
    """把任意量纲的量映射到 0~1 量表（越界截断，不外推）。"""
    if high <= low:
        return 0.0
    return max(0.0, min(1.0, (value - low) / (high - low)))


# ---------------------------------------------------------------- 置信度
def confidence(top: float, margin: float, coverage: float) -> dict[str, Any]:
    """置信度校准：base 取"最高分"与"领先幅度"各一半，再按覆盖率打折。

    为什么按覆盖率打折：覆盖率低意味着**这套方案只说到了当事人的一部分诉求**，
    这时候再"自信地"下结论是危险的 —— 该做的是继续谈或补证据（escalate）。
    """
    base = 0.5 * top + 0.5 * score(margin, 0.0, 1.0)
    conf = base * (0.6 + 0.4 * max(0.0, min(1.0, coverage)))
    return {"base": round(base, 4), "confidence": round(conf, 4)}


class DecisionKernel:
    """把三个原语收在一起，顺便留调用日志——审计要用它，复盘要靠它。"""

    def __init__(self, temperature: float = TEMPERATURE) -> None:
        self.temperature = temperature
        self.calls: list[dict[str, Any]] = []

    @property
    def name(self) -> str:
        return "mediation-kernel/0.1"

    def choose(self, label: str, buckets: Sequence[tuple[str, float]]) -> dict[str, Any]:
        res = choice(buckets, self.temperature)
        self.calls.append({"label": label, **res})
        return res

    def probe(self, state: dict[str, Any], questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """对外探测入口：给一组 {label, options:[{id, score}]}，直接看分布。"""
        out = []
        for q in questions or []:
            buckets = [(str(o.get("id")), float(o.get("score") or 0)) for o in q.get("options") or []]
            out.append({"label": q.get("label", ""), **choice(buckets, self.temperature)})
        return out
