#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""法条速查 —— 本地检索，只作提示，不参与判定。

三条规矩：
  ① 每条结果必须带 `id`，界面上点得开、能追到是哪个法第几条；
  ② 只放**要点摘录**，并且文件里写明"非逐字原文、以正式文本为准" —— 不假装是原文；
  ③ 检索不到就返回空。宁可什么都不给，也不让模型自己编一条条文出来。

实现不用向量库：条文只有几十条，字面打分（标签命中 + 字重叠）足够快也足够准，
还省了一个依赖。
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_LAWS: list[dict[str, Any]] = []
_META: dict[str, Any] = {}


def load(root: Path) -> dict[str, Any]:
    """载入条文（服务启动时调一次）。文件缺失不报错，检索就返回空。"""
    global _LAWS, _META
    path = Path(root) / "laws" / "laws.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _LAWS, _META = [], {}
        return {"count": 0, "note": "条文库未载入"}
    _LAWS = list(data.get("articles") or [])
    _META = {"note": data.get("note", ""), "count": len(_LAWS)}
    return _META


def _tokens(text: str) -> set[str]:
    """粗糙但够用的分词：取 2~4 字的连续汉字片段。中文法条检索不需要更复杂。"""
    chars = re.sub(r"[^\u4e00-\u9fa5]", "", text or "")
    out = set()
    for n in (2, 3, 4):
        for i in range(len(chars) - n + 1):
            out.add(chars[i:i + n])
    return out


def search(query: str, limit: int = 3) -> list[dict[str, Any]]:
    q = _tokens(query)
    if not q or not _LAWS:
        return []
    scored = []
    for a in _LAWS:
        hay = " ".join([a.get("title", ""), a.get("gist", ""), " ".join(a.get("tags") or [])])
        hit = len(q & _tokens(hay))
        if hit:
            scored.append((hit, a))
    scored.sort(key=lambda x: (-x[0], x[1]["id"]))
    return [a for _, a in scored[:limit]]


def by_ids(ids: list[str]) -> list[dict[str, Any]]:
    want = set(ids or [])
    return [a for a in _LAWS if a["id"] in want]


def meta() -> dict[str, Any]:
    return dict(_META)
