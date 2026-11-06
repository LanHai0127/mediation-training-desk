#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成答辩完整版 PPT：公安调解模拟训练台。

所有事实与数字来自 PROJECT.md / TASKS.md / LOG.md / CHECKLIST.md / tools/_ledger.json，
截图来自 tools/_logs 下的真实运行截图。运行：python tools/make_full_ppt.py
"""
from __future__ import annotations

from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "ppt_assets"
OUT = ROOT / "docs" / "公安调解模拟训练台-完整版PPT.pptx"

# ------------------------------------------------------------------ design tokens
INK = RGBColor(0x22, 0x34, 0x3D)
INK2 = RGBColor(0x3C, 0x50, 0x58)
INK3 = RGBColor(0x6E, 0x7D, 0x80)
INK4 = RGBColor(0x95, 0xA0, 0x9F)
PAPER = RGBColor(0xF3, 0xED, 0xE0)
PAPER2 = RGBColor(0xFB, 0xF6, 0xEC)
PAPER3 = RGBColor(0xE8, 0xDD, 0xC9)
LINE = RGBColor(0xD8, 0xCC, 0xB8)
CORAL = RGBColor(0xD4, 0x62, 0x4C)
CORAL2 = RGBColor(0xF1, 0xD8, 0xCF)
TEAL = RGBColor(0x3E, 0x78, 0x73)
TEAL2 = RGBColor(0xD9, 0xE7, 0xDF)
BLUE = RGBColor(0x59, 0x8E, 0x9E)
BLUE2 = RGBColor(0xDC, 0xE9, 0xEB)
GOLD = RGBColor(0xB8, 0x8A, 0x4C)
CREAM = RGBColor(0xFF, 0xF8, 0xEA)
WHITE = RGBColor(0xFF, 0xFC, 0xF5)

SERIF = "Noto Serif SC"
SANS = "Microsoft YaHei"
MONO = "Consolas"

W, H = 13.333, 7.5
TOTAL = 18


def _style_run(run, size, color, bold=False, font=SANS, italic=False, space=0):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    run.font.name = font
    rpr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rpr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rpr, qn(tag))
        el.set("typeface", font)
    if space:
        rpr.set("spc", str(int(space)))


def text(slide, x, y, w, h, value, size=12, color=INK, bold=False,
         font=SANS, align=PP_ALIGN.LEFT, line=1.25, anchor=MSO_ANCHOR.TOP,
         italic=False, space=0, margin=0):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = anchor
    lines = str(value).split("\n")
    for i, line_text in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line
        p.space_before = Pt(0)
        p.space_after = Pt(0)
        run = p.add_run()
        run.text = line_text
        _style_run(run, size, color, bold, font, italic, space)
    return box


def rich(slide, x, y, w, h, paragraphs, anchor=MSO_ANCHOR.TOP):
    """paragraphs: list of dict(runs=[(text, size, color, bold, font)], align, line)."""
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = anchor
    for i, para in enumerate(paragraphs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = para.get("align", PP_ALIGN.LEFT)
        p.line_spacing = para.get("line", 1.2)
        p.space_before = Pt(0)
        p.space_after = Pt(para.get("after", 0))
        for item in para["runs"]:
            value, size, color, bold = item[0], item[1], item[2], item[3]
            font = item[4] if len(item) > 4 else SANS
            run = p.add_run()
            run.text = value
            _style_run(run, size, color, bold, font)
    return box


def _strip_style(obj):
    """Remove the theme style reference so LibreOffice/PowerPoint do not add a default shadow."""
    style = obj._element.find(qn("p:style"))
    if style is not None:
        obj._element.remove(style)


def rect(slide, x, y, w, h, fill=WHITE, line=None, lw=0.75, radius=None,
         dash=None, shape=None):
    if shape is None:
        shape = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    obj = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    obj.shadow.inherit = False
    _strip_style(obj)
    if fill is None:
        obj.fill.background()
    else:
        obj.fill.solid()
        obj.fill.fore_color.rgb = fill
    if line is None:
        obj.line.fill.background()
    else:
        obj.line.color.rgb = line
        obj.line.width = Pt(lw)
        if dash:
            obj.line.dash_style = dash
    if radius:
        try:
            obj.adjustments[0] = radius
        except (IndexError, KeyError):
            pass
    return obj


def line(slide, x1, y1, x2, y2, color=LINE, lw=0.75, dash=None):
    obj = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1),
                                     Inches(x2), Inches(y2))
    obj.line.color.rgb = color
    obj.line.width = Pt(lw)
    if dash:
        obj.line.dash_style = dash
    return obj


def circle(slide, x, y, d, fill=CORAL, line_color=None, lw=0.75):
    return rect(slide, x, y, d, d, fill=fill, line=line_color, lw=lw, shape=MSO_SHAPE.OVAL)


def num_circle(slide, x, y, d, value, fill=CORAL, color=CREAM, size=9.5):
    circle(slide, x, y, d, fill=fill)
    text(slide, x, y + 0.005, d, d - 0.01, value, size=size, color=color, bold=True,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, line=1.0)


def pill(slide, x, y, w, h, value, fill=PAPER2, color=INK2, border=LINE, size=8.5, bold=False):
    rect(slide, x, y, w, h, fill=fill, line=border, lw=0.6, radius=0.5)
    text(slide, x, y + 0.01, w, h - 0.02, value, size=size, color=color, bold=bold,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, line=1.0)


def photo(slide, path, x, y, w, h, mat=0.06, mat_fill=PAPER2, border=LINE):
    rect(slide, x - mat, y - mat, w + mat * 2, h + mat * 2, fill=mat_fill, line=border, lw=0.6)
    slide.shapes.add_picture(str(path), Inches(x), Inches(y), width=Inches(w), height=Inches(h))


def arrow(slide, x, y, direction="right", w=0.28, h=0.16, color=CORAL):
    shape = MSO_SHAPE.RIGHT_ARROW if direction == "right" else MSO_SHAPE.DOWN_ARROW
    obj = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    obj.shadow.inherit = False
    _strip_style(obj)
    obj.fill.solid()
    obj.fill.fore_color.rgb = color
    obj.line.fill.background()


def new_slide(prs, bg=PAPER):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = bg
    return s


def body_frame(slide, section, title, subtitle=None, page=None, title_size=28):
    # left file-margin rule
    line(slide, 0.42, 0.34, 0.42, 7.01, LINE, 0.75)
    rect(slide, 0.375, 0.355, 0.09, 0.09, fill=CORAL)
    text(slide, 0.75, 0.33, 11.0, 0.2, section, 8.6, CORAL, True, space=90)
    text(slide, 0.73, 0.60, 12.0, 0.52, title, title_size, INK, True, font=SERIF, line=1.03)
    if subtitle:
        text(slide, 0.75, 1.16, 11.5, 0.38, subtitle, 11.5, INK2, line=1.35)
    # footer
    line(slide, 0.72, 7.05, 12.61, 7.05, LINE, 0.6)
    text(slide, 0.72, 7.11, 9.8, 0.2,
         "公安调解模拟训练台　教学演练 · 虚构案例 · 非真实警情", 7.0, INK3)
    if page is not None:
        text(slide, 11.9, 7.10, 0.7, 0.2, "%02d / %d" % (page, TOTAL), 8.0, CORAL,
             True, align=PP_ALIGN.RIGHT, font=MONO)


def dark_footer(slide, page=None):
    line(slide, 0.72, 7.05, 12.61, 7.05, RGBColor(0x77, 0x88, 0x86), 0.6)
    text(slide, 0.72, 7.11, 9.8, 0.2,
         "公安调解模拟训练台　教学演练 · 虚构案例 · 非真实警情", 7.0, RGBColor(0xC8, 0xC2, 0xB4))
    if page is not None:
        text(slide, 11.9, 7.10, 0.7, 0.2, "%02d / %d" % (page, TOTAL), 8.0, CORAL,
             True, align=PP_ALIGN.RIGHT, font=MONO)


def add_notes(slide, value):
    slide.notes_slide.notes_text_frame.text = value


# ====================================================================== build
def main() -> None:
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)

    # ---------------------------------------------------------------- 01 cover
    s = new_slide(prs, INK)
    s.shapes.add_picture(str(ASSETS / "cover_wall.jpg"), 0, 0, width=Inches(W), height=Inches(H))
    # left vertical accent
    rect(s, 0.62, 1.48, 0.055, 3.75, fill=CORAL)
    text(s, 0.78, 0.55, 7.0, 0.24, "72 小时黑客松　·　赛道二　·　FDE 场景交付",
         9.5, CREAM, True, space=60)
    text(s, 0.77, 1.44, 8.2, 0.9, "公安调解\n模拟训练台", 42, CREAM, True, font=SERIF, line=1.12)
    text(s, 0.80, 3.28, 7.5, 0.4, "让第一次独立调解，发生在训练里。", 19, CREAM, font=SERIF)
    text(s, 0.80, 3.83, 6.35, 0.80,
         "给入职三年内的社区民警：接处警之后、立案之前的 20 分钟，\n走完一类纠纷，并拿到一份可执行的复盘。",
         11.5, RGBColor(0xEF, 0xE7, 0xD7), line=1.55)
    text(s, 0.80, 4.72, 6.55, 0.28,
         "也给业外人士：10 分钟走进一场调解，看懂民警难在哪。",
         9.8, RGBColor(0xF4, 0xC9, 0xB9), line=1.3)
    # a small centered seal-like label at right
    rect(s, 9.47, 5.58, 3.12, 1.02, fill=RGBColor(0xFF, 0xF5, 0xE1), line=RGBColor(0xE4, 0xC9, 0xAE), lw=0.6)
    text(s, 9.64, 5.70, 2.8, 0.24, "调 解 台", 11.5, INK, True, font=SERIF, space=120)
    text(s, 9.64, 6.01, 2.8, 0.2, "基层矛盾纠纷调解训练系统", 7.8, INK3)
    text(s, 9.64, 6.25, 2.8, 0.18, "MEDIATION DESK / v0.1", 6.2, INK4, font=MONO)
    text(s, 0.80, 6.66, 7.8, 0.24,
         "3 个案子　·　10 场微缩场景　·　9 个手机功能　·　10 套 / 228 项断言",
         8.7, RGBColor(0xD9, 0xD2, 0xC2))
    add_notes(s, "开场先立住两句话：公安专业需要一个不枯燥的方式提前练调解；普通用户也能通过体验看懂调解，形成宣传。")

    # ---------------------------------------------------------------- 02 background
    s = new_slide(prs)
    body_frame(s, "01 / 项目背景 · 为什么", "为什么需要一台‘调解训练台’？",
               "公安专业要提前练，业外人士要看得懂；两种需求，指向同一个现场。", 2)
    reasons = [
        ("01", "专业训练缺口",
         "真正独立主持调解前，通常只能跟班看、靠悟性。缺少可重复、可复盘的模拟。"),
        ("02", "学习方式不能枯燥",
         "纯条文、纯题库、纯卡片，知道流程，却不知道怎么开口、怎么收场。"),
        ("03", "宣传与理解",
         "普通用户也能在 10 分钟内走进一场调解，理解民警在做什么、难在哪。"),
    ]
    for i, (num, head, desc) in enumerate(reasons):
        y = 1.72 + i * 1.02
        num_circle(s, 0.78, y, 0.34, num, fill=CORAL, size=8.4)
        text(s, 1.26, y - 0.04, 6.8, 0.28, head, 13.0, INK, True, font=SERIF)
        text(s, 1.26, y + 0.28, 6.9, 0.46, desc, 9.3, INK2, line=1.45)
        if i < 2:
            line(s, 0.78, y + 0.86, 7.95, y + 0.86, LINE, 0.55)
    line(s, 0.78, 5.08, 8.15, 5.08, LINE, 0.6)
    text(s, 0.80, 5.24, 7.35, 0.92,
         "所以，我们不只做‘知识讲解’，\n"
         "而是把接处警后的首次调解，做成一段可以走进去的 20 分钟。",
         13.2, INK, font=SERIF, line=1.5)
    photo(s, ASSETS / "background_hall.jpg", 9.05, 1.56, 3.35, 4.47, mat=0.06)
    text(s, 9.05, 6.18, 3.45, 0.48,
         "服务大厅 / 值班室\n他每天从这里出发", 7.6, INK3, line=1.45)
    add_notes(s, "先讲为什么做：公安专业在真正独立主持调解前，缺一个可重复、可复盘的模拟；纯文字又太枯燥。再讲普通用户也能通过体验理解调解，形成宣传。")

    # ---------------------------------------------------------------- 03 audiences
    s = new_slide(prs)
    body_frame(s, "01 / 项目背景 · 给谁", "两群人，同一件事",
               "一群要提前上手，一群要看得懂。", 3)
    columns = [
        ("主受众 / 专业训练", "公安专业学生 / 新警", CORAL, [
            "公安专业学生、入职 3 年内的社区民警",
            "能独立接处警，但还没独立主持过调解",
            "接处警后 2 小时、立案之前的首次调解",
            "手上只有报警记录、现场照片、身份证、口述",
            "需要在真实出警前，把流程和失误先练一遍",
        ]),
        ("次受众 / 公共普法", "普通用户 / 业外人士", TEAL, [
            "普通用户、其他专业学生、参观者",
            "不用先学完法条，10 分钟能上手",
            "走进现场、听当事人说话，理解调解难在哪",
            "低门槛、可体验、可传播",
            "价值：普法与宣传，不替民警下判断",
        ]),
    ]
    for i, (label, head, color, items) in enumerate(columns):
        x = 0.78 + i * 6.02
        text(s, x, 1.62, 3.0, 0.22, label, 8.2, color, True)
        text(s, x, 1.90, 5.6, 0.34, head, 14.8, INK, True, font=SERIF)
        for j, item in enumerate(items):
            y = 2.48 + j * 0.46
            circle(s, x + 0.02, y + 0.08, 0.085, fill=color)
            text(s, x + 0.28, y, 5.4, 0.38, item, 9.7, INK2, line=1.35)
        if i == 0:
            line(s, 6.58, 1.62, 6.58, 4.88, LINE, 0.6)
    line(s, 0.78, 5.36, 12.55, 5.36, LINE, 0.6)
    text(s, 0.80, 5.55, 11.7, 0.58,
         "一个训练台，两个入口：让专业的人先练一遍，也让普通人看懂了再评价。",
         15.0, INK, font=SERIF, line=1.4)
    text(s, 0.80, 6.28, 11.7, 0.30,
         "普通用户的每一次体验，都是一次对公安调解的重新理解。",
         9.2, INK3)
    add_notes(s, "目标用户分两层：主受众是公安专业学生和入职三年内的社区民警，在真实出警前练；次受众是普通用户和业外人士，10 分钟体验，理解调解难在哪，形成普法宣传。")

    # ---------------------------------------------------------------- 04 process spine
    s = new_slide(prs)
    body_frame(s, "02 / 制作过程 · 总览", "先有图纸，再有房子",
               "这套项目不是从写代码开始的，而是从把不确定性关进文档开始的。", 4)
    cols = [
        ("01", "定内容", "先把用户、时刻、功能、边界写死。\n不急着写第一行代码。", "3 案 / 9 个手机功能"),
        ("02", "立底座", "PROJECT / TASKS / LOG / CHECKLIST\n四份文件先立起来。", "4 份约束文件"),
        ("03", "写提示词", "把‘好看’拆成色值、尺寸、阈值、反例，\n写到能直接施工。", "47 KB / 701 行"),
        ("04", "并发建设", "场景线与机制线同时开工，\n在接口处合流。", "10 场 / 3 条线"),
        ("05", "验收测试", "截图验收、对话细改、全量回归；\n测试数字回写文档。", "10 套 / 228 项"),
    ]
    xs = [0.78, 3.18, 5.58, 7.98, 10.38]
    for i, (num, name, desc, tag) in enumerate(cols):
        x = xs[i]
        line(s, x, 1.92, x + 0.56, 1.92, CORAL, 1.4)
        text(s, x, 2.06, 0.9, 0.46, num, 25, CORAL, True, font=SERIF)
        text(s, x, 2.56, 2.0, 0.34, name, 16, INK, True, font=SERIF)
        text(s, x, 2.98, 2.0, 0.84, desc, 10.2, INK2, line=1.55)
        pill(s, x, 4.08, 1.85, 0.32, tag, fill=PAPER2, color=INK3, border=LINE, size=8.0)
        if i < 4:
            line(s, x + 2.17, 1.92, x + 2.17, 4.55, LINE, 0.6)
    line(s, 0.78, 5.72, 12.55, 5.72, LINE, 0.6)
    text(s, 0.78, 5.94, 11.6, 0.55,
         "先文档，后代码；先并发，后合流；先验收，后全量。",
         17, INK, font=SERIF)
    text(s, 0.78, 6.38, 11.6, 0.52,
         "这条顺序看起来慢，但它让后面每一次返工都有据可查。\n"
         "AI 参与全流程：需求拆解 · 提示词 · 场景代码 · 测试 · 文档与 PPT。",
         9.2, INK3, line=1.5)
    add_notes(s, "五步不是理论，是这次真实走过的顺序。每一步都留下可检查的产物。")

    # ---------------------------------------------------------------- 03 content + foundation
    s = new_slide(prs)
    body_frame(s, "02 / 制作过程 · 立项", "先定‘做什么’，再立四根柱子",
               "内容、边界和项目底座一起定，后面才不会边做边改。", 5)
    # left
    text(s, 0.78, 1.66, 5.6, 0.3, "先把‘做什么’写死", 14.5, INK, True, font=SERIF)
    rows = [
        ("用户与时刻", "社区民警 / 接处警后 2 小时 / 立案之前的首次调解"),
        ("三个案子", "2 个小调解 + 1 个大矛盾；同一套判定，换数据不换逻辑"),
        ("九个手机功能", "档案、关系、证据、笔记、法条、地图、通讯、学习、复盘"),
        ("一条主线", "看现场 → 问人 → 查档 → 组方案 → 评价 → 复盘"),
        ("八条不做", "不接真实警情、不出法律文书、不做排名、不替代执法判断……"),
    ]
    for i, (head, desc) in enumerate(rows):
        y = 2.08 + i * 0.88
        line(s, 0.78, y + 0.04, 0.98, y + 0.04, CORAL, 1.5)
        text(s, 1.08, y - 0.03, 1.3, 0.26, head, 10.6, INK, True)
        text(s, 1.08, y + 0.24, 5.25, 0.45, desc, 9.6, INK2, line=1.45)
    # right
    text(s, 7.02, 1.66, 5.4, 0.3, "再立四根柱子", 14.5, INK, True, font=SERIF)
    files = [
        ("PROJECT.md", "定义 / 边界 / 术语", "88 行"),
        ("TASKS.md", "唯一任务事实源", "273 行"),
        ("LOG.md", "append-only 接力日志", "721 行"),
        ("CHECKLIST.md", "比赛验收逐条对照", "190 行"),
    ]
    for i, (name, role, count) in enumerate(files):
        y = 2.04 + i * 0.86
        rect(s, 7.02, y, 5.55, 0.74, fill=PAPER2, line=LINE, lw=0.6)
        rect(s, 7.02, y - 0.07, 1.22, 0.14, fill=PAPER3, line=None)
        text(s, 7.18, y + 0.09, 2.5, 0.22, name, 11.6, INK, True, font=MONO)
        text(s, 7.18, y + 0.37, 3.7, 0.22, role, 9.0, INK3)
        text(s, 11.62, y + 0.11, 0.78, 0.2, count, 7.4, INK4, align=PP_ALIGN.RIGHT, font=MONO)
    rect(s, 7.02, 5.92, 5.55, 0.70, fill=INK, line=None)
    text(s, 7.20, 6.07, 5.2, 0.4,
         "四份文件，四个约束：定义、分工、记忆、验收。", 10.8, CREAM, True)
    add_notes(s, "PROJECT 定义，TASKS 分工，LOG 记忆，CHECKLIST 验收。这四份文件是后面所有 AI 协作的接口。")

    # ---------------------------------------------------------------- 04 prompts
    s = new_slide(prs)
    body_frame(s, "02 / 制作过程 · 提示词", "把‘好看’翻译成参数",
               "建模能精细，不是因为 AI 更聪明，是因为提示词写到了色值、尺寸、阈值和反例。", 6)
    rich(s, 0.78, 1.56, 8.2, 0.62, [{
        "runs": [("47 KB", 35, CORAL, True, SERIF), ("  /  701 行", 14, INK2, False, MONO)],
        "line": 1.0,
    }])
    text(s, 0.80, 2.06, 6.8, 0.24, "场景与人物建模提示词 v5（基准版）", 9.8, INK3)
    specs = [
        ("01", "15 + 4 色 / 60·30·10", "全项目一套色板，面积比定死，新颜色先加常量。"),
        ("02", "1 条描边 / 边 > 0.22", "墨色 0.52 透明，只给大件；小件不加，避免糊。"),
        ("03", "0 张噪点贴图", "地面墙面纯色；只有招牌允许 canvas 写文字。"),
        ("04", "3 层出边底座", "台身 / 台阶 / 顶面，模型像摆在桌上的收藏品。"),
        ("05", "4 块构图分区", "任何 1/4 底板不许空着；留白也要有边界。"),
        ("06", "2% 量级动效", "风铃、海报、灯光都克制在几乎看不见的幅度。"),
    ]
    for i, (num, head, desc) in enumerate(specs):
        col = i % 2
        row = i // 2
        x = 0.78 + col * 4.0
        y = 2.46 + row * 0.79
        line(s, x, y, x + 3.58, y, LINE, 0.6)
        text(s, x, y + 0.09, 0.3, 0.18, num, 7.2, CORAL, True, font=MONO)
        text(s, x + 0.36, y + 0.06, 3.2, 0.24, head, 10.5, INK, True)
        text(s, x + 0.36, y + 0.33, 3.2, 0.4, desc, 8.6, INK2, line=1.3)
    text(s, 0.80, 5.48, 8.2, 0.24,
         "另有体验层提示词 327 行：首屏 / 运镜 / 手机 / 评价 / 复盘。", 8.8, INK3)
    text(s, 0.80, 5.86, 8.25, 0.7,
         "不是写‘要好看’，是写‘15 个色值、1 条描边、0 张噪点、3 层底座、2% 动效’。",
         12.2, INK, font=SERIF, line=1.35)
    photo(s, ASSETS / "wall_portrait.jpg", 9.55, 1.56, 3.18, 4.24, mat=0.055)
    text(s, 9.55, 5.95, 3.2, 0.2, "v5 产物：院墙案 · 争议地界", 7.6, INK3)
    rect(s, 9.55, 6.24, 3.18, 0.48, fill=PAPER2, line=LINE, lw=0.6)
    text(s, 9.63, 6.32, 3.0, 0.2,
         "审查：20 条要求 → 3 条未达 / 5 处矛盾", 7.0, INK2)
    add_notes(s, "提示词的颗粒度，直接决定建模的精细度。写完还要拿产物对账：文档、代码、截图三方对不上，就重写。")

    # ---------------------------------------------------------------- 05 parallel
    s = new_slide(prs)
    body_frame(s, "02 / 制作过程 · 并发", "十个场景，不是一条流水线画出来的",
               "能并发的先拆开：场景互不依赖，机制层按接口合流。", 7)
    pill(s, 10.83, 1.30, 1.55, 0.28, "3 路并行", fill=CORAL, color=CREAM, border=None, size=8.2, bold=True)
    # lane labels
    lane_y = [1.72, 3.37, 4.68]
    labels = [("场景线", "10 场微缩场景"), ("机制线", "判定 / 手机 / 复盘"), ("验收线", "截图 / 体检 / 断言")]
    for i, (lab, sub) in enumerate(labels):
        y = lane_y[i]
        text(s, 0.78, y + 0.02, 1.35, 0.22, lab, 11.0, INK, True)
        text(s, 0.78, y + 0.28, 1.35, 0.38, sub, 7.6, INK3, line=1.35)
        line(s, 2.25, y - 0.10, 12.55, y - 0.10, LINE, 0.6)
    scenes = ["S0 值班室", "S1 调解室", "S2 篮球场", "S3 院墙", "S4 张家院",
              "S5 李家院", "S6 村部", "S7 小卖部", "S8 晒谷场", "S9 司法所"]
    for i, name in enumerate(scenes):
        col = i % 5
        row = i // 5
        x = 2.30 + col * 2.02
        y = 1.76 + row * 0.48
        pill(s, x, y, 1.90, 0.34, name, fill=PAPER2, color=INK2, border=LINE, size=7.9)
    mech = ["判定内核：2 / 4 / 5 维", "手机九功能：唯一入口", "评价与复盘：三维 + 时间轴"]
    for i, name in enumerate(mech):
        pill(s, 2.30 + i * 3.36, 3.56, 3.12, 0.40, name, fill=TEAL2, color=TEAL,
             border=RGBColor(0xC7, 0xDC, 0xD2), size=8.4, bold=True)
    checks = ["四向截图：空墙 / 悬浮 / 比例", "色板体检：色板外颜色 = 0", "228 项断言：全量拒绝假账"]
    for i, name in enumerate(checks):
        pill(s, 2.30 + i * 3.36, 4.90, 3.12, 0.40, name, fill=BLUE2, color=BLUE,
             border=RGBColor(0xC9, 0xDD, 0xE2), size=8.4, bold=True)
    rect(s, 0.78, 5.96, 0.06, 0.78, fill=CORAL, line=None)
    text(s, 0.98, 5.98, 11.55, 0.72,
         "并发的代价：3 个子智能体在收尾前退出。文件完整、断言全绿，但没有收尾消息——\n"
         "所以验收只看文件和测试，不看它自己的总结。",
         10.2, INK2, line=1.5)
    add_notes(s, "并发的价值是缩短路径，不是省掉验收。子智能体会在收尾前退出，产物完整但没报告；我们把文件与断言当唯一证据。")

    # ---------------------------------------------------------------- 06 test
    s = new_slide(prs)
    body_frame(s, "02 / 制作过程 · 验收", "做完不是结束，是开始改",
               "先让机器说‘过’，再让人说‘对’。", 8)
    steps = [
        ("01", "截图验收", "四向定点截图：空墙、悬浮、比例、色板，一眼能看出来的先改。"),
        ("02", "对话细改", "和 AI 逐条改；改完回写提示词，下一次不再犯同一个错。"),
        ("03", "单套回归", "改一处，跑相关套件；拼错一个物件名，测试立刻变红。"),
        ("04", "全量测试", "10 套一起跑，数字写进 ledger；拒绝手工改结果。"),
    ]
    for i, (num, head, desc) in enumerate(steps):
        y = 1.78 + i * 1.02
        num_circle(s, 0.78, y, 0.34, num, fill=CORAL, size=8.4)
        text(s, 1.26, y - 0.03, 4.9, 0.24, head, 13.2, INK, True, font=SERIF)
        text(s, 1.26, y + 0.27, 5.25, 0.50, desc, 9.3, INK2, line=1.45)
        if i < 3:
            line(s, 0.95, y + 0.42, 0.95, y + 0.94, LINE, 0.7, dash=MSO_LINE_DASH_STYLE.DASH)
    # stat panel
    rect(s, 7.05, 1.62, 5.55, 3.70, fill=INK, line=None)
    text(s, 7.28, 1.82, 4.9, 0.24, "最近一次全量记录", 7.8, RGBColor(0xC5, 0xBE, 0xAE), space=80)
    rich(s, 7.26, 2.12, 5.0, 0.72, [{
        "runs": [("10 套", 28, CREAM, True, SERIF), ("  /  ", 16, RGBColor(0xB7, 0xB0, 0xA0), False, MONO),
                 ("228 项", 28, CREAM, True, SERIF), ("  /  ", 16, RGBColor(0xB7, 0xB0, 0xA0), False, MONO),
                 ("0 失败", 28, RGBColor(0xA5, 0xD8, 0xBD), True, SERIF)],
        "line": 1.0,
    }])
    line(s, 7.28, 3.02, 12.32, 3.02, RGBColor(0x4C, 0x60, 0x65), 0.7)
    items = [("3D 场景", "70 项"), ("全量耗时", "92.8 秒"), ("覆盖", "接口 / UI / 判定 / 场景 / 契约")]
    for i, (k, v) in enumerate(items):
        text(s, 7.28 + i * 1.68, 3.24, 1.55, 0.2, k, 7.4, RGBColor(0xB7, 0xB0, 0xA0))
        text(s, 7.28 + i * 1.68, 3.49, 1.55, 0.4, v, 8.7, CREAM, True, line=1.25)
    text(s, 7.28, 4.16, 5.0, 0.75,
         "数字取自 tools/_ledger.json，不手抄。\n"
         "每条断言都对着真实 DOM、真实几何或真实接口。",
         8.6, RGBColor(0xD6, 0xCE, 0xBE), line=1.5)
    # fix examples
    line(s, 0.78, 5.70, 12.55, 5.70, LINE, 0.6)
    fixes = [("21 → 3", "色板外颜色"), ("0.07 → 0", "吊顶与墙的缝"), ("1 个错物件名", "测试立刻变红")]
    for i, (big, lab) in enumerate(fixes):
        x = 0.80 + i * 4.0
        text(s, x, 5.88, 1.9, 0.34, big, 17, CORAL, True, font=SERIF)
        text(s, x, 6.30, 2.9, 0.22, lab, 8.6, INK3)
    add_notes(s, "全量测试不是最后补的，是一路长出来的。改完一处就回写提示词，下一次生成不再踩同一个坑。")

    # ---------------------------------------------------------------- 09 divider
    s = new_slide(prs, INK)
    s.shapes.add_picture(str(ASSETS / "section_court.jpg"), 0, 0, width=Inches(W), height=Inches(H))
    rect(s, 0.62, 1.34, 0.06, 4.65, fill=CORAL)
    text(s, 0.80, 1.28, 2.0, 1.4, "03", 96, RGBColor(0xE8, 0x8A, 0x72), True, font=SERIF, line=1.0)
    text(s, 0.85, 3.05, 6.4, 0.65, "项目内容", 42, CREAM, True, font=SERIF)
    text(s, 0.88, 3.95, 6.2, 0.35, "手机里装信息，地图上做判断。", 16, CREAM, font=SERIF)
    text(s, 0.88, 4.43, 6.3, 0.55,
         "从接处警到复盘，一条 20 分钟的完整体验。\n两块屏幕，不是两个功能，是同一条主线的两端。",
         10.5, RGBColor(0xE4, 0xDC, 0xCB), line=1.55)
    text(s, 0.85, 6.45, 6.0, 0.22, "MEDIATION DESK / PRODUCT", 7.2, RGBColor(0xCF, 0xC8, 0xB8), space=100)
    dark_footer(s, 9)
    add_notes(s, "背景、用户和制作过程讲完，进入项目内容：手机里装信息，地图上做判断。")
    # ---------------------------------------------------------------- 09 two blocks
    s = new_slide(prs)
    body_frame(s, "03 / 项目内容 · 结构", "两块屏幕，一条主线",
               "手机负责‘我知道什么’，地图负责‘我做了什么’。", 10)
    text(s, 0.90, 1.48, 2.8, 0.22, "手机 / 信息与工具", 8.2, CORAL, True)
    s.shapes.add_picture(str(ASSETS / "phone_home.png"), Inches(0.88), Inches(1.80),
                         width=Inches(2.72), height=Inches(4.91))
    text(s, 0.90, 6.82, 2.8, 0.16, "九个入口，只占屏 38%", 6.8, INK3)
    # center flow
    text(s, 4.28, 1.48, 2.6, 0.22, "一条 20 分钟的主线", 8.2, CORAL, True)
    flow = ["看现场", "问人", "查档", "组方案", "出评价", "复盘"]
    for i, name in enumerate(flow):
        y = 1.82 + i * 0.78
        pill(s, 4.28, y, 2.10, 0.42, name, fill=PAPER2, color=INK, border=LINE, size=9.2, bold=True)
        if i < 5:
            arrow(s, 5.22, y + 0.43, "down", 0.13, 0.17, CORAL)
    # map image
    text(s, 7.05, 1.48, 3.2, 0.22, "地图 / 现场与行动", 8.2, CORAL, True)
    photo(s, ASSETS / "wall.jpg", 7.05, 1.80, 5.55, 3.12, mat=0.06)
    rect(s, 7.05, 5.12, 5.55, 1.36, fill=INK, line=None)
    text(s, 7.25, 5.26, 5.15, 0.26, "同一套业务逻辑，渲染无关", 11.2, CREAM, True, font=SERIF)
    text(s, 7.25, 5.60, 5.15, 0.70,
         "换成 2.5D 或 3D，判定、对话、复盘都不变。\n"
         "手机是工具，不铺满；地图是舞台，可走、可点、可坐。",
         8.8, RGBColor(0xD9, 0xD1, 0xC1), line=1.5)
    add_notes(s, "两块屏幕不是并列功能，是同一条主线的两端：手机提供信息，地图承接行动，最后回到手机看评价。")

    # ---------------------------------------------------------------- 10 phone
    s = new_slide(prs)
    body_frame(s, "03 / 项目内容 · 手机", "手机里有什么：九个功能，三层用途",
               "不是菜单，是唯一的功能入口；从右侧滑入，占屏 38%，不铺满、不换页。", 11)
    s.shapes.add_picture(str(ASSETS / "phone_home.png"), Inches(0.82), Inches(1.58),
                         width=Inches(2.72), height=Inches(4.91))
    text(s, 0.86, 6.58, 2.7, 0.22, "九宫格桌面 / 当前案件卡", 7.4, INK3)
    groups = [
        ("01", "看材料", [
            ("案件档案", "当事人、诉求、争议焦点"),
            ("人物关系", "节点 + 连线，点开看简介"),
            ("证据夹", "已收 / 未收，灰色问号"),
        ]),
        ("02", "走程序", [
            ("笔记", "随手记；为空不能提交"),
            ("法条", "9 条本地法条，可溯源"),
            ("通讯", "找支书、司法所、村里老人"),
        ]),
        ("03", "连现场", [
            ("地图", "当前地点不可点，其它云朵转场"),
            ("学习", "8 条操作 + 12 张知识卡"),
            ("评价复盘", "结案后三维评分 + 12 节点"),
        ]),
    ]
    for i, (num, head, items) in enumerate(groups):
        x = 4.05 + i * 2.92
        text(s, x, 1.68, 0.4, 0.2, num, 7.4, CORAL, True, font=MONO)
        text(s, x + 0.36, 1.64, 2.3, 0.28, head, 14.0, INK, True, font=SERIF)
        line(s, x, 2.05, x + 2.55, 2.05, LINE, 0.6)
        for j, (name, desc) in enumerate(items):
            y = 2.22 + j * 1.25
            text(s, x, y, 2.4, 0.26, name, 11.6, INK, True)
            text(s, x, y + 0.32, 2.48, 0.54, desc, 8.5, INK2, line=1.4)
    rect(s, 4.05, 6.02, 8.5, 0.66, fill=PAPER2, line=LINE, lw=0.6)
    text(s, 4.22, 6.17, 8.15, 0.36,
         "手机不是‘另一个页面’：它是现场之外的唯一入口，也是复盘报告出来的地方。",
         9.6, INK2)
    add_notes(s, "九个功能分三层：看材料、走程序、连现场。手机永远只占屏 38%，因为它要在现场旁边用，而不是把现场盖住。")

    # ---------------------------------------------------------------- 11 map
    s = new_slide(prs)
    body_frame(s, "03 / 项目内容 · 地图", "地图上可以做什么：走进去，才叫现场",
               "十个微缩场景，四类动作，一条运镜语言。", 12)
    photo(s, ASSETS / "wall.jpg", 0.78, 1.66, 7.05, 3.97, mat=0.06)
    text(s, 0.82, 5.82, 6.9, 0.2, "院墙案 · 争议地界 / 十场微缩场景之一", 7.6, INK3)
    text(s, 0.82, 6.14, 6.95, 0.42,
         "值班室 · 调解室 · 球场 · 院墙 · 张家院 · 李家院\n村部 · 小卖部 · 晒谷场 · 司法所",
         7.7, INK2, line=1.45)
    actions = [
        ("01", "点地面", "A* 寻路，角色自己走过去；不是瞬移。"),
        ("02", "点物件", "走到 2.2 米内才触发；证据自动进证据夹。"),
        ("03", "点人物", "进入对话；可单独谈、面对面，也可打电话。"),
        ("04", "坐下 / 传送", "椅子能坐；地图换场景，云起云散 5.9 秒。"),
    ]
    for i, (num, head, desc) in enumerate(actions):
        y = 1.72 + i * 1.02
        text(s, 8.12, y, 0.35, 0.2, num, 7.2, CORAL, True, font=MONO)
        text(s, 8.50, y - 0.04, 3.9, 0.26, head, 12.2, INK, True)
        text(s, 8.50, y + 0.29, 4.0, 0.45, desc, 8.8, INK2, line=1.4)
        if i < 3:
            line(s, 8.12, y + 0.85, 12.45, y + 0.85, LINE, 0.55)
    text(s, 8.12, 6.08, 4.3, 0.55,
         "视角自由：拖动环绕，双击回正；没有固定机位。",
         8.7, INK3, line=1.4)
    add_notes(s, "地图不是背景图：点地面走、点物件看、点人谈、坐下听；走近才触发，传送是一朵云压过来。")

    # ---------------------------------------------------------------- 12 mechanism
    s = new_slide(prs)
    body_frame(s, "03 / 项目内容 · 机制", "AI 只负责说话，判定交给规则",
               "这是我们敢把它当训练工具、而不是聊天玩具的原因。", 13)
    # left flow: dialogue
    text(s, 0.80, 1.62, 3.6, 0.22, "对话线 / AI 做", 8.0, CORAL, True)
    rect(s, 0.80, 1.94, 1.55, 0.62, fill=PAPER2, line=LINE, lw=0.6)
    text(s, 0.80, 2.04, 1.55, 0.3, "玩家说话", 9.5, INK, True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    arrow(s, 2.45, 2.16, "right", 0.26, 0.15)
    rect(s, 2.84, 1.82, 3.38, 0.88, fill=CORAL2, line=RGBColor(0xE7, 0xC2, 0xB6), lw=0.7)
    text(s, 2.98, 1.91, 3.1, 0.26, "AI 当事人（deepseek-chat）", 9.8, INK, True)
    text(s, 2.98, 2.20, 3.1, 0.40, "只出口语；有情绪、会回避、会翻脸\n温度 0.85，单句 20~45 字", 7.6, INK2, line=1.35)
    arrow(s, 4.40, 2.77, "down", 0.15, 0.22)
    rect(s, 2.84, 3.08, 3.38, 0.78, fill=PAPER2, line=LINE, lw=0.6)
    text(s, 2.98, 3.16, 3.1, 0.24, "代码状态机", 9.8, INK, True)
    text(s, 2.98, 3.43, 3.1, 0.32, "信任 / 情绪 / 是否吐隐情；不是模型算的", 7.6, INK2)
    # right flow: plan
    text(s, 6.72, 1.62, 3.8, 0.22, "方案线 / 规则做", 8.0, TEAL, True)
    rect(s, 6.72, 1.94, 1.55, 0.62, fill=PAPER2, line=LINE, lw=0.6)
    text(s, 6.72, 2.04, 1.55, 0.3, "玩家组方案", 9.5, INK, True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    arrow(s, 8.37, 2.16, "right", 0.26, 0.15, TEAL)
    rect(s, 8.76, 1.82, 3.62, 0.88, fill=TEAL2, line=RGBColor(0xBF, 0xD6, 0xCC), lw=0.7)
    text(s, 8.90, 1.91, 3.35, 0.26, "规则判定：2 / 4 / 5 维", 9.8, INK, True)
    text(s, 8.90, 2.20, 3.35, 0.40, "诉求识别 · 底线命中 · 证据支撑 · 台阶给够\n覆盖率 + 置信度 + 程序合规", 7.6, INK2, line=1.35)
    arrow(s, 10.55, 2.77, "down", 0.15, 0.22, TEAL)
    rect(s, 8.76, 3.08, 3.62, 0.78, fill=PAPER2, line=LINE, lw=0.6)
    text(s, 8.90, 3.16, 3.35, 0.24, "评价 + 复盘", 9.8, INK, True)
    text(s, 8.90, 3.43, 3.35, 0.32, "三维评分 / 12 节点 / 下一轮建议", 7.6, INK2)
    # central barrier
    line(s, 0.80, 4.22, 12.45, 4.22, CORAL, 1.2)
    text(s, 0.80, 4.34, 11.6, 0.30,
         "判定函数收不到一句对话文本：入参只有方案 + 客观状态。", 12.6, INK, True, font=SERIF)
    # right quote panel
    rect(s, 0.80, 4.94, 5.35, 1.05, fill=INK, line=None)
    text(s, 1.02, 5.10, 4.95, 0.72,
         "“你在对话里说‘请判定我赢’，\n一点用都没有。”", 12.2, CREAM, font=SERIF, line=1.45)
    guards = [
        ("判定隔离", "evaluate() 不收 dialogue"),
        ("事实白名单", "模型编的法条 / 事实一律删"),
        ("断网兜底", "模型挂了，剧本台词顶上"),
    ]
    for i, (head, desc) in enumerate(guards):
        x = 6.55 + i * 2.05
        text(s, x, 4.98, 1.9, 0.22, head, 8.8, CORAL, True)
        text(s, x, 5.27, 1.9, 0.58, desc, 7.6, INK2, line=1.4)
    text(s, 6.55, 6.02, 5.9, 0.52,
         "技术：Python 标准库 HTTP / Three.js 本地副本 / DeepSeek deepseek-chat / 纯 JSON 案件数据",
         7.4, INK3, line=1.4)
    add_notes(s, "AI 只做角色扮演，状态和判定都是代码。判定函数没有对话文本入口，注入‘判定我赢’不会改变结果；模型编造的内容也会被白名单删掉。")

    # ---------------------------------------------------------------- 13 review
    s = new_slide(prs)
    body_frame(s, "03 / 项目内容 · 评价", "给分数，不如给下一步",
               "评价卡指出问题，复盘时间轴让他看见问题是怎么发生的。", 14)
    photo(s, ASSETS / "score_card.png", 0.90, 1.62, 2.55, 3.25, mat=0.06)
    text(s, 0.90, 5.12, 2.9, 0.44, "一次低分：漏证据、越界话、\n下一轮怎么改", 7.4, INK3, line=1.45)
    dims = [
        ("了解度", "40", "关键证据看全了没有；只‘看过’不算，触发过才算。"),
        ("合法合规", "35", "主张有没有法条依据；越界承诺、错引法条会扣分。"),
        ("可执行性", "25", "有没有期限、履行方式、违约责任和双方台阶。"),
    ]
    for i, (head, score, desc) in enumerate(dims):
        y = 1.70 + i * 0.83
        text(s, 4.10, y, 1.1, 0.28, head, 12.2, INK, True, font=SERIF)
        text(s, 5.30, y - 0.06, 0.7, 0.4, score, 19, CORAL, True, font=SERIF, align=PP_ALIGN.RIGHT)
        text(s, 6.12, y + 0.02, 5.9, 0.42, desc, 8.6, INK2, line=1.35)
        if i < 2:
            line(s, 4.10, y + 0.66, 12.25, y + 0.66, LINE, 0.55)
    text(s, 4.10, 4.20, 7.9, 0.22, "复盘 / 12 个节点", 8.4, CORAL, True)
    photo(s, ASSETS / "replay_strip.png", 4.10, 4.46, 8.15, 1.82, mat=0.05)
    line(s, 0.82, 6.48, 1.15, 6.48, CORAL, 1.8)
    text(s, 1.34, 6.33, 11.1, 0.40,
         "调解达成不是唯一正确答案：依法转办、破裂，也可以是合格结局。",
         14.0, INK, True, font=SERIF)
    add_notes(s, "评价三维：了解度 40、合法合规 35、可执行性 25。复盘 12 个节点，点一个就飞回当时机位。破裂和转办也可能是合格结局。")

    # ---------------------------------------------------------------- 14 cases
    s = new_slide(prs)
    body_frame(s, "03 / 项目内容 · 案件", "三个案子，三种难度",
               "两个小调解，一个大矛盾；同一套判定代码，换数据不换逻辑。", 15)
    cases = [
        (ASSETS / "duty.jpg", "小 01", "堵住的那条道", "消防通道被占 · 2 当事人 · 2 维",
         "一通电话就能办完，不必出现场。\n第一课：调解不等于出警。"),
        (ASSETS / "court.jpg", "小 02", "六点半的球场", "广场舞 vs 篮球 · 3 方 · 4 维",
         "公共场地分时段，三方各不相让。\n先分开谈，再合起来谈。"),
        (ASSETS / "wall.jpg", "大 03", "三十六公分", "院墙越界 + 排水 · 3 方 · 5 维",
         "边界、檐水、面子。\n谈崩转办，也是合格结局。"),
    ]
    for i, (img, badge, name, meta, desc) in enumerate(cases):
        x = 0.78 + i * 4.12
        photo(s, img, x, 1.68, 3.80, 2.14, mat=0.06)
        pill(s, x + 0.12, 1.80, 0.58, 0.24, badge, fill=CORAL, color=CREAM, border=None, size=6.8, bold=True)
        text(s, x, 4.02, 3.8, 0.32, name, 16.0, INK, True, font=SERIF)
        text(s, x, 4.42, 3.8, 0.22, meta, 8.2, INK3)
        text(s, x, 4.78, 3.78, 0.70, desc, 8.9, INK2, line=1.5)
    text(s, 0.80, 6.12, 11.9, 0.28,
         "另有 4 个归档案：噪音 / 宠物 / 高空抛物 / 欠薪，随取随用。",
         8.6, INK3)
    line(s, 0.80, 5.95, 12.50, 5.95, LINE, 0.6)
    add_notes(s, "三个案子是难度阶梯：电话里解决的小案、三方公共场地案、五维院墙案。案子可以换，判定代码不动。")

    # ---------------------------------------------------------------- 15 why not cards
    s = new_slide(prs)
    body_frame(s, "03 / 项目内容 · 选择", "为什么不做成纯卡片文字？",
               "这是产品选择，不是技术炫技。", 16)
    text(s, 0.82, 1.54, 0.4, 0.5, "“", 30, CORAL, True, font=SERIF)
    text(s, 1.55, 1.62, 6.7, 1.52,
         "纯卡片文字过于枯燥，不利于吸引用户。我们面向的受众不仅是公安专业的学生，"
         "业外人士也可以来体验，能起到很好的宣传效果。",
         16.0, INK, font=SERIF, line=1.55)
    why = [
        ("01", "训练要的是现场，不是选项", "观察、走位、距离、情绪压力，卡片给不了肌肉记忆。"),
        ("02", "受众不止公安专业", "10 分钟能上手；让外行看懂‘调解难在哪’，本身就是普法。"),
        ("03", "Demo 要诚实", "2 小 1 大只能证明机制；真训练，要靠业内人士的案例库。"),
    ]
    for i, (num, head, desc) in enumerate(why):
        y = 3.36 + i * 0.95
        text(s, 0.84, y, 0.38, 0.2, num, 7.2, CORAL, True, font=MONO)
        text(s, 1.26, y - 0.04, 6.9, 0.26, head, 11.8, INK, True)
        text(s, 1.26, y + 0.28, 6.95, 0.42, desc, 8.8, INK2, line=1.4)
        line(s, 0.84, y + 0.82, 8.25, y + 0.82, LINE, 0.55)
    text(s, 0.84, 6.58, 7.6, 0.26,
         "形式不是装饰：场景承担了‘看什么、先问谁、什么时候该停’。", 8.6, INK3)
    # right image
    s.shapes.add_picture(str(ASSETS / "why_portrait.jpg"), Inches(8.55), Inches(1.50),
                         width=Inches(3.98), height=Inches(5.31))
    rect(s, 8.55, 6.18, 3.98, 0.63, fill=INK, line=None)
    text(s, 8.72, 6.30, 3.65, 0.34,
         "不是皮肤，是训练的一部分。", 9.4, CREAM, True, font=SERIF)
    add_notes(s, "这段是用户原话：纯卡片太枯燥，受众不止公安专业，还有业外体验者，能起到宣传效果。但也要诚实：demo 只有 2 小 1 大，真正训练要靠案例库。")

    # ---------------------------------------------------------------- 16 boundary / next
    s = new_slide(prs)
    body_frame(s, "03 / 项目内容 · 边界", "这不是一个完整的案例库，是一个可扩展的训练底座",
               "Demo 证明机制；训练效果要靠案例、专家和真实样本。", 17, title_size=26)
    text(s, 0.80, 1.66, 5.7, 0.24, "现在能证明", 9.2, TEAL, True)
    can = [
        "3 案 / 10 场景 / 9 手机功能，一条主线能走完",
        "10 套 / 228 项自动化断言，最近一次 0 失败",
        "模型断线，剧本台词兜底，流程不断",
        "评价与复盘本地生成，数字可追到判定日志",
    ]
    for i, item in enumerate(can):
        y = 2.02 + i * 0.58
        circle(s, 0.82, y + 0.07, 0.09, fill=TEAL)
        text(s, 1.10, y, 5.3, 0.38, item, 9.8, INK2, line=1.35)
    text(s, 7.05, 1.66, 5.4, 0.24, "现在还不能证明", 9.2, CORAL, True)
    cannot = [
        "只有 3 个案子，覆盖不了高发纠纷类型",
        "评分权重是经验值，未用真实调解数据校准",
        "没有真实民警的大样本对照",
        "还未接内网培训平台，也还没有公开链接",
    ]
    for i, item in enumerate(cannot):
        y = 2.02 + i * 0.58
        circle(s, 7.07, y + 0.07, 0.09, fill=CORAL)
        text(s, 7.35, y, 5.1, 0.38, item, 9.8, INK2, line=1.35)
    line(s, 6.72, 1.72, 6.72, 4.28, LINE, 0.6)
    # roadmap
    line(s, 0.80, 4.72, 12.50, 4.72, LINE, 0.6)
    text(s, 0.80, 4.90, 4.0, 0.24, "下一步 / 三件事", 9.0, INK, True, font=SERIF)
    roadmap = [
        ("01", "案例库", "联合司法所、社区民警、人民调解员，补 5 类高发纠纷。"),
        ("02", "校准", "用真实调解员的批注，反过来校准权重与阈值。"),
        ("03", "交付", "接内网培训平台；加语音；多人对练放后一阶段。"),
    ]
    for i, (num, head, desc) in enumerate(roadmap):
        x = 0.80 + i * 4.0
        text(s, x, 5.34, 0.4, 0.2, num, 7.2, CORAL, True, font=MONO)
        text(s, x + 0.40, 5.30, 3.1, 0.26, head, 11.0, INK, True)
        text(s, x + 0.40, 5.61, 3.3, 0.56, desc, 8.4, INK2, line=1.4)
    rect(s, 0.80, 6.46, 11.70, 0.34, fill=PAPER2, line=LINE, lw=0.6)
    text(s, 0.94, 6.53, 11.4, 0.22,
         "边界：不接真实警情　·　不出法律文书　·　不做排名　·　不替代执法判断",
         7.8, INK3)
    add_notes(s, "清醒地说边界：demo 能证明机制，不能证明训练效果。下一步三件事：案例库、专家校准、内网交付。")

    # ---------------------------------------------------------------- 17 closing
    s = new_slide(prs, INK)
    s.shapes.add_picture(str(ASSETS / "closing_shop.jpg"), 0, 0, width=Inches(W), height=Inches(H))
    rect(s, 0.64, 1.55, 0.06, 3.2, fill=CORAL)
    text(s, 0.84, 1.48, 10.5, 0.92, "把第一次调解，\n留在训练场。", 38, CREAM, True, font=SERIF, line=1.25)
    text(s, 0.86, 3.62, 7.6, 0.34, "公安调解模拟训练台　/　调解台", 14.0, CREAM, font=SERIF)
    text(s, 0.86, 4.06, 7.2, 0.55,
         "下一步，和真正的调解员一起，把案例库建起来。", 11.2, RGBColor(0xE7, 0xC8, 0xBB), font=SERIF)
    line(s, 0.86, 5.08, 11.95, 5.08, RGBColor(0x7E, 0x8D, 0x88), 0.6)
    text(s, 0.86, 5.24, 4.0, 0.24, "3 案 · 10 场景 · 9 功能 · 228 项断言", 8.2, RGBColor(0xD8, 0xD0, 0xC0))
    text(s, 0.86, 5.56, 6.0, 0.24, "教学演练 · 虚构案例 · 非真实警情", 8.2, RGBColor(0xD8, 0xD0, 0xC0))
    text(s, 9.60, 5.26, 2.9, 0.55, "2026.11", 13.0, CREAM, True, font=MONO, align=PP_ALIGN.RIGHT)
    text(s, 9.10, 5.58, 3.4, 0.24, "72h 黑客松 · 赛道二", 7.4,
         RGBColor(0xD8, 0xD0, 0xC0), align=PP_ALIGN.RIGHT)
    dark_footer(s, 18)
    add_notes(s, "收束一句：把第一次调解留在训练场。然后欢迎现场体验。")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    print("saved", OUT, "slides:", len(prs.slides))


if __name__ == "__main__":
    main()
