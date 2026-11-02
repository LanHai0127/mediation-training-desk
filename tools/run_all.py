#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""一键跑全部自测，并把**实测到的断言数**写进 `tools/_ledger.json`。

为什么要有它
------------
文档里写的「X 套 / Y 项断言」如果靠手抄，测试加了两条断言文档不会知道，也没人负责。
跑一次这个脚本，各套件的真实通过数就落盘成 ledger；文档只引用 ledger，不自己写数字。
**测试是事实来源，文档是断言。**

用法
----
    python tools/run_all.py                  # 全跑（需要服务已在 8770 监听）
    python tools/run_all.py --record         # 全跑并写 tools/_ledger.json
    python tools/run_all.py --only test_smoke --record
    python tools/run_all.py --list           # 只列套件

约定
----
· 套件是普通 Python 脚本，逐行打印 `[PASS] 说明` / `[FAIL] 说明`，全过则退出码 0。
· **0 条断言 + 非零退出 = 没跑起来**（解释器不对 / 端口被占 / 服务没起），
  这种结果绝不进 ledger —— 记一笔 0 会把文档里的合计数字当场带崩。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "tools" / "_ledger.json"
PORT = int(os.environ.get("TJ_PORT") or 8770)
BASE = "http://127.0.0.1:%d" % PORT

# (名称, 命令, 是否需要服务在跑)
SUITES: list[tuple[str, list[str], bool]] = [
    # S1：服务能起、页面能开、安全头与越界读护栏在。
    ("test_smoke", ["tools/test_smoke.py"], True),
]

LOG_DIR = ROOT / "tools" / "_logs"
MARK = re.compile(r"^\s*\[(PASS|FAIL)\]")

# 探活要绕开系统代理：HTTP_PROXY 指向本地代理时，urlopen 会把 127.0.0.1 也交出去，
# 于是"服务没起"和"代理不回环"看起来一模一样。
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def server_up() -> bool:
    try:
        with OPENER.open(BASE + "/api/health", timeout=4) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def run_one(name: str, argv: list[str], timeout: int, verbose: bool) -> tuple[int, int, int, str]:
    """跑一个套件，边跑边打日志。返回 (通过数, 失败数, 退出码, 尾部输出)。"""
    proc = subprocess.Popen([sys.executable] + argv, cwd=str(ROOT),
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", bufsize=1)
    passed = failed = 0
    tail: list[str] = []
    full: list[str] = []
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip("\n")
            tail.append(line)
            full.append(line)
            if len(tail) > 200:
                tail.pop(0)
            m = MARK.match(line)
            if m:
                if m.group(1) == "PASS":
                    passed += 1
                else:
                    failed += 1
                if m.group(1) == "FAIL":
                    print("      " + line.strip())
                elif verbose:
                    print("      " + line.strip())
            elif verbose:
                print("      " + line)
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        tail.append("[超时] 超过 %d 秒已终止" % timeout)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    (LOG_DIR / ("%s.log" % name)).write_text("\n".join(full), encoding="utf-8")
    return passed, failed, (proc.returncode if proc.returncode is not None else -1), "\n".join(tail[-12:])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--record", action="store_true", help="把实测结果写入 tools/_ledger.json")
    ap.add_argument("--only", default="", help="只跑这些套件（逗号分隔）")
    ap.add_argument("--timeout", type=int, default=900, help="单个套件超时秒数")
    ap.add_argument("--list", action="store_true", help="只列套件")
    ap.add_argument("-v", "--verbose", action="store_true", help="把套件的完整输出也打到屏幕上")
    args = ap.parse_args()

    if args.list:
        for name, argv, needs in SUITES:
            print("%-16s %-30s %s" % (name, " ".join(argv), "需要服务" if needs else "离线"))
        return 0

    # 输出重定向到文件时 Python 会块缓冲，进度就"看不见"了；改成行缓冲，实时可见
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, OSError):
        pass

    picked = [s for s in SUITES if not args.only or s[0] in args.only.split(",")]
    need_server = any(s[2] for s in picked)

    print("=" * 70)
    print("全部自测 —— %d 个套件" % len(picked))
    print("=" * 70)
    up = server_up()
    print("服务 %s：%s" % (BASE, "在跑 ✅" if up else "没起 ❌"))
    if need_server and not up:
        print("\n有套件需要服务在跑，请先另开一个窗口执行：python src/server.py")
        return 1

    results: dict[str, dict] = {}
    t0 = time.time()
    for name, argv, _needs in picked:
        print("\n" + "-" * 70)
        print("▶ %s" % name)
        t = time.time()
        passed, failed, code, _tail = run_one(name, argv, args.timeout, args.verbose)
        dt = time.time() - t
        ok = code == 0 and failed == 0
        print("  %s ｜ 通过 %d ｜ 失败 %d ｜ %.1fs ｜ 退出码 %d"
              % ("✅" if ok else "❌", passed, failed, dt, code))
        results[name] = {"total": passed, "failed": failed, "exit": code,
                         "seconds": round(dt, 1), "ok": ok}

    assert_suites = {k: v for k, v in results.items() if v["total"] > 0}
    total = sum(v["total"] for v in assert_suites.values())
    bad = [k for k, v in results.items() if not v["ok"]]

    print("\n" + "=" * 70)
    print("汇总（%.1fs）" % (time.time() - t0))
    for k, v in results.items():
        print("  %-16s 通过 %-4d 失败 %-3d %s" % (k, v["total"], v["failed"], "✅" if v["ok"] else "❌"))
    print("  断言套件合计：%d 项" % total)

    # 「跑不起来」不是「没通过」：0 条断言 + 非零退出 = 解释器不对 / 端口被占 / 服务没起。
    # 这种结果绝不能进 ledger —— 记一笔 0，文档里的合计数字当场全崩。
    boot_fail = [k for k, v in results.items() if v["total"] == 0 and v["exit"] != 0]
    if boot_fail:
        print("\n" + "=" * 70)
        print("✗ %d 个套件跑了 0 条断言就非零退出 —— 这不是测试结果，是**没跑起来**：" % len(boot_fail))
        for k in boot_fail:
            print("    · %s" % k)
        print("  常见原因：解释器不对 / 端口被占 / 服务没起。")
        if args.record:
            print("  ✗ **拒绝写入 ledger**（保留上一份可信结果）")
        return 1

    if args.record:
        payload = {
            "updated": datetime.now().isoformat(timespec="seconds"),
            "note": "由 tools/run_all.py --record 生成；文档里的断言数以这里为准",
            "suites": assert_suites,
            "tools": {k: v for k, v in results.items() if v["total"] == 0},
            "total": total,
            "all_ok": not bad,
        }
        LEDGER.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print("  ledger 已写入 tools/_ledger.json")
        if len(picked) < len(SUITES):
            print("  ！本次只跑了 %d/%d 个套件，ledger 是**部分**结果" % (len(picked), len(SUITES)))

    if bad:
        print("\n结果：%d 个套件没过 ❌ → %s" % (len(bad), "、".join(bad)))
        return 1
    print("\n结果：全部通过 ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
