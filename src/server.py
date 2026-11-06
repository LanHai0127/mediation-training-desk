#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""调解台 · 基层矛盾纠纷调解模拟训练系统 —— 服务端骨架。

标准库实现，零第三方依赖。当前是 S1 阶段的"空壳"：能起服务、能过登录闸、
能出健康检查与版本探针、能服务静态页面。业务接口（案例、对话、判定、复盘）
在 S2~S6 逐步接入，接入时只加路由，不动这一层。

对外接口（S1 已就位）：

  GET  /__ver         构建时间戳 + git 短 hash（部署后验"跑的就是刚部署的那份"）
  GET  /api/health    健康检查：内核状态、LLM 是否可用、限流快照
  GET  /login         登录页（未启用账号时自动跳首页）
  POST /api/login     登录（PBKDF2 校验 + 双闸限速）
  POST /api/logout    登出

启动：
    python src/server.py                 # 默认 0.0.0.0:8770（局域网可访问）
    python src/server.py --port 9000
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from auth import Auth  # noqa: E402
from game import LLMClient, Session, discover_cases, public_case, rag, report_text  # noqa: E402

WEB_DIR = ROOT / "web"
LOGIN_PAGE = WEB_DIR / "login.html"
BUILD_TS = time.strftime("%Y-%m-%dT%H:%M:%S%z")

PUBLIC_PATHS = {"/login", "/login/", "/api/login", "/logout", "/favicon.ico",
                "/static/favicon.svg"}


# --------------------------------------------------------------------- 配置
def load_config() -> dict[str, Any]:
    """本机私有配置（config.local.json）：密钥只留在这里，不进版本库。"""
    path = ROOT / "config.local.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")) or {}
    except (OSError, json.JSONDecodeError):
        return {}


def git_hash() -> str:
    """短 hash：部署后靠它确认线上跑的是哪一版。拿不到就写 nogit，不编。"""
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             cwd=str(ROOT), capture_output=True, text=True, timeout=3)
        if out.returncode == 0:
            return out.stdout.strip() or "nogit"
    except (OSError, subprocess.SubprocessError):
        pass
    return "nogit"


CONFIG = load_config()
AUTH = Auth(ROOT)          # 没有 auth.local.json 时不拦（本地裸跑 / 自测）
LLM = LLMClient.from_project(ROOT, CONFIG)
CASES = {c["id"]: c for c in discover_cases(ROOT / "cases")}
LAWS_META = rag.load(ROOT)
SESSIONS: dict[str, Session] = {}          # 训练会话（内存即可：演练不需要跨重启续局）
SESS_LOCK = threading.RLock()              # 可重入：_submit 里会先取 session 再取锁
BUILD_GIT = git_hash()
SERVER_CFG = CONFIG.get("server") or {}
LOCK = threading.Lock()


def _cfg_int(env_name: str, key: str, default: int) -> int:
    """读限流参数：环境变量优先（便于自测另起实例），其次 config.local.json。"""
    raw = os.environ.get(env_name)
    if raw is None:
        raw = SERVER_CFG.get(key, default)
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return default


class RateLimiter:
    """模型调用的滑动窗口限流 —— 公网暴露后防止有人把额度刷爆。

    两道闸：
      · per_minute  单 IP 每分钟最多几次"准备调用模型"的请求（防连点 / 脚本）
      · global_day  所有 IP 合计每天最多几次（真正的额度保险丝，伪造转发头也绕不过）
    被限的那一次不报错，直接走离线的剧本台词（训练照常可走完），并在响应里如实注明。
    参数为 0 表示该闸关闭。
    """

    def __init__(self, per_minute: int = 12, global_day: int = 800) -> None:
        self.per_minute = per_minute
        self.global_day = global_day
        self._ip_hits: dict[str, list[float]] = {}
        self._day_hits: list[float] = []
        self._lock = threading.Lock()

    @staticmethod
    def _prune(rows: list[float], now: float, window: float) -> list[float]:
        return [t for t in rows if now - t < window]

    def allow(self, ip: str) -> tuple[bool, str]:
        """返回 (是否放行, 未放行的原因)。"""
        now = time.time()
        with self._lock:
            self._day_hits = self._prune(self._day_hits, now, 86400.0)
            if self.global_day and len(self._day_hits) >= self.global_day:
                return False, "今日模型调用额度已用完"
            rows = self._prune(self._ip_hits.get(ip, []), now, 60.0)
            if self.per_minute and len(rows) >= self.per_minute:
                self._ip_hits[ip] = rows
                return False, "说话太快了"
            rows.append(now)
            self._ip_hits[ip] = rows
            self._day_hits.append(now)
            if len(self._ip_hits) > 5000:                       # 防字典膨胀
                self._ip_hits = {k: v for k, v in self._ip_hits.items() if v}
            return True, ""

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            used = len(self._prune(self._day_hits, now, 86400.0))
            active = sum(1 for rows in self._ip_hits.values()
                         if self._prune(rows, now, 60.0))
        return {
            "perMinutePerIp": self.per_minute,
            "globalPerDay": self.global_day,
            "globalUsedToday": used,
            "activeIps": active,
        }


RATE = RateLimiter(
    per_minute=_cfg_int("LLM_RATE_PER_MIN", "llmPerMinutePerIp", 20),
    global_day=_cfg_int("LLM_RATE_PER_DAY", "llmGlobalPerDay", 800),
)


# --------------------------------------------------------------------- 工具
def json_bytes(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


class Handler(BaseHTTPRequestHandler):
    server_version = "MediationBench/0.1"
    sys_version = ""            # 别把 "Python/3.13.x" 贴出去（版本号等于给扫描器报菜名）

    # CSP：应用层也带一份 —— 走 nginx 时那层还会再发一遍（重复的头浏览器按最严的合取），
    # 但局域网直连端口是没有 nginx 的，得上这里保护。
    # · `script-src 'self'` 没有 'unsafe-inline'：页面脚本全是外链，全项目没有内联 <script>，
    #   也没有 on*= 事件属性 —— 注入进来的 <script> / onerror= 一律被浏览器拦掉。
    # · `style-src` 必须留 'unsafe-inline'：场景绘制与布局里有内联 style 属性（CSP3 回退到 style-src）。
    CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
           "script-src 'self'; connect-src 'self'; frame-ancestors 'self'; "
           "base-uri 'none'; form-action 'self'")

    # 登录页自己要用、且必须在登录闸外面的静态资源。
    # 只放行这三个文件名，不是整个 /static/：页面脚本与样式仍要登录。
    PUBLIC_STATIC = ("favicon.svg", "login.css", "login.js")

    # ---------------------------------------------------------- 基础
    def log_message(self, fmt: str, *args: Any) -> None:  # 静音默认日志
        return

    def version_string(self) -> str:
        """`Server:` 头。基类实现会带上 Python 版本，这里盖掉。"""
        return self.server_version

    def _send(self, code: int, body: bytes, ctype: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Content-Security-Policy", self.CSP)
        for key, val in (extra or {}).items():
            self.send_header(key, val)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj: Any, code: int = 200, extra: dict[str, str] | None = None) -> None:
        self._send(code, json_bytes(obj), "application/json; charset=utf-8", extra)

    def _redirect(self, location: str) -> None:
        self._send(302, b"", "text/plain; charset=utf-8", {"Location": location})

    def _read_json(self) -> dict[str, Any]:
        """读 JSON 请求体：畸形 / 超大一律按空数据处理，绝不让连接直接断掉。

        ⚠️ 必须保证返回 dict：`json.loads` 对 `[1,2,3]` / `"str"` / `123` / `null` 都会成功，
        但它们没有 `.get()`。下游一律 `data.get("...")`，漏掉就是一条 500。
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            return {}
        if length <= 0 or length > 1_000_000:
            return {}
        try:
            raw = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError, OSError):
            return {}
        return raw if isinstance(raw, dict) else {}

    def _client_ip(self) -> str:
        """取客户端 IP：nginx 反代时看 X-Real-IP（我方 conf 用 $remote_addr 覆盖它）。"""
        xr = (self.headers.get("X-Real-IP") or "").strip()
        if xr:
            return xr
        xff = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        return xff or self.client_address[0]

    # ---------------------------------------------------------- 登录鉴权
    @property
    def _secure(self) -> bool:
        """Cookie 要不要带 Secure：走 https 时才带，本机 http 自测不带。"""
        return (self.headers.get("X-Forwarded-Proto") or "").lower() == "https"

    def _current_user(self) -> str | None:
        return AUTH.check(Auth.cookie_from(self.headers.get("Cookie") or ""))

    def _auth_gate(self, path: str) -> bool:
        """过闸：True = 放行继续；False = 已经回过响应，调用方必须立刻 return。"""
        # 第二个参数是 TCP 直连对端（不可伪造）；豁免要求"对端也是回环"才成立，
        # 这样伪造 X-Real-IP 绕不过去。
        if AUTH.exempt(self._client_ip(), self.client_address[0]) or self._current_user():
            return True
        if path.startswith("/api/"):
            self._json({"error": "需要登录", "login": "/login"}, 401)
        else:
            self._redirect("/login?next=" + quote(path))
        return False

    # ---------------------------------------------------------- 路由
    def do_GET(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            query = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            if path == "/__ver":
                # 部署探针：线上返回的构建戳与 git 短 hash 必须与刚部署的那份一致。
                return self._json({"build": BUILD_TS, "git": BUILD_GIT,
                                   "pid": os.getpid(), "port": self.server.server_address[1]})
            if path in ("/login", "/login/"):
                return self._login_page(query)
            if path == "/logout":
                return self._logout_page(query)
            if path == "/favicon.ico":
                # 页面已用 <link rel="icon"> 指定 SVG 图标；个别浏览器仍会探这个路径，
                # 给它空响应，控制台就不会挂一条 404（评审会看控制台）。放行，不要求登录。
                return self._send(204, b"", "image/x-icon")
            if path.startswith("/static/") and path[len("/static/"):] in self.PUBLIC_STATIC:
                return self._static(path[len("/static/"):])
            if not self._auth_gate(path):
                return
            if path in ("/", "/index.html"):
                return self._static("index.html")
            if path.startswith("/static/"):
                return self._static(path[len("/static/"):])
            if path == "/api/cases":
                return self._json({
                    "cases": [{
                        "id": c["id"],
                        "title": c.get("title", ""),
                        "subtitle": c.get("meta", {}).get("subtitle", ""),
                        "difficulty": c.get("meta", {}).get("difficulty", ""),
                        "playtime": c.get("meta", {}).get("playtime", ""),
                        "brief": c.get("meta", {}).get("brief", ""),
                        "scenes": len(c.get("scenes") or []),
                        "parties": len(c.get("parties") or {}),
                        "dimensions": len(c.get("dimensions") or []),
                    } for c in CASES.values()]
                })
            if path.startswith("/api/case/"):
                cid = path[len("/api/case/"):]
                if cid not in CASES:
                    return self._json({"error": "case not found"}, 404)
                return self._json(public_case(CASES[cid]))
            if path.startswith("/api/report/"):
                # 复盘报告：本地生成，不调模型；同一份数据还能导出纯文本。
                sid = path[len("/api/report/"):]
                s_ = self._session_of(sid)
                if not s_ or not s_.report:
                    return self._json({"error": "还没有可复盘的判定"}, 404)
                return self._json({"report": s_.report, "text": report_text(s_.report),
                                   "audit": s_.audit_lines()})
            if path.startswith("/api/audit/"):
                s_ = self._session_of(path[len("/api/audit/"):])
                if not s_:
                    return self._json({"error": "session not found"}, 404)
                return self._json({"audit": s_.audit_lines()})
            if path == "/api/laws":
                # 法条速查：只给"要点 + 条号"，能溯源；不参与判定。
                cid = query.get("case", "")
                q = query.get("q", "")
                if cid in CASES:
                    c = CASES[cid]
                    q = q or " ".join([c.get("title", ""), c.get("meta", {}).get("subtitle", ""),
                                       c.get("meta", {}).get("brief", "")])
                hits = rag.search(q, int(query.get("n") or 3)) if q else []
                return self._json({"query": q, "articles": hits, "meta": rag.meta()})
            if path == "/api/llm/status":
                return self._json({"llm": LLM.status(), "offlineScript": True})
            if path == "/api/health":
                _fs = AUTH.fail_state()
                return self._json(
                    {
                        "ok": True,
                        "stage": "S2",
                        "build": {"ts": BUILD_TS, "git": BUILD_GIT},
                        "cases": list(CASES),
                        "llm": LLM.enabled,
                        "laws": LAWS_META.get("count", 0),
                        "llmLimits": RATE.snapshot(),
                        "auth": {
                            "enabled": AUTH.enabled,
                            "users": AUTH.user_names(),
                            "sessions": AUTH.active_sessions(),
                            # 只报数量，不报被锁的 IP / 用户名 —— 探活接口不该当"攻击者名单"用。
                            "throttled": {"ip": len(_fs["ipLocked"]), "user": len(_fs["userLocked"]),
                                          "stateFile": _fs["stateFile"]},
                        },
                    }
                )
            return self._json({"error": "not found"}, 404)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return self._json({"error": "internal error"}, 500)

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_POST(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            data = self._read_json()
            if path == "/api/login":
                return self._do_login(data)
            if path == "/api/logout":
                return self._do_logout()
            if not self._auth_gate(path):
                return
            if path == "/api/session":
                return self._new_session(data)
            if path == "/api/look":
                return self._look(data)
            if path == "/api/scene":
                return self._scene(data)
            if path == "/api/dialogue":
                return self._dialogue(data)
            if path == "/api/submit":
                return self._submit(data)
            if path == "/api/notes":
                return self._notes(data)
            if path == "/api/call":
                return self._call(data)
            return self._json({"error": "not found"}, 404)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return self._json({"error": "internal error"}, 500)

    # ---------------------------------------------------------- 登录 / 登出
    def _login_page(self, query: dict[str, str]) -> None:
        """登录页本身要放行；没启用登录时直接送回首页。"""
        if not AUTH.enabled:
            return self._redirect("/")
        if not LOGIN_PAGE.is_file():
            return self._send(500, "登录页缺失：web/login.html".encode("utf-8"),
                              "text/plain; charset=utf-8")
        self._send(200, LOGIN_PAGE.read_bytes(), "text/html; charset=utf-8")

    def _do_login(self, data: dict[str, Any]) -> None:
        if not AUTH.enabled:
            return self._json({"ok": True, "user": "", "note": "本实例未启用登录"})
        ip = self._client_ip()
        user = str(data.get("user") or "").strip()
        # 两道闸：①来源 IP 挡同一台机器连点；②账号挡"换 IP 爆破同一个账号"。
        wait = AUTH.throttled(ip)
        if wait > 0:
            return self._json(
                {"ok": False, "error": "尝试过于频繁，请 %.0f 分钟后再试" % (wait / 60.0 + 0.5)}, 429
            )
        wait_user = AUTH.throttled_user(user)
        if wait_user > 0:
            return self._json(
                {"ok": False,
                 "error": "该账号尝试过于频繁，请 %.0f 分钟后再试" % (wait_user / 60.0 + 0.5)}, 429
            )
        if not AUTH.verify(user, str(data.get("password") or "")):
            AUTH.note_login_fail(ip, user)     # IP + 账号一起记、只落一次盘
            print("[auth] 登录失败 user=%r ip=%s" % (user, ip))
            return self._json({"ok": False, "error": "账号或口令不正确"}, 401)
        AUTH.clear_fails(ip)
        AUTH.clear_user_fails(user)
        token, ttl = AUTH.open(user)
        print("[auth] 登录成功 user=%s ip=%s" % (user, ip))
        self._json({"ok": True, "user": user, "expiresIn": int(ttl)},
                   extra={"Set-Cookie": AUTH.cookie_header(token, self._secure)})

    # ---------------------------------------------------------- 训练会话
    def _session_of(self, sid: str) -> Session | None:
        with SESS_LOCK:
            return SESSIONS.get(sid or "")

    def _new_session(self, data: dict[str, Any]) -> None:
        cid = str(data.get("caseId") or "")
        if cid not in CASES:
            return self._json({"error": "case not found"}, 404)
        s = Session(CASES[cid], LLM)
        with SESS_LOCK:
            SESSIONS[s.id] = s
        # 会话表别无限长：超过 200 个就把最早的丢掉（演练场景不会有这么多并发）
        if len(SESSIONS) > 200:
            for k in sorted(SESSIONS, key=lambda x: SESSIONS[x].created)[:50]:
                SESSIONS.pop(k, None)
        self._json({"ok": True, "view": s.view()})

    def _look(self, data: dict[str, Any]) -> None:
        s = self._session_of(str(data.get("sessionId") or ""))
        if not s:
            return self._json({"error": "session not found"}, 404)
        res = s.look(str(data.get("spotId") or ""))
        res["view"] = s.view()
        self._json(res)

    def _scene(self, data: dict[str, Any]) -> None:
        s = self._session_of(str(data.get("sessionId") or ""))
        if not s:
            return self._json({"error": "session not found"}, 404)
        sid = str(data.get("sceneId") or "")
        if any(sc.get("id") == sid for sc in s.case.get("scenes", [])):
            s.scene_id = sid
            return self._json({"ok": True, "view": s.view()})
        self._json({"ok": False, "error": "没有这个场景"}, 400)

    def _dialogue(self, data: dict[str, Any]) -> None:
        """当事人对话：规则定状态、模型出口语；模型不通就退剧本台词。

        限流只针对"本来就要调模型"的请求：离线请求不该占额度，
        否则演示时一被限流，连剧本台词都会被误当成"额度用完"。
        """
        s = self._session_of(str(data.get("sessionId") or ""))
        if not s:
            return self._json({"error": "session not found"}, 404)
        pid = str(data.get("partyId") or "")
        text = str(data.get("text") or "")[:300]     # 超长输入截断，别送去模型烧额度
        channel = str(data.get("channel") or "face")
        if channel not in ("face", "separate", "phone"):
            channel = "face"
        offline = bool(data.get("offline")) or not LLM.enabled

        limited = ""
        if not offline:
            ok, why = RATE.allow(self._client_ip())
            if not ok:
                limited = why

        with SESS_LOCK:
            if channel == "phone":
                s.note_call_turn()
            if offline or limited:
                saved, s.dialogue.client = s.dialogue.client, None
                try:
                    res = s.dialogue.talk(pid, text, channel)
                finally:
                    s.dialogue.client = saved
            else:
                res = s.dialogue.talk(pid, text, channel)

        res["degraded"] = bool(offline or limited)
        res["degradedNote"] = ("模型未启用或调用失败，本条走剧本台词" if offline and not LLM.enabled
                               else (limited or ""))
        if pid not in [t["partyId"] for t in s.talked]:
            s.talked.append({"partyId": pid, "channel": channel})
        res["view"] = s.view()
        self._json(res)

    def _notes(self, data: dict[str, Any]) -> None:
        """记事本：增 / 改 / 删 / 列。内容只存在这次训练的内存里，不落库、不进日志正文。"""
        s = self._session_of(str(data.get("sessionId") or ""))
        if not s:
            return self._json({"error": "session not found"}, 404)
        op = str(data.get("op") or "list")
        with SESS_LOCK:
            if op == "add":
                res = s.add_note(str(data.get("text") or ""))
            elif op == "update":
                res = s.update_note(str(data.get("id") or ""), str(data.get("text") or ""))
            elif op == "delete":
                res = s.delete_note(str(data.get("id") or ""))
            else:
                res = {"ok": True, "message": ""}
            res["notes"] = [dict(n) for n in s.notes]
        res["view"] = s.view()
        self._json(res)

    def _call(self, data: dict[str, Any]) -> None:
        """通话：开始 / 结束。只记"跟谁、多久、几轮"，不存内容。"""
        s = self._session_of(str(data.get("sessionId") or ""))
        if not s:
            return self._json({"error": "session not found"}, 404)
        op = str(data.get("op") or "")
        with SESS_LOCK:
            if op == "start":
                res = s.start_call(str(data.get("partyId") or ""))
            elif op == "end":
                res = s.end_call(str(data.get("callId") or ""))
            else:
                res = {"ok": False, "message": "未知操作"}
            res["calls"] = [dict(c) for c in s.calls]
        res["view"] = s.view()
        self._json(res)

    def _submit(self, data: dict[str, Any]) -> None:
        """提交方案 / 依法转办。判定只吃 plan 与客观状态，不吃对话文本。"""
        s = self._session_of(str(data.get("sessionId") or ""))
        if not s:
            return self._json({"error": "session not found"}, 404)
        raw = data.get("plan") if isinstance(data.get("plan"), dict) else {}
        plan = {str(k): v for k, v in raw.items() if isinstance(v, str)}
        mode = str(data.get("mode") or "agreement")
        if mode not in ("agreement", "refer"):
            mode = "agreement"
        with SESS_LOCK:
            res = s.submit(plan, mode)
        res["report"] = s.report
        res["notes"] = [dict(n) for n in s.notes]
        res["view"] = s.view()
        self._json(res)

    def _do_logout(self) -> None:
        AUTH.revoke(Auth.cookie_from(self.headers.get("Cookie") or ""))
        self._json({"ok": True}, extra={"Set-Cookie": AUTH.clear_cookie_header(self._secure)})

    def _logout_page(self, query: dict[str, str]) -> None:
        AUTH.revoke(Auth.cookie_from(self.headers.get("Cookie") or ""))
        nxt = query.get("next") or "/login"
        if not nxt.startswith("/") or nxt.startswith("//"):   # 只允许站内路径，防开放重定向
            nxt = "/login"
        page = (
            "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<title>已退出 · 调解台</title><style>"
            "body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;"
            "background:#f4f6f9;color:#1f2328;font-family:'PingFang SC','Microsoft YaHei',sans-serif}"
            ".c{background:#fff;border:1px solid #e4e8ef;border-radius:16px;padding:34px 36px;"
            "box-shadow:0 2px 6px rgba(16,24,40,.06),0 16px 44px rgba(16,24,40,.13);text-align:center}"
            "h1{font-size:17px;margin:0 0 8px}p{color:#6b7280;font-size:13px;margin:0 0 20px}"
            "a{display:inline-block;padding:10px 20px;border-radius:10px;background:#2f6feb;color:#fff;"
            "text-decoration:none;font-size:14px;font-weight:600}a:hover{background:#1d55c8}"
            "</style></head><body><div class=\"c\"><h1>已退出登录</h1>"
            "<p>会话已结束，浏览器里的登录凭据已清除。</p>"
            "<a href=\"__NEXT__\">重新登录</a></div></body></html>"
        ).replace("__NEXT__", nxt)
        self._send(200, page.encode("utf-8"), "text/html; charset=utf-8",
                   {"Set-Cookie": AUTH.clear_cookie_header(self._secure)})

    # ---------------------------------------------------------- 静态资源
    def _static(self, rel: str) -> None:
        """只服务 web/ 目录下的文件。

        用 `is_relative_to` 而不是字符串前缀比较 —— `startswith("…\\web")` 会把同级的
        `web-备份/` 也放过（前缀成立但并非子目录），是个标准的越界读隐患。
        """
        web_root = WEB_DIR.resolve()
        target = (web_root / rel).resolve()
        if not target.is_relative_to(web_root) or not target.is_file():
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        ctype, _ = mimetypes.guess_type(str(target))
        self._send(200, target.read_bytes(), ctype or "application/octet-stream")


# --------------------------------------------------------------------- 辅助函数
class GameServer(ThreadingHTTPServer):
    """带足够 listen backlog 的多线程 HTTP 服务。

    默认只有 5（`socketserver.TCPServer.request_queue_size`）。现场演示时多台设备
    可能在几秒内一起打开页面 —— 超过 backlog 的连接会被内核直接拒掉，用户侧看到的是
    "偶尔打不开、刷新一下才好"，日志里什么都没有（连接根本没进来）。
    放到 256 留余量；这个值必须在 `TCPServer.__init__` 之前生效，只能靠子类属性。
    """

    request_queue_size = 256


def main() -> None:
    ap = argparse.ArgumentParser(description="调解台 · 基层矛盾纠纷调解模拟训练系统")
    ap.add_argument("--host", default=str(SERVER_CFG.get("host") or "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(SERVER_CFG.get("port") or 8770))
    args = ap.parse_args()

    httpd = GameServer((args.host, args.port), Handler)
    ip = lan_ip()
    print("=" * 62)
    print("  调解台 · 基层矛盾纠纷调解模拟训练系统")
    print("  教学演练 · 虚构案例 · 非真实警情")
    print("=" * 62)
    print(f"  本机访问   http://127.0.0.1:{args.port}/")
    print(f"  局域网访问 http://{ip}:{args.port}/")
    print(f"  版本探针   /__ver → build {BUILD_TS} · git {BUILD_GIT}")
    print(f"  登录保护   {'已启用（账号：%s）' % '、'.join(AUTH.user_names()) if AUTH.enabled else '未启用（没有 auth.local.json —— 本地裸跑用，公网部署务必配上）'}")
    print(f"  当前阶段   S1 骨架（业务接口未接入）")
    print("-" * 62)
    print("  Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
