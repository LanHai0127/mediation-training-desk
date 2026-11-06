# -*- coding: utf-8 -*-
"""把 src/cases/*/case.json 的 parties.*.fallback 原样抽成前端问话数据。

只做搬运：回答数组逐字复制，不重写；话题=对话层已有的 5 个意图（dialogue.py INTENTS）。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES = ["case_06_wall", "case_05_court", "case_00_flame"]

TOPICS = [
    {"id": "empathy", "label": "先听他说", "intent": "empathy",
     "ask": "我理解你的难处，你先坐下，慢慢说。"},
    {"id": "apology", "label": "先道个歉", "intent": "apology",
     "ask": "刚才是我态度不好，对不起。"},
    {"id": "fact", "label": "问清事实", "intent": "fact",
     "ask": "把当时的情况说清楚：几点、谁在场、有没有证据。"},
    {"id": "firm", "label": "讲清规矩", "intent": "firm",
     "ask": "这件事必须按规定办，不能再这么拖。"},
    {"id": "other", "label": "让他自己说", "intent": "other",
     "ask": "你还有什么想说的，都说出来。"},
]

out = {
    "_meta": {
        "source": "src/cases/<case>/case.json → parties.<pid>.fallback",
        "topicsFrom": "src/game/dialogue.py INTENTS（对话层已有的五个意图）",
        "note": "回答逐字搬运；服务端 /api/dialogue 可用时以服务端为准，本文件只做离线兜底。",
    },
    "topics": TOPICS,
    "cases": {},
}

for cid in CASES:
    data = json.load(open(ROOT / "src" / "cases" / cid / "case.json", encoding="utf-8"))
    parties = {}
    for pid, p in (data.get("parties") or {}).items():
        banks = {k: list(v) for k, v in (p.get("fallback") or {}).items() if isinstance(v, list)}
        parties[pid] = {
            "name": p.get("name", ""),
            "role": p.get("role", ""),
            "job": p.get("job", ""),
            "baseline": p.get("baseline", ""),
            "answers": banks,
        }
    out["cases"][cid] = {
        "title": data.get("title", ""),
        "partyOrder": data.get("partyOrder", list(parties)),
        "parties": parties,
    }

path = ROOT / "src" / "web" / "cases_dialog.json"
path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print("wrote", path, path.stat().st_size, "bytes")
for cid, c in out["cases"].items():
    print(cid, {pid: sorted(v["answers"]) for pid, v in c["parties"].items()})
