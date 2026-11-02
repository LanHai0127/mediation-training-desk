#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""调解四维判定 —— 数据驱动，不含任何案名、人名、案 id。

维度（写死在本文件顶部，案子只提供选项与权重）：
  dim_claim    诉求识别：方案解决的是"嘴上要的"还是"实际要的"
  dim_bottom   底线命中：有没有碰到各方真实底线（不是口头要求）
  dim_evidence 证据支撑：关键条款有没有事实撑着，还是空口承诺
  dim_face     台阶给够：有没有给"输不起的那个人"留体面

一条铁律
--------
`evaluate()` 的入参里**没有对话文本**，只有：
  plan —— 玩家选定的方案（维度 → 选项 id）
  ctx  —— 客观状态（分别谈过谁、越界几次、看到哪些事实、各方信任值）
模型说什么都进不来。这不是洁癖，是"判定不被 LLM 污染"的物理隔离点①。
"""
from __future__ import annotations

from typing import Any

from .kernel import DecisionKernel, confidence, noul, score

# ---------------------------------------------------------------- 阈值
# ★ 全部是**经验值**，先拍下来，后面用 4 个案子各跑 30 次统计误判率再校准。
#   不许在这里假装有理论依据。
THRESH_ACT = 0.62          # 置信度过线才"可以下结论"，否则要求继续谈 / 补证据
THRESH_PASS = 0.60         # 总分及格线
RUPTURE_CEILING = 0.40     # 覆盖率天花板低于这个值 = 结构性冲突，硬凑和解不合格
HALF_CREDIT = 0.5          # 命中但缺证据，按半分算

W_COVERAGE = 0.55          # 结果分权重
W_DIMS = 0.25              # 四维质量权重
W_PROCESS = 0.20           # 过程分权重（分别谈话 / 不越界）

DIM_ORDER = ("dim_claim", "dim_bottom", "dim_evidence", "dim_face")


class MediationJudge:
    def __init__(self, case: dict[str, Any], kernel: DecisionKernel | None = None) -> None:
        self.case = case
        self.kernel = kernel or DecisionKernel()
        self.dims = {d["id"]: d for d in case.get("dimensions") or []}
        self.needs = {n["id"]: n for n in case.get("needs") or []}
        if not self.needs:                       # 兼容把 needs 挂在各当事人下面的写法
            for p in (case.get("parties") or {}).values():
                for n in p.get("needs") or []:
                    self.needs[n["id"]] = n
        self.facts = {f["id"] for f in case.get("facts") or []}

    # ------------------------------------------------------------ 可用性
    def _available(self, opt: dict, ctx: dict[str, Any]) -> tuple[bool, str]:
        """当事人当前的信任值够不够接受这个方案。

        谈崩了的人，你给他再漂亮的方案他也签不了字 —— 这一点必须在判定里体现，
        否则"两头都得罪了还能凑出一份协议"就成了这台训练台最大的假。
        """
        req = opt.get("requires") or {}
        for pid, need_trust in (req.get("trust") or {}).items():
            got = float((ctx.get("trust") or {}).get(pid, 0.0))
            if got < float(need_trust):
                return False, "%s 的信任值 %.2f 低于该方案要求的 %.2f" % (pid, got, float(need_trust))
        return True, ""

    # ------------------------------------------------------------ 主判定
    def evaluate(self, plan: dict[str, str], ctx: dict[str, Any], mode: str = "agreement") -> dict[str, Any]:
        plan = plan or {}
        ctx = ctx or {}
        audit: list[dict[str, Any]] = []

        satisfied: dict[str, float] = {}
        invalid_plans: list[dict[str, str]] = []
        dim_rows: list[dict[str, Any]] = []
        qualities: list[float] = []
        missing_facts: list[str] = []
        unavailable: list[dict[str, str]] = []

        for dim_id in DIM_ORDER:
            dim = self.dims.get(dim_id)
            if not dim:
                continue
            opts = dim.get("options") or []
            raw = plan.get(dim_id, "")
            chosen_id = raw if isinstance(raw, str) else ""      # 非字符串一律当没填
            by_id = {o.get("id"): o for o in opts}
            chosen = by_id.get(chosen_id) if chosen_id else None
            # ⚠️ 这里曾经用 noul() 回落取"最像的那个"，结果传一个不存在的 id 会**命中第一个选项**
            #    （往往正是满分项）—— 乱填也能拿 1.00。选项必须精确匹配，匹配不到就是没作答。
            invalid = bool(chosen_id) and chosen is None
            if invalid:
                invalid_plans.append({"dim": dim_id, "option": chosen_id})

            # 该维度上"每个选项有多好"的分布 → 用来算这一维的置信度
            usable = []
            for o in opts:
                ok, why = self._available(o, ctx)
                if not ok:
                    unavailable.append({"dim": dim_id, "option": o.get("id", ""), "why": why})
                    continue
                usable.append(o)
            dist = self.kernel.choose(dim.get("name", dim_id),
                                      [(o["id"], float(o.get("quality", 0.0))) for o in usable])
            # 领先幅度用**原始质量差**，不用 softmax 后的概率差：
            # 概率差会被温度压扁（0.45 的质量差只剩 0.2），置信度就永远过不了线。
            qs = sorted((float(o.get("quality", 0.0)) for o in usable), reverse=True)
            margin = (qs[0] - qs[1]) if len(qs) > 1 else (qs[0] if qs else 0.0)

            if not chosen:
                dim_rows.append({"id": dim_id, "name": dim.get("name", ""), "chosen": "", "quality": 0.0,
                                 "note": "这一维没有给出方案"})
                qualities.append(0.0)
                audit.append({"step": "dim", "dim": dim_id, "option": "", "quality": 0.0,
                              "reason": "未作答，按 0 计"})
                continue

            ok, why = self._available(chosen, ctx)
            q = float(chosen.get("quality", 0.0)) if ok else 0.0

            # 证据：这一条要事实撑，而玩家没看到 → 半分
            need_facts = chosen.get("evidence") or []
            lack = [f for f in need_facts if f not in (ctx.get("facts") or [])]
            if lack and q > 0:
                q *= HALF_CREDIT
                missing_facts.extend(lack)

            # 当事人不接受这条方案时（信任不够），就算它写得再好也不能算命中诉求
            if ok:
                for nid in chosen.get("satisfies") or []:
                    satisfied[nid] = max(satisfied.get(nid, 0.0), 1.0 if not lack else HALF_CREDIT)

            qualities.append(q)
            dim_rows.append({
                "id": dim_id, "name": dim.get("name", ""), "chosen": chosen.get("id", ""),
                "label": chosen.get("label", ""), "quality": round(q, 3),
                "trap": bool(chosen.get("trap")), "note": chosen.get("note", ""),
                "lackFacts": lack, "available": ok, "why": why,
                "dist": dist.get("dist", {}), "margin": round(margin, 4),
            })
            audit.append({"step": "dim", "dim": dim_id, "option": chosen.get("id", ""),
                          "quality": round(q, 3), "lackFacts": lack, "available": ok})

        # ---------------- 覆盖率
        total_w = sum(float(n.get("weight", 0)) for n in self.needs.values()) or 1.0
        got_w = sum(float(self.needs[nid].get("weight", 0)) * v
                    for nid, v in satisfied.items() if nid in self.needs)
        coverage = got_w / total_w

        # ---------------- 天花板：这套方案**最好能做到多少**
        ceiling = 0.0
        for nid, need in self.needs.items():
            best = 0.0
            for dim_id in DIM_ORDER:
                dim = self.dims.get(dim_id)
                if not dim:
                    continue
                for o in dim.get("options") or []:
                    if nid in (o.get("satisfies") or []):
                        ok, _ = self._available(o, ctx)
                        if ok:
                            best = max(best, float(o.get("quality", 0.0)))
            ceiling += float(need.get("weight", 0)) * best
        ceiling /= total_w

        # ---------------- 过程分
        talked = ctx.get("talked") or []
        by_channel = {t.get("channel") for t in talked if isinstance(t, dict)}
        separate_done = "separate" in by_channel
        oversteps = int(ctx.get("oversteps") or 0)
        process = (0.5 if separate_done else 0.0) + 0.5 * max(0.0, 1.0 - oversteps / 2.0)

        # ---------------- 四维置信度
        per_conf = [confidence(float(row.get("quality", 0)), float(row.get("margin", 0)), coverage)["confidence"]
                    for row in dim_rows]
        conf = round(sum(per_conf) / len(per_conf), 4) if per_conf else 0.0
        route = "act" if conf >= THRESH_ACT else "escalate"

        # ---------------- 总分
        dim_avg = sum(qualities) / len(qualities) if qualities else 0.0
        total = W_COVERAGE * coverage + W_DIMS * dim_avg + W_PROCESS * process

        # ---------------- 结局路由
        unanswered = [r["id"] for r in dim_rows if not r.get("chosen")]
        ending, verdict, why = self._route(mode, ceiling, total, oversteps, separate_done,
                                           coverage, unanswered, sorted(set(missing_facts)),
                                           invalid_plans)

        audit.append({"step": "score", "coverage": round(coverage, 4), "ceiling": round(ceiling, 4),
                      "dimAvg": round(dim_avg, 4), "process": round(process, 4),
                      "total": round(total, 4), "confidence": conf, "route": route,
                      "ending": ending})

        return {
            "ok": True,
            "mode": mode,
            "ending": ending,
            "verdict": verdict,
            "why": why,
            "coverage": round(coverage, 4),
            "ceiling": round(ceiling, 4),
            "total": round(total, 4),
            "confidence": conf,
            "route": route,
            "dims": dim_rows,
            "process": {"separateTalk": separate_done, "oversteps": oversteps,
                        "score": round(process, 4)},
            "missingFacts": sorted(set(missing_facts)),
            "unavailable": unavailable,
            "invalidPlan": invalid_plans,
            "satisfiedNeeds": sorted(satisfied),
            "audit": audit,
        }

    @staticmethod
    def _route(mode: str, ceiling: float, total: float,
               oversteps: int, separate_done: bool, coverage: float = 0.0,
               unanswered: list[str] | None = None,
               missing_facts: list[str] | None = None,
               invalid_plans: list[dict[str, str]] | None = None) -> tuple[str, str, str]:
        """结局不是"分高分低"，而是**这件事该怎么办**。

        判定顺序有讲究，写在最前面：
          ① 方案本身不成立（选了不存在的项）→ 无效，先别谈结论
          ② 转办：只取决于"还有没有得谈"（天花板），与方案填得好不好无关
          ③ 方案没填完 → 待补
          ④ 结构性冲突（天花板 < 0.40）→ 硬凑不合格；转办已经在上一步判过了
          ⑤ 关键条款缺证据 → 待补（补证据能救，谈崩了补不了）
          ⑥ 程序与过程 → ⑦ 结果分
        """
        if invalid_plans:
            return ("bad_plan", "无效", "方案里有不属于本案的选项：%s —— 请重新选择"
                    % "、".join("%s/%s" % (x["dim"], x["option"]) for x in invalid_plans))

        rupture = ceiling < RUPTURE_CEILING
        if mode == "refer":
            if rupture:
                return ("rupture_referred", "合格",
                        "双方底线存在结构性冲突，覆盖率天花板只有 %.2f，依法告知并转办是正确处置" % ceiling)
            return ("early_giveup", "不合格", "还有可谈的余地，过早转办等于把矛盾推回去")

        if unanswered:
            return ("need_more", "待补", "还有 %d 个维度没给方案：%s" % (len(unanswered), "、".join(unanswered)))
        # 底线冲突优先于"缺证据"：两头已经谈崩了，再补证据也签不下来
        if rupture:
            return ("forced_agreement", "不合格",
                    "双方底线无法同时满足（天花板 %.2f），此时凑出的协议签了也执行不了" % ceiling)
        if missing_facts:
            return ("need_more", "待补", "关键条款缺证据支撑：%s" % "、".join(missing_facts))

        if not separate_done:
            return ("no_separate", "不合格", "没有分别谈话，直接面对面容易把人逼到墙角")
        if oversteps >= 2:
            return ("overpromised", "不合格", "越界承诺 %d 次，答应了做不到的事，后面收不了场" % oversteps)
        if total >= THRESH_PASS:
            return ("reached", "合格", "覆盖率 %.2f，四维与过程都过线" % coverage)
        return ("reached_weak", "勉强", "谈成了，但方案只覆盖了一部分真实诉求，后续容易反弹")
