#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""美术契约测试：**双向**钉住"注册表 ↔ 数据"。

为什么必须双向
--------------
注册表认不出的 kind 如果静默回落成默认物件，页面不报错、控制台不报错、断言全绿，
但场景里安静地少了一件实物 —— 这种 bug 只有静态核对抓得住。
反过来，注册了却没有任何案子用到，就是死代码，画得再好看也是负担。

四条断言：
  ① 数据里的 kind ⊆ 注册表         （防拼错 → 静默消失）
  ② 注册表 ⊆ 数据里的 kind         （防死代码）
  ③ 注册表每个 key 都真有实现       （防只注册不实现 → 运行时抛错）
  ④ 故意拼错一个 kind，校验必须变红 （证明这测试不是假的）

离线运行，不需要服务。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENE_JS = ROOT / "src" / "web" / "scene.js"
CASES = ROOT / "src" / "cases"

# 预留件：绘制实现保留，但当前三案用不到（S2 室内场景做回来就会用到）。
# 加白名单是为了不误伤，但白名单本身也要被检查——写错名字同样会红。
RESERVED = {
    "sofa", "tea_table", "tv", "dining_table", "shoe_cabinet", "radiator",
    "window", "clothesline", "steps", "e_bike", "pole",
}

passed = failed = 0


def check(ok: bool, msg: str, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print("[PASS] " + msg)
    else:
        failed += 1
        print("[FAIL] " + msg + ("  ← " + detail if detail else ""))


def registry_keys() -> tuple[set[str], str]:
    src = SCENE_JS.read_text(encoding="utf-8")
    start = src.index("var SPOT_KINDS = {")
    block = src[start:src.index("\n  };", start)]
    keys = set(re.findall(r"^\s{4}([a-z_][a-z0-9_]*):\s*function\s*\(ctx, k\)", block, re.M))
    return keys, block


def data_kinds() -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for f in sorted(CASES.glob("*/case.json")):
        case = json.loads(f.read_text(encoding="utf-8"))
        kinds = set()
        for sc in case.get("scenes", []):
            for sp in sc.get("spots", []):
                kinds.add(sp["kind"])
        out[f.parent.name] = kinds
    return out


def contract_ok(reg: set[str], used: set[str], reserved: set[str] | None = None) -> list[str]:
    """返回问题清单；空列表 = 契约成立。抽成函数是为了能对"故意拼错"做反向验证。"""
    problems = []
    missing = used - reg
    if missing:
        problems.append("数据用了注册表没有的 kind：%s" % "、".join(sorted(missing)))
    dead = reg - used - (reserved or set())
    if dead:
        problems.append("注册了但没有任何案子用到（死代码）：%s" % "、".join(sorted(dead)))
    return problems


def main() -> int:
    reg, block = registry_keys()
    check(len(reg) >= 25, "注册表至少 25 种物件（实际 %d）" % len(reg))

    # ③ 每个 key 都有函数体
    empty = []
    for k in reg:
        m = re.search(r"^\s{4}%s:\s*function\s*\(ctx, k\)\s*\{" % re.escape(k), block, re.M)
        if not m:
            empty.append(k)
        else:
            body = block[m.end():m.end() + 260]
            if "ctx" not in body:
                empty.append(k)
    check(not empty, "注册表每个 kind 都有实际绘制实现", "空实现：%s" % "、".join(empty))

    used: set[str] = set()
    per_case = data_kinds()
    for name, kinds in per_case.items():
        used |= kinds
    check(bool(used), "案子数据里读到了 kind（%d 个案子）" % len(per_case))

    problems = contract_ok(reg, used, RESERVED)
    check(not problems, "双向契约成立：数据 ⊆ 注册表，注册表 ⊆ 数据（预留件除外）", "；".join(problems))
    check(not (RESERVED - reg), "预留清单里的 kind 都真实存在（白名单不许写错）",
          "、".join(sorted(RESERVED - reg)))

    # ④ 反向验证：把某个 kind 拼错一个字母，契约必须报错
    if used:
        victim = sorted(used)[0]
        typo = victim[:-1] + ("x" if victim[-1] != "x" else "y")
        broken = (used - {victim}) | {typo}
        check(bool(contract_ok(reg, broken)),
              "故意把 %s 拼成 %s，契约会变红（说明测试不是假的）" % (victim, typo))

    # 挂墙件也算 kind，必须都在注册表里
    src = SCENE_JS.read_text(encoding="utf-8")
    wall_block = src[src.index("var WALL_KINDS = {"):src.index("};", src.index("var WALL_KINDS = {"))]
    wall_keys = set(re.findall(r"([a-z_][a-z0-9_]*):\s*1", wall_block))
    check(wall_keys <= reg, "挂墙件清单里的 kind 都在注册表内", "多出：%s" % "、".join(sorted(wall_keys - reg)))

    # BACKDROP_Y 只许定义一次：地平线与寻路边界共用一个值
    n_def = len(re.findall(r"var BACKDROP_Y\s*=", src))
    check(n_def == 1, "BACKDROP_Y 只定义一次（实际 %d 处）" % n_def)
    check("var row = Math.max(0, Math.min(ROWS - 1, Math.floor((y - BACKDROP_Y) / TILE)));" in src,
          "寻路网格用 BACKDROP_Y 作为上边界，不写死数字")

    # 每个点位坐标必须落在世界里
    bad = []
    for name, _ in per_case.items():
        case = json.loads((CASES / name / "case.json").read_text(encoding="utf-8"))
        for sc in case["scenes"]:
            for sp in sc["spots"]:
                if sp["x"] < 0 or sp["y"] < 0 or sp["x"] + sp["w"] > 1400 or sp["y"] + sp["h"] > 820:
                    bad.append("%s/%s" % (name, sp["id"]))
    check(not bad, "所有点位都在世界范围内（1400×820）", "越界：%s" % "、".join(bad))

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
