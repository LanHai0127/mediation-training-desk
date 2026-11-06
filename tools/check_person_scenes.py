#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""校验 src/web/person_scenes.json（人物在哪）没有漂。

三件事，任何一条不过就返回 1：
  ① 每个案子（src/cases/*/case.json）的每个 party，至少 1 个可对话场景；
  ② person_scenes.json 必须与「场景源码 + app.js 场景表」重新生成的结果完全一致
     —— 有人改了 scenes/*.js / case.json 却没重跑生成脚本，这里会红；
  ③ 结构合法：case / party 键对得上，scene 是 app.js 里有的场景 id，name 是字符串。

用法（项目根，CI / 回归都能跑，不需要起服务）：
    py -3 tools/check_person_scenes.py
    py -3 tools/check_person_scenes.py --quiet

配套生成脚本：
    py -3 tools/gen_person_scenes.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from gen_person_scenes import (  # noqa: E402
    build_mapping,
    parse_app_scenes,
)


def _load_case_meta(root: Path) -> dict[str, dict]:
    meta: dict[str, dict] = {}
    for path in sorted((root / "src" / "cases").glob("*/case.json")):
        try:
            case = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        cid = str(case.get("id") or path.parent.name)
        parties = case.get("parties") or {}
        order = case.get("partyOrder") if isinstance(case.get("partyOrder"), list) else []
        meta[cid] = {
            "path": path,
            "parties": {pid: (parties[pid] or {}).get("name", pid)
                        for pid in (order or list(parties)) if pid in parties},
        }
    return meta


def _diff(expected: dict, actual: dict, meta: dict[str, dict]) -> list[str]:
    out: list[str] = []
    for cid in sorted(set(expected) | set(actual)):
        exp = expected.get(cid) or {}
        act = actual.get(cid) or {}
        if not isinstance(act, dict):
            out.append("%s: json 里整个案子不是对象" % cid)
            continue
        for pid in sorted(set(exp) | set(act)):
            e = exp.get(pid)
            a = act.get(pid)
            if a == e:
                continue
            name = (meta.get(cid, {}).get("parties") or {}).get(pid, pid)
            out.append("%s/%s（%s）：json=%s  源数据=%s" % (
                cid, pid, name,
                json.dumps(a, ensure_ascii=False) if a is not None else "缺失",
                json.dumps(e, ensure_ascii=False) if e is not None else "缺失",
            ))
    return out


def _schema_errors(mapping: dict, scene_names: dict[str, str]) -> list[str]:
    errs: list[str] = []
    if not isinstance(mapping, dict):
        return ["person_scenes.json 顶层不是对象"]
    for cid, parties in mapping.items():
        if not isinstance(parties, dict):
            errs.append("%s: 值不是对象" % cid)
            continue
        for pid, items in parties.items():
            if not isinstance(items, list):
                errs.append("%s/%s: 不是数组" % (cid, pid))
                continue
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    errs.append("%s/%s[%d]: 不是对象" % (cid, pid, i))
                    continue
                scene = item.get("scene")
                name = item.get("name")
                if not isinstance(scene, str) or not scene:
                    errs.append("%s/%s[%d]: scene 缺失" % (cid, pid, i))
                elif scene not in scene_names:
                    errs.append("%s/%s[%d]: scene=%r 不在 app.js 的 SCENES 表里"
                                % (cid, pid, i, scene))
                if not isinstance(name, str) or not name.strip():
                    errs.append("%s/%s[%d]: name 缺失" % (cid, pid, i))
                elif scene in scene_names and name != scene_names[scene]:
                    errs.append("%s/%s[%d]: name=%r 与 SCENES[%s]=%r 不一致"
                                % (cid, pid, i, name, scene, scene_names[scene]))
    return errs


def collect(root: Path = ROOT) -> tuple[list[str], list[str], dict]:
    """返回 (errors, warnings, summary)。summary 给测试/报告用。"""
    errors: list[str] = []
    warnings: list[str] = []
    try:
        expected, build_warnings = build_mapping(root)
    except (OSError, RuntimeError, json.JSONDecodeError) as exc:
        return ["生成映射失败：%s" % exc], [], {}
    warnings.extend(build_warnings)

    meta = _load_case_meta(root)
    try:
        app_src = (root / "src" / "web" / "ui" / "app.js").read_text(encoding="utf-8")
        scene_names, _ = parse_app_scenes(app_src)
    except OSError as exc:
        return ["读 app.js 失败：%s" % exc], warnings, {}

    # ① 先读 json；下面同时看「源码算出来的」和「实际发给手机的」两份。
    out = Path(root / "src" / "web" / "person_scenes.json")
    json_ok = True
    if not out.is_file():
        errors.append("缺少 %s，先跑：py -3 tools/gen_person_scenes.py" % out)
        actual: dict = {}
        json_ok = False
    else:
        try:
            actual = json.loads(out.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append("person_scenes.json 解析失败：%s" % exc)
            actual = {}
            json_ok = False
        if not isinstance(actual, dict):
            errors.append("person_scenes.json 顶层不是对象")
            actual = {}
            json_ok = False

    # ② 每个案子的每个 party 至少 1 处：源码侧没有 → 生成器该报错；
    #    json 侧没有（或被手改成 []）→ 手机页面会显示「暂未安排」，同样算回归。
    missing: list[str] = []
    total_parties = 0
    total_links = 0
    for cid, parties in expected.items():
        names = (meta.get(cid, {}).get("parties") or {})
        act_parties = actual.get(cid) if isinstance(actual, dict) else {}
        if not isinstance(act_parties, dict):
            act_parties = {}
        for pid, items in parties.items():
            total_parties += 1
            total_links += len(items)
            j_items = act_parties.get(pid)
            n_src = len(items)
            n_json = len(j_items) if isinstance(j_items, list) else 0
            if n_src and n_json:
                continue
            why = []
            if not n_src:
                why.append("源码 0 处")
            if json_ok and not n_json:
                why.append("json %s" % ("0 处" if isinstance(j_items, list) else "缺失"))
            label = "%s 的 %s（%s）" % (cid, pid, names.get(pid, pid))
            if why:
                missing.append("%s：%s" % (label, "，".join(why)))
    if missing:
        errors.append("这些当事人没有任何可对话场景：" + "；".join(missing))

    # ③ json 必须与源码重新生成的一致（改场景没重跑脚本 → 这里红）
    if actual != expected:
        diffs = _diff(expected, actual, meta)
        errors.append("person_scenes.json 与场景源码不一致（有人改了场景没重跑生成脚本？）")
        errors.extend("  · " + d for d in diffs[:16])
        if len(diffs) > 16:
            errors.append("  · …还有 %d 处差异" % (len(diffs) - 16))

    # ④ 结构：场景 id / 中文名都要能对回 app.js 的 SCENES 表
    errors.extend(_schema_errors(actual, scene_names))

    # ⑤ 反向检查：json 里多出来的 party 键（案子删了人或改了 id）
    actual_items = actual.items() if isinstance(actual, dict) else []
    for cid, parties in actual_items:
        known = (meta.get(cid, {}).get("parties") or {})
        if not isinstance(parties, dict):
            continue
        for pid in parties:
            if cid in meta and pid not in known:
                errors.append("%s/%s: json 里多出的人，case.json 的 parties 里没有" % (cid, pid))

    summary = {
        "cases": len(expected),
        "parties": total_parties,
        "links": total_links,
        "multi": [
            "%s/%s %d 处" % (cid, pid, len(items))
            for cid, parties in expected.items()
            for pid, items in parties.items() if len(items) > 1
        ],
    }
    return errors, warnings, summary


def verify(root: Path = ROOT) -> tuple[bool, str]:
    """给 tools/test_app.py 这类测试用的一行式入口。"""
    errors, warnings, summary = collect(root)
    if errors:
        detail = "；".join(e.strip() for e in errors[:6])
        if len(errors) > 6:
            detail += "；…共 %d 条" % len(errors)
        return False, detail
    return True, "；".join(
        [w.strip() for w in warnings] +
        ["%d 案 / %d 当事人 / %d 条地图标注（%s）" % (
            summary.get("cases", 0), summary.get("parties", 0), summary.get("links", 0),
            "、".join(summary.get("multi") or []) or "都只有 1 处")]
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="校验 person_scenes.json 与场景源码一致")
    ap.add_argument("--quiet", action="store_true", help="只打印结论")
    args = ap.parse_args(argv)
    errors, warnings, summary = collect(ROOT)
    if not args.quiet:
        for w in warnings:
            print("[WARN] " + w)
    if summary:
        print("覆盖：%d 案 / %d 当事人 / %d 条标注；多场景：%s" % (
            summary["cases"], summary["parties"], summary["links"],
            "、".join(summary["multi"]) or "无"))
    if errors:
        print("[FAIL] 共 %d 条：" % len(errors))
        for e in errors:
            print("  " + e)
        return 1
    print("[OK] person_scenes.json 与场景源码一致；每个案子的每个 party 都有可对话场景")
    return 0


if __name__ == "__main__":
    sys.exit(main())
