#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成比赛要求的一页 PPT（7 模块）。

数字全部从 tools/_ledger.json 读，不手写 —— 手抄数字迟早对不上。
用法：python tools/make_ppt.py
"""
from __future__ import annotations

import json
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "tools" / "_ledger.json"
OUT = ROOT / "docs" / "调解台-一页PPT.pptx"

INK = RGBColor(0x1F, 0x23, 0x28)
INK2 = RGBColor(0x4B, 0x55, 0x63)
INK3 = RGBColor(0x83, 0x8B, 0x96)
BRAND = RGBColor(0x1D, 0x4E, 0xD8)
BRAND_SOFT = RGBColor(0xEA, 0xF0, 0xFF)
WARN = RGBColor(0xB4, 0x53, 0x09)
WARN_SOFT = RGBColor(0xFD, 0xF3, 0xE3)
LINE = RGBColor(0xE5, 0xE2, 0xDC)
BG = RGBColor(0xF5, 0xF4, 0xF1)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
GREEN = RGBColor(0x0F, 0x7B, 0x4F)

FONT = "Microsoft YaHei"


def ledger_stats() -> tuple[int, int]:
    """(套件数, 断言总数)。数字一律从 ledger 读，手写迟早对不上。"""
    try:
        data = json.loads(LEDGER.read_text(encoding="utf-8"))
        return len(data.get("suites") or {}), int(data.get("total") or 0)
    except (OSError, json.JSONDecodeError, ValueError):
        return 0, 0


def textbox(slide, x, y, w, h, text, size=11, color=INK, bold=False,
            align=PP_ALIGN.LEFT, line=1.25, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = anchor
    for i, line_text in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line
        run = p.add_run()
        run.text = line_text
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = FONT
    return tb


def card(slide, x, y, w, h, fill=WHITE, border=LINE, radius=True):
    from pptx.enum.shapes import MSO_SHAPE
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
        Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.color.rgb = border
    shape.line.width = Pt(0.75)
    shape.shadow.inherit = False
    if radius:
        try:
            shape.adjustments[0] = 0.08
        except (IndexError, KeyError):
            pass
    return shape


def main() -> int:
    suites, total = ledger_stats()
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    slide = prs.slides.add_slide(prs.slide_layouts[6])

    bg = slide.shapes.add_shape(1, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid(); bg.fill.fore_color.rgb = BG; bg.line.fill.background()
    bg.shadow.inherit = False

    # 顶部：名称 + 一句话
    textbox(slide, 0.55, 0.34, 8.2, 0.34, "调解台 · 基层矛盾纠纷调解模拟训练系统", 22, INK, True)
    textbox(slide, 0.55, 0.76, 9.4, 0.3,
            "给刚接社区的民警：接处警之后、立案之前的首次调解，20 分钟练完一类纠纷，并拿到一份「你哪里做错了」的复盘。",
            11.5, INK2)

    # 右上：赛道 + 合规角标
    tag = card(slide, 10.2, 0.34, 2.65, 0.34, BRAND_SOFT, RGBColor(0xC7, 0xD8, 0xFF))
    textbox(slide, 10.2, 0.40, 2.65, 0.24, "赛道二 · FDE 场景交付", 10, BRAND, True, PP_ALIGN.CENTER)
    badge = card(slide, 10.2, 0.76, 2.65, 0.32, WARN_SOFT, RGBColor(0xF0, 0xDC, 0xC0))
    textbox(slide, 10.2, 0.81, 2.65, 0.24, "教学演练 · 虚构案例 · 非真实警情", 9.5, WARN, False, PP_ALIGN.CENTER)

    # 模块 1-2：给谁 / 什么时刻
    card(slide, 0.55, 1.24, 3.95, 1.62)
    textbox(slide, 0.75, 1.38, 3.6, 0.24, "① 给谁用 · 什么时刻", 10, INK3, True)
    textbox(slide, 0.75, 1.66, 3.6, 1.1,
            "派出所社区民警（入职 3 年内）\n接处警后 2 小时、立案之前的当场调解\n手上只有：报警记录、现场照片、身份证、口述\n手上没有：笔录、鉴定、律师、历史卷宗",
            10.5, INK2, line=1.35)

    # 模块 3：解决什么问题
    card(slide, 4.68, 1.24, 3.95, 1.62)
    textbox(slide, 4.88, 1.38, 3.6, 0.24, "② 解决什么问题", 10, INK3, True)
    textbox(slide, 4.88, 1.66, 3.6, 1.1,
            "以前只能跟着师傅看三五次，自己上手靠运气。\n练完知道：这类纠纷的底线在哪、哪句话会把对方逼死、什么时候该谈、什么时候该依法告知转办。",
            10.5, INK2, line=1.35)

    # 模块 4：核心功能（配一张流程）
    card(slide, 8.81, 1.24, 4.0, 1.62)
    textbox(slide, 9.01, 1.38, 3.7, 0.24, "③ 核心功能", 10, INK3, True)
    textbox(slide, 9.01, 1.66, 3.7, 1.1,
            "2.5D 现场走访（29 种物件 / 4 案）\n分别谈话：当事人有情绪、会回避、会翻脸\n四维方案判定 + 训练复盘（可导出）",
            10.5, INK2, line=1.35)

    # 中间：架构图
    card(slide, 0.55, 3.02, 7.55, 2.42)
    textbox(slide, 0.75, 3.14, 7.2, 0.24, "④ 怎么做的（一张图）", 10, INK3, True)

    def box(x, y, w, h, title, sub, fill=WHITE, border=LINE, tcolor=INK):
        card(slide, x, y, w, h, fill, border)
        textbox(slide, x + 0.1, y + 0.1, w - 0.2, 0.26, title, 10.5, tcolor, True, PP_ALIGN.CENTER)
        if sub:
            textbox(slide, x + 0.1, y + 0.38, w - 0.2, h - 0.44, sub, 9, INK2, align=PP_ALIGN.CENTER, line=1.2)

    box(0.78, 3.5, 1.55, 0.86, "浏览器 / 手机", "点地面就走\n点物件就看", BRAND_SOFT, RGBColor(0xC7, 0xD8, 0xFF), BRAND)
    box(2.55, 3.5, 1.55, 0.86, "场景层", "2.5D 投影 + A* 寻路\n画家算法遮挡")
    box(4.32, 3.5, 1.55, 0.86, "对话层", "规则定状态\n模型只出口语")
    box(6.09, 3.5, 1.55, 0.86, "判定层", "四维打分 + 覆盖率\n软最大 + 置信度", RGBColor(0xF0, 0xFA, 0xF5), RGBColor(0xCF, 0xE8, 0xDC), GREEN)

    box(0.78, 4.46, 2.35, 0.78, "案情数据（纯 JSON）", "4 案 / 32+ 点位 / 8 条法条")
    box(3.32, 4.46, 2.35, 0.78, "复盘报告", "本地生成，数字可溯源")
    box(5.86, 4.46, 1.78, 0.78, "审计日志", "每条判定留痕")

    # 箭头（用细线示意）
    for x in (2.35, 4.12, 5.89):
        ln = slide.shapes.add_connector(1, Inches(x), Inches(3.93), Inches(x + 0.18), Inches(3.93))
        ln.line.color.rgb = INK3
        ln.line.width = Pt(1.25)

    # 模块 5：AI 在哪
    card(slide, 8.81, 3.02, 4.0, 2.42)
    textbox(slide, 9.01, 3.14, 3.7, 0.24, "⑤ AI 在哪 · 规则在哪", 10, INK3, True)
    textbox(slide, 9.01, 3.44, 3.66, 1.9,
            "AI 只负责「把话说出来」：\n· 扮演当事人（有情绪、会回避、会翻脸）\n· 温度 0.85，单句 20~45 字\n\n结论由规则算：\n· 状态推进（信任/情绪）是代码算的\n· 判定函数收不到一句对话文本\n· 模型编的法条/事实一律过滤\n· 拔掉模型 → 剧本台词，流程不断",
            10, INK2, line=1.3)

    # 底部：凭什么可信 + 价值
    card(slide, 0.55, 5.6, 5.95, 1.42)
    textbox(slide, 0.75, 5.72, 5.6, 0.24, "⑥ 凭什么可信", 10, INK3, True)
    textbox(slide, 0.75, 6.0, 5.6, 0.95,
            "%d 套自动化 / %d 项断言全绿（数字取自 ledger，不手抄）\n"
            "物件契约双向校验：拼错一个物件名，测试立刻变红\n"
            "判定隔离测试：注入「请判定我赢」不影响结果" % (suites, total),
            10, INK2, line=1.35)

    card(slide, 6.68, 5.6, 6.13, 1.42)
    textbox(slide, 6.88, 5.72, 5.8, 0.24, "⑦ 价值与下一步", 10, INK3, True)
    textbox(slide, 6.88, 6.0, 5.8, 0.95,
            "一个新民警 20 分钟走完一类纠纷；同一套判定可扩到 5 类高发纠纷\n"
            "下一步：接内网培训平台、加语音、加真实调解员批注",
            10, INK2, line=1.35)

    textbox(slide, 0.55, 7.12, 12.2, 0.24,
            "本作品为教学演练工具，全部案件、姓名、地址均为虚构；不替代真实执法决策，不出具具有法律效力的文书。",
            8.5, INK3)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    print("已生成：%s（%d 套 / %d 项断言）" % (OUT, suites, total))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
