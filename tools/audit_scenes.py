#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""场景体检：把提示词 §4 的 A 段里能静态查的几条跑成数字。

    python tools/audit_scenes.py             # 全部十场
    python tools/audit_scenes.py wall yard   # 只看几场

判据（对应 docs/场景与人物建模提示词.md §4 A2/A3/A4）：
  A2 颜色数   —— 色板外的十六进制颜色数，越低越好；>0 的会列出来
  A3 噪点贴图 —— canvas 贴图里出现 Math.random 的处数；必须为 0
  A4 描边     —— b() 覆盖的盒子数（b 现在自动加描边），以及手写 new THREE.Mesh(Box) 的漏网数
  A6 四格     —— 每个象限里 prop 的件数（空场型场景允许东南为 0）
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENES = os.path.join(ROOT, "src", "web", "scenes")

PAL = {
    "ink": "#355364", "cream": "#fff3d7", "white": "#fffaf0", "blue": "#82c9d5",
    "sea": "#62bfc7", "navy": "#315c72", "peach": "#f4a58b", "coral": "#e98578",
    "mint": "#a5d8bd", "sand": "#e8cca1", "road": "#667782", "yellow": "#ffd781",
    "wood": "#b98e68", "glass": "#b7e1df", "dark": "#294858",
    "grass": "#7d9163", "soil": "#a08d70", "brick": "#a2745f", "tile": "#6b6357",
}
PAL_VALUES = set(v.lower() for v in PAL.values())

FILES = [
    ("S0 值班室", "duty.js"), ("S1 调解室", "mediation.js"), ("S2 篮球场", "court.js"),
    ("S3 院墙", "wall.js"), ("S4 张家院", "yard.js"), ("S5 李家院", "lihome.js"),
    ("S6 村部", "village.js"), ("S7 小卖部", "shop.js"), ("S8 晒谷场", "thresh.js"),
    ("S9 司法所", "judicial.js"),
]


def audit(path):
    s = io.open(path, encoding="utf-8").read()
    hexes = re.findall(r'#([0-9a-fA-F]{6})\b', s)
    off = {}
    for h in hexes:
        hh = "#" + h.lower()
        if hh not in PAL_VALUES:
            off[hh] = off.get(hh, 0) + 1
    noise = len(re.findall(r"Math\.random", s))
    boxes = len(re.findall(r"\bb\(", s)) + len(re.findall(r"\bcy\(", s))
    raw_box = len(re.findall(r"new THREE\.Mesh\(\s*new THREE\.BoxGeometry", s))
    # 四格：按 prop 的 x/z 粗分（只统计有 x: 与 z: 的 prop 行）
    props = re.findall(r"\{\s*id:\s*\"([^\"]+)\"[^}]*?x:\s*(-?\d+(?:\.\d+)?)[^}]*?z:\s*(-?\d+(?:\.\d+)?)", s)
    quad = [0, 0, 0, 0]      # 西北 东北 西南 东南
    for _id, x, z in props:
        x, z = float(x), float(z)
        quad[(0 if x < 0 else 1) + (2 if z > 0 else 0)] += 1
    return {
        "colors_off": off, "noise": noise, "boxes": boxes,
        "raw_box": raw_box, "props": len(props), "quad": quad,
    }


def main():
    want = sys.argv[1:]
    rows = []
    print("%-14s %6s %6s %6s %6s   %s" % ("场景", "色板外", "噪点", "b()件", "裸盒", "四格(西北/东北/西南/东南)"))
    print("-" * 92)
    bad = 0
    for label, f in FILES:
        key = f.replace(".js", "")
        if want and key not in want:
            continue
        p = os.path.join(SCENES, f)
        if not os.path.exists(p):
            continue
        r = audit(p)
        n_off = sum(r["colors_off"].values())
        flag = ""
        if r["noise"] > 0:
            flag += " ⚠噪点"
            bad += 1
        if min(r["quad"]) == 0:
            flag += " ⚠空格"
            bad += 1
        if n_off > 12:
            flag += " ⚠颜色多"
            bad += 1
        print("%-14s %6d %6d %6d %6d   %s%s" % (
            label, n_off, r["noise"], r["boxes"], r["raw_box"],
            "/".join(str(q) for q in r["quad"]), flag))
        rows.append((label, r))
    print("-" * 92)
    for label, r in rows:
        if r["colors_off"]:
            top = sorted(r["colors_off"].items(), key=lambda kv: -kv[1])[:6]
            print("%-12s 色板外：%s" % (label, "  ".join("%s×%d" % (k, v) for k, v in top)))
    print("\n体检结论：%s" % ("全部通过（噪点 0、四格无空格、色板外颜色可控）" if bad == 0 else "有 %d 项待改" % bad))


if __name__ == "__main__":
    main()
