#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成「人物在哪」映射：src/web/person_scenes.json。

做法（两步配对，缺一不可）：
  ① 案子 → 场景：case.json 的 scenes[] 给出本案开放的地点 id（room / boundary / …），
     再用 app.js 的 SCENE_ALIAS 换成外壳场景 id（mediation / wall / …）；
  ② 场景 → 人：读 scenes/<id>.js 里的 characters[]，按 personId（没有就按 id；
     ambient 人物不算）取「可点的人」。只有 pid 与 party id 对得上、且不是 npc_
     前缀的，才算这个当事人在那张图里能说上话。

⚠ p_a / p_b / p_c 是**位置槽**，不是身份证：duty.js 的 p_a 在 case_00 里是王小雨、
  在 case_06 里就是李秀兰。所以不能把十张图的人按 pid 全局合并，必须先按案子
  圈定 scenes[] 再取人 —— 这就是上面第 ① 步配对的理由。

用法（项目根）：
    py -3 tools/gen_person_scenes.py            # 重新生成 src/web/person_scenes.json
    py -3 tools/gen_person_scenes.py --check    # 只比对，不写文件（CI 用）
    py -3 tools/gen_person_scenes.py --out x.json

配套校验（会额外检查每个 party 至少 1 处、json 与源码是否漂移）：
    py -3 tools/check_person_scenes.py
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = ROOT / "src" / "web" / "person_scenes.json"


# --------------------------------------------------------------------- JS 小工具
def _skip_string(src: str, i: int) -> int:
    """i 指向引号；返回字符串结束后的下标（跳过转义、模板字符串按普通串处理）。"""
    quote = src[i]
    i += 1
    while i < len(src):
        ch = src[i]
        if ch == "\\":
            i += 2
            continue
        if ch == quote:
            return i + 1
        i += 1
    return i


def _find_close(src: str, start: int) -> int:
    """start 指向开括号（[ 或 {）；返回对应闭括号的下标（找不到返回 -1）。"""
    pairs = {"[": "]", "{": "}"}
    open_ch = src[start]
    close_ch = pairs[open_ch]
    depth = 0
    i = start
    while i < len(src):
        ch = src[i]
        if ch in "\"'`":
            i = _skip_string(src, i)
            continue
        if ch == "/" and i + 1 < len(src):
            nxt = src[i + 1]
            if nxt == "/":
                j = src.find("\n", i)
                i = len(src) if j < 0 else j + 1
                continue
            if nxt == "*":
                j = src.find("*/", i + 2)
                i = len(src) if j < 0 else j + 2
                continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _block_after(src: str, decl_re: str) -> str:
    """找到 `const X = [` / `const X = {` 声明的开括号，返回括号内的源码。"""
    m = re.search(decl_re, src)
    if not m:
        return ""
    start = src.find(m.group(0)[-1], m.start())   # 声明末尾那个 [ 或 {
    if start < 0:
        return ""
    end = _find_close(src, start)
    if end < 0:
        return ""
    return src[start + 1:end]


def _objects_in(body: str) -> list[str]:
    """把数组体拆成一个个顶层对象字面量的内部源码（跳过字符串/注释里的括号）。"""
    out: list[str] = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch in "\"'`":
            i = _skip_string(body, i)
            continue
        if ch == "/" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt == "/":
                j = body.find("\n", i)
                i = len(body) if j < 0 else j + 1
                continue
            if nxt == "*":
                j = body.find("*/", i + 2)
                i = len(body) if j < 0 else j + 2
                continue
        if ch == "{":
            end = _find_close(body, i)
            if end < 0:
                break
            out.append(body[i + 1:end])
            i = end + 1
            continue
        i += 1
    return out


def _str_field(obj: str, key: str) -> str:
    m = re.search(r"\b" + re.escape(key) + r"\s*:\s*\"((?:\\.|[^\"\\])*)\"", obj)
    if not m:
        m = re.search(r"\b" + re.escape(key) + r"\s*:\s*'((?:\\.|[^'\\])*)'", obj)
    if not m:
        return ""
    return m.group(1).replace('\\"', '"').replace("\\'", "'")


def _bool_field(obj: str, key: str) -> bool:
    return bool(re.search(r"\b" + re.escape(key) + r"\s*:\s*true\b", obj))


# --------------------------------------------------------------------- app.js
def parse_app_scenes(src: str) -> tuple[dict[str, str], dict[str, str]]:
    """从 app.js 取 SCENES（场景 id → 中文名）与 SCENE_ALIAS（案卷地点 id → 场景 id）。"""
    names: dict[str, str] = {}
    body = _block_after(src, r"(?:const|let|var)\s+SCENES\s*=\s*\{")
    i = 0
    while i < len(body):
        m = re.search(r"([A-Za-z_$][\w$]*)\s*:\s*\{", body[i:])
        if not m:
            break
        sid = m.group(1)
        start = i + m.end() - 1
        end = _find_close(body, start)
        if end < 0:
            break
        inner = body[start + 1:end]
        name = _str_field(inner, "name")
        file = _str_field(inner, "file")
        if name:
            names[sid] = name
        elif file:
            names[sid] = Path(file).stem
        i = end + 1
    aliases: dict[str, str] = {}
    abody = _block_after(src, r"(?:const|let|var)\s+SCENE_ALIAS\s*=\s*\{")
    for m in re.finditer(r"([A-Za-z_$][\w$]*)\s*:\s*\"([^\"]+)\"", abody):
        aliases[m.group(1)] = m.group(2)
    for m in re.finditer(r"([A-Za-z_$][\w$]*)\s*:\s*'([^']+)'", abody):
        aliases.setdefault(m.group(1), m.group(2))
    return names, aliases


# --------------------------------------------------------------------- scenes/*.js
def parse_scene_people(src: str) -> list[dict[str, Any]]:
    """读 characters[]，换算成运行时真正可点的 personId（与 scene3d.js 同一条规则）。"""
    body = _block_after(src, r"(?:const|let|var)\s+characters\s*=\s*\[")
    people: list[dict[str, Any]] = []
    for obj in _objects_in(body):
        raw_id = _str_field(obj, "id")
        explicit = _str_field(obj, "personId")
        ambient = _bool_field(obj, "ambient")
        # scene3d.js：const pid = c.personId || (c.ambient ? "" : c.id)
        pid = explicit or ("" if ambient else raw_id)
        if not pid:
            continue
        people.append({
            "pid": pid,
            "id": raw_id,
            "name": _str_field(obj, "name") or _str_field(obj, "label"),
            "label": _str_field(obj, "label"),
            "ambient": ambient,
        })
    return people


def load_scene_people(root: Path = ROOT) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for path in sorted((root / "src" / "web" / "scenes").glob("*.js")):
        if path.name in ("kit.js", "scene3d.js"):
            continue
        out[path.stem] = parse_scene_people(path.read_text(encoding="utf-8"))
    return out


# --------------------------------------------------------------------- 生成
def build_mapping(root: Path = ROOT) -> tuple[dict[str, dict[str, list[dict[str, str]]]], list[str]]:
    """返回 ({case_id: {party_id: [{scene, name}]}}, warnings)。顺序按案卷 scenes[]。"""
    app_js = (root / "src" / "web" / "ui" / "app.js").read_text(encoding="utf-8")
    scene_names, aliases = parse_app_scenes(app_js)
    if not scene_names:
        raise RuntimeError("没从 app.js 解析出 SCENES 表（文件被改坏了？）")
    people = load_scene_people(root)

    mapping: dict[str, dict[str, list[dict[str, str]]]] = {}
    warnings: list[str] = []
    for case_path in sorted((root / "src" / "cases").glob("*/case.json")):
        case = json.loads(case_path.read_text(encoding="utf-8"))
        cid = str(case.get("id") or case_path.parent.name)
        parties = case.get("parties") or {}
        order = case.get("partyOrder") if isinstance(case.get("partyOrder"), list) else []
        party_ids = [p for p in order if p in parties] or list(parties)
        per: dict[str, list[dict[str, str]]] = {pid: [] for pid in party_ids}
        for entry in case.get("scenes") or []:
            if not isinstance(entry, dict):
                continue
            raw_sid = str(entry.get("id") or "")
            sid = aliases.get(raw_sid) or (raw_sid if raw_sid in scene_names else "")
            if not sid:
                warnings.append("%s: 地点 %r 没有对应的外壳场景，已跳过" % (cid, raw_sid))
                continue
            if sid not in people:
                warnings.append("%s: 场景 %r 没有 scenes/%s.js，已跳过" % (cid, sid, sid))
                continue
            name = scene_names.get(sid) or str(entry.get("name") or "") or sid
            for pid in party_ids:
                hit = False
                for person in people[sid]:
                    if person["pid"] != pid or person["pid"].startswith("npc_"):
                        continue
                    hit = True
                    break
                if not hit:
                    continue
                item = {"scene": sid, "name": name}
                if item not in per[pid]:
                    per[pid].append(item)
        mapping[cid] = per
    return mapping, warnings


def dumps(mapping: dict[str, Any]) -> str:
    return json.dumps(mapping, ensure_ascii=False, indent=2) + "\n"


def summarize(mapping: dict[str, Any]) -> str:
    lines = []
    for cid, parties in mapping.items():
        bits = []
        for pid, items in parties.items():
            bits.append("%s=%d" % (pid, len(items)))
        lines.append("%s: %s" % (cid, "  ".join(bits)))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="生成 person_scenes.json（人物在哪）")
    ap.add_argument("--out", default=str(OUT_JSON), help="输出文件（默认 src/web/person_scenes.json）")
    ap.add_argument("--check", action="store_true", help="只比对不写入；不一致返回 1")
    args = ap.parse_args(argv)

    mapping, warnings = build_mapping(ROOT)
    for msg in warnings:
        print("[WARN] " + msg, file=sys.stderr)
    text = dumps(mapping)
    out = Path(args.out)
    print(summarize(mapping))

    if args.check:
        if not out.is_file():
            print("[FAIL] 缺少 %s，先跑：py -3 tools/gen_person_scenes.py" % out, file=sys.stderr)
            return 1
        old = out.read_text(encoding="utf-8")
        if old != text:
            print("[FAIL] %s 与场景源码不一致 —— 有人改了 scenes/*.js 却没重跑生成脚本" % out,
                  file=sys.stderr)
            return 1
        print("[OK] %s 与源码一致" % out)
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8", newline="\n")
    print("写入 %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
