#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S1 冒烟：服务能起、首页能开、合规角标在、安全头在、越界读被拦、版本探针在。

只依赖标准库。默认打 127.0.0.1:8770，可用 TJ_PORT 改。
每行 `[PASS]` / `[FAIL]` 由 tools/run_all.py 计数；有 FAIL 则退出码 1。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:%d" % int(os.environ.get("TJ_PORT") or 8770)
BADGE = "教学演练 · 虚构案例 · 非真实警情"

# 打本机端口必须绕开系统代理：本机环境变量里常有 HTTP_PROXY 指向本地代理，
# urllib 会老老实实走它，于是"服务没起"和"代理不回环"看起来一模一样。
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

passed = 0
failed = 0


def check(ok: bool, msg: str, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print("[PASS] " + msg)
    else:
        failed += 1
        print("[FAIL] " + msg + ("  ← " + detail if detail else ""))


def get(path: str) -> tuple[int, bytes, dict]:
    req = urllib.request.Request(BASE + path, method="GET")
    try:
        with OPENER.open(req, timeout=8) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {})
    except (urllib.error.URLError, OSError) as e:
        return 0, b"", {"error": str(e)}


def main() -> int:
    # 1. 健康检查
    code, body, _ = get("/api/health")
    data = {}
    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        pass
    check(code == 200 and data.get("ok") is True, "GET /api/health 返回 200 且 ok=true", "code=%s" % code)

    # 2. 版本探针：部署后靠它确认跑的是刚部署的那份
    code, body, _ = get("/__ver")
    ver = {}
    try:
        ver = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        pass
    check(code == 200 and bool(ver.get("build")) and bool(ver.get("git")),
          "GET /__ver 带 build 时间戳与 git 短 hash", "code=%s body=%r" % (code, body[:80]))

    # 3. 首页能开，且合规角标在（红线：全站常驻）
    code, body, hdr = get("/")
    html = body.decode("utf-8", "replace")
    check(code == 200 and "<html" in html.lower(), "GET / 返回 HTML 页面", "code=%s" % code)
    check(BADGE in html, "首页含合规角标「%s」" % BADGE)

    # 4. 安全头：CSP 不给内联脚本，nosniff、frame 限制都在
    csp = hdr.get("Content-Security-Policy", "")
    check("script-src 'self'" in csp and "unsafe-inline" not in csp.split("script-src")[1][:40],
          "CSP 限制脚本源、script-src 不含 unsafe-inline", "csp=%r" % csp[:120])
    check(hdr.get("X-Content-Type-Options") == "nosniff", "带 X-Content-Type-Options: nosniff")
    check(bool(hdr.get("X-Frame-Options")), "带 X-Frame-Options")

    # 5. Server 头不泄露解释器版本（版本号等于给扫描器报菜名）
    check("Python" not in hdr.get("Server", ""), "Server 头不含 Python 版本", "server=%r" % hdr.get("Server"))

    # 6. 越界读：/static/../server.py 必须被拦（is_relative_to 校验，不是前缀比较）
    code, body, _ = get("/static/../server.py")
    check(code == 404, "越界读 /static/../server.py 被拦成 404", "code=%s" % code)

    # 7. 不存在的静态资源也是 404，不是 500
    code, _, _ = get("/static/not-there.css")
    check(code == 404, "不存在的静态资源返回 404", "code=%s" % code)

    print("-" * 60)
    print("通过 %d ｜ 失败 %d" % (passed, failed))
    return 0 if failed == 0 and passed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
