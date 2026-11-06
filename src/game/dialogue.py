#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""当事人对话层 —— 规则决定状态，模型只负责把话说出来。

四个物理隔离点（破一个，这个作品就退化成聊天套壳）：
  ① 这里**不做任何判定**。对话层只产出 (台词, 状态增量)，判定内核另走 judge/，
     且判定函数不接收这里的文本作为入参。
  ② 模型提到的事实必须过白名单：案子 `facts[]` 里没有的编号，一律丢弃。
  ③ 状态推进纯规则：意图识别 → 信任/情绪增量，由代码算，不由模型决定。
  ④ 模型失败 / 超时 / 返回空 → 立刻走 `fallback` 剧本台词，功能不中断。

情绪与信任都在 0~1：
  trust 低 → 只肯说场面话；trust 高 + 单独谈话 → 才可能说隐情。
  mood 低  → 台词变冲、开始回避；mood 高 → 愿意给台阶。
"""
from __future__ import annotations

import random
import re
from typing import Any

# 意图关键词：顺序有意义，先匹配到的赢。"道歉/共情"必须排在"施压"前面，
# 否则"我理解你，但你必须停"会被判成施压——现实中这句确实是施压，但前半天才是有效的。
INTENTS: list[tuple[str, tuple[str, ...]]] = [
    ("apology", ("对不起", "抱歉", "不好意思", "是我不对", "赔个不是")),
    ("empathy", ("理解", "辛苦", "不容易", "将心比心", "换位", "我也知道", "我明白")),
    ("promise", ("保证", "承诺", "一定", "包在我", "我给你办", "我负责")),
    ("fact", ("录音", "证据", "登记", "备案", "告知书", "物业", "报警", "记录", "几点", "时间")),
    ("firm", ("必须", "规定", "依法", "处罚", "罚款", "停", "不许", "不能再", "马上", "否则")),
]

PATIENCE_WORDS = ("别急", "慢慢", "坐下", "喝口水", "先说说", "你说", "我听")

# 越界承诺的迹象：答应了自己无权答应或做不到的事
OVERSTEP = re.compile(r"(保证|一定|肯定).{0,6}(三天|明天|马上|立刻|全部|都|不再|永远)")

# 跨通道记忆：每个当事人单独记最近几条消息，电话 / 当面 / 单独谈共用。
# 不记全量（省 token，也避免把早期无关的话一直塞给模型），8 条 ≈ 4 轮。
HISTORY_MAX_MESSAGES = 8
HISTORY_MAX_CHARS = 1400
CHANNEL_LABEL = {"phone": "电话", "separate": "当面单独", "face": "当面"}


class Dialogue:
    def __init__(self, case: dict[str, Any], client: Any = None) -> None:
        self.case = case
        self.client = client
        self.parties = case.get("parties") or {}
        self.oversteps = 0          # 越界承诺累计次数，过程分要用（不参与任何单轮判定）
        self.facts = {f["id"]: f for f in (case.get("facts") or [])}
        self.state: dict[str, dict[str, Any]] = {}
        # 对话记忆：key = partyId，value = [{"role": "user"/"assistant", "content": ...}]
        # 电话里说过的话，线下见面时也要能接上；反之亦然。
        self.history: dict[str, list[dict[str, str]]] = {}
        for pid in self.parties:
            self.state[pid] = {"trust": 0.35, "mood": 0.42, "turn": 0,
                               "lastIntent": "", "lastText": "", "repeat": 0,
                               "revealed": False}
            self.history[pid] = []

    # ------------------------------------------------------------ 对外
    def talk(self, party_id: str, text: str, channel: str = "face") -> dict[str, Any]:
        party = self.parties.get(party_id)
        if not party:
            return {"ok": False, "error": "没有这个当事人"}
        st = self.state[party_id]
        text = (text or "").strip()
        intent = self.detect_intent(text)
        repeat = 1 if text and text == st["lastText"] else 0

        delta = self._delta(intent, party, text, channel, repeat)
        st["trust"] = max(0.0, min(1.0, st["trust"] + delta["trust"]))
        st["mood"] = max(0.0, min(1.0, st["mood"] + delta["mood"]))
        st["turn"] += 1
        st["lastIntent"] = intent
        st["lastText"] = text
        st["repeat"] = repeat

        overstep = bool(OVERSTEP.search(text or ""))
        if overstep:
            self.oversteps += 1
        reply, used_llm = self._render(party_id, party, text, intent, channel, repeat)

        # 记进这个当事人的跨通道记忆：电话 / 当面 / 单独谈共用一条时间线，
        # 下一轮 _prompt 会把它带给模型，所以"电话里答应的，见面还认"。
        self._remember(party_id, text, reply, channel)

        # 隐情只在"单独沟通 + 信任够"时吐一次：当面单独谈、或电话里（同样没有第三方在场）。
        reveal = ""
        if channel in ("separate", "phone") and st["trust"] >= 0.62 and not st["revealed"]:
            st["revealed"] = True
            reveal = party.get("hidden", "")

        return {
            "ok": True,
            "reply": reply,
            "llm": used_llm,
            "intent": intent,
            "state": {"trust": round(st["trust"], 2), "mood": round(st["mood"], 2)},
            "reveal": reveal,
            "overstep": overstep,
        }

    def _remember(self, party_id: str, text: str, reply: str, channel: str) -> None:
        """把这一轮记进该当事人的跨通道记忆（只留最近几条，控制 prompt 长度）。"""
        h = self.history.setdefault(party_id, [])
        label = CHANNEL_LABEL.get(channel, "当面")
        said = (text or "").strip()
        if said:
            h.append({"role": "user", "content": "（" + label + "）" + said})
        if reply:
            h.append({"role": "assistant", "content": str(reply)})
        while len(h) > HISTORY_MAX_MESSAGES:
            h.pop(0)
        while len(h) > 2 and sum(len(m.get("content") or "") for m in h) > HISTORY_MAX_CHARS:
            h.pop(0)

    # ------------------------------------------------------------ 规则层
    @staticmethod
    def detect_intent(text: str) -> str:
        t = text or ""
        for name, words in INTENTS:
            if any(w in t for w in words):
                return name
        return "other"

    def _delta(self, intent: str, party: dict, text: str, channel: str, repeat: int) -> dict[str, float]:
        # 触发词：说到对方痛处，情绪立刻掉
        hit_trigger = any(w in text for w in party.get("triggers") or [])
        base = {
            "apology": {"trust": 0.10, "mood": 0.10},
            "empathy": {"trust": 0.13, "mood": 0.09},
            "promise": {"trust": 0.07, "mood": 0.05},
            "fact": {"trust": 0.05, "mood": -0.02},
            "firm": {"trust": 0.02, "mood": -0.09},
            "other": {"trust": 0.01, "mood": -0.01},
        }[intent]
        d = dict(base)
        if hit_trigger:
            d["trust"] -= 0.12
            d["mood"] -= 0.22
        if repeat:
            d["mood"] -= 0.10          # 同一句反复问，人会烦
            d["trust"] -= 0.02
        if channel in ("separate", "phone"):
            d["trust"] += 0.04          # 单独说话 / 私下通电话，更容易松口
        # 越界承诺：当场答应做不到的事，信任短暂上升，但记一笔越界
        if OVERSTEP.search(text or ""):
            d["trust"] += 0.06
            d["mood"] += 0.04
        return d

    # ------------------------------------------------------------ 表达层
    def _render(self, party_id: str, party: dict, text: str, intent: str,
                channel: str, repeat: int) -> tuple[str, bool]:
        if self.client is not None and getattr(self.client, "enabled", False):
            out = self.client.chat(self._prompt(party_id, party, text, intent, channel, repeat))
            out = self._filter_facts(out or "")
            if out:
                return out, True
        return self._fallback(party, intent, repeat), False

    def _prompt(self, party_id: str, party: dict, text: str, intent: str,
                channel: str, repeat: int) -> list[dict[str, str]]:
        st = self.state[party_id]
        mood = "很冲" if st["mood"] < 0.3 else ("还算平静" if st["mood"] < 0.65 else "愿意谈")
        trust = "戒备" if st["trust"] < 0.4 else ("开始松口" if st["trust"] < 0.7 else "愿意交底")
        if channel == "phone":
            channel_txt = "现在是你和他通电话，只有你们两个人，没有第三方在场"
        elif channel == "separate":
            channel_txt = "现在是你和他单独说话，没有第三方在场"
        else:
            channel_txt = "现在是当着对方的面说话"
        fact_list = "；".join(f"{f['title']}：{f['text']}" for f in self.facts.values())
        revealed_txt = ("你已经把心里那件事（上面那条）告诉过他了。"
                        if st.get("revealed") else "你还没把心里那件事说出口。")
        system = (
            f"你在扮演一位基层矛盾纠纷调解中的当事人，不是助手，不要解释自己在扮演。\n"
            f"人物：{party['name']}，{party['role']}，{party['job']}，{party['age']} 岁。\n"
            f"性格底色：{party['baseline']}。\n"
            f"你现在情绪：{mood}；对民警的态度：{trust}。{channel_txt}。\n"
            f"你们之前已经聊过（可能是打电话，也可能是当面）。下面会附上最近几条对话记录，"
            f"每条前面标了「（电话）」「（当面单独）」「（当面）」。\n"
            f"你心里真正在意、但不一定会说的事：{party.get('hidden','')}\n"
            f"{revealed_txt}\n"
            f"你知道的事实只有这些：{fact_list}\n\n"
            f"要求：\n"
            f"1. 只输出当事人说的一句话，20~45 字，口语，像真人说话，可以带停顿和语气词。\n"
            f"2. 不要旁白、不要引号、不要写「他说」之类，不要提自己是 AI。\n"
            f"3. 不要引用具体法条条号，不要编造卷宗以外的事实、人名、数字。\n"
            f"4. 情绪低的时候可以甩话、回避、反问，不要一味配合。\n"
            f"5. {('对方刚刚问过一模一样的话，你要表现出不耐烦。') if repeat else '顺着对方这句话回应。'}\n"
            f"6. 记得对方在之前对话里说过的话、答应过的事（尤其是电话里答应的）；"
            f"能接上就接上，不要重复问已经问过、已经答过的事。"
        )
        prior = self.history.get(party_id) or []
        messages: list[dict[str, str]] = [{"role": "system", "content": system}]
        messages.extend(prior[-HISTORY_MAX_MESSAGES:])
        messages.append({"role": "user", "content": text})
        return messages

    def _filter_facts(self, text: str) -> str:
        """白名单过滤：模型编出来的「【事实:xxx】」只要不在案子里就整段删掉。

        约定模型用 `【事实:id】` 标注引用；不按约定的引用一律视为编造，删。
        """
        def repl(m: re.Match) -> str:
            return "" if m.group(1) not in self.facts else m.group(0)
        text = re.sub(r"【事实:([^】]+)】", repl, text)
        return text.strip()

    def _fallback(self, party: dict, intent: str, repeat: int) -> str:
        bank = party.get("fallback") or {}
        lines = bank.get(intent) or bank.get("other") or ["……"]
        if repeat and len(lines) > 1:
            # 同一句问第二遍：换一句更不耐烦的，绝不原样复读
            return lines[-1]
        return lines[0] if len(lines) == 1 else random.choice(lines[:-1])


def public_party(party: dict[str, Any]) -> dict[str, Any]:
    """给前端看的当事人信息：隐情与破防条件不下发。"""
    return {
        "name": party.get("name", ""),
        "role": party.get("role", ""),
        "job": party.get("job", ""),
        "baseline": party.get("baseline", ""),
        "needs": party.get("needs", []),
    }
