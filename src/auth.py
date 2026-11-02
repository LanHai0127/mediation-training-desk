#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""登录鉴权 —— 只用标准库，零依赖。

调解台 · 基层矛盾纠纷调解模拟训练系统 / 训练台登录闸。

设计要点（写给下一个改这个文件的人）：

  · **口令不落盘**。`auth.local.json` 里只存 `salt` + PBKDF2-HMAC-SHA256 的摘要，
    明文口令只存在于生成它的人手里。用 `tools/make_account.py` 生成/重置。
  · **会话在服务端内存里**。Cookie 只是一个随机 token，服务重启即全部失效
    （对"只开一个测试账号"的场景，这比持久化更安全也更简单）。
  · **回环豁免**：默认放行来自 127.0.0.0/8 的请求（整个回环段 —— 本机自测要用
    127.0.0.2/3 这类地址模拟"多个客户端"，见 tools/test_game.py 的限流一节）。
    线上服务只监听 127.0.0.1，外部一律经 nginx 反代进来，nginx 会把真实公网 IP
    写进 `X-Real-IP`，所以豁免只对本机自测和健康检查生效，公网访客拿不到。
    ⚠️ 豁免要求**两个条件同时成立**：来源 IP 是回环 **且 TCP 直连对端也是回环**
    （见 `Auth.exempt` 的表格）。第二条把"伪造 `X-Real-IP: 127.0.0.1` 冒充本机"这条路
    彻底堵死 —— 修之前，只要服务能被非回环地址直连，一个请求头就能免登录。
    仍然建议：**不要把服务绑到 0.0.0.0**；万一要绑，就把 `exemptLoopback` 关掉。
  · 失败尝试双闸限速：按**来源 IP**（挡同一台机器连点 10 次/10 分钟）+ 按**账号**
    （挡"换一堆 IP 各试几次"的慢速爆破，20 次/10 分钟）。
  · **失败计数落盘**（`auth.state.json`）：以前只在内存里，服务重启即清零 ——
    攻击者只要等到重启（或故意打崩进程）就能重新拿到满额尝试次数。现在计数会持久化，
    重启后仍在窗口内的失败照旧算数；同时**锁定时往 stderr 打一行告警**
    （线上 systemd 会收进 journal，`journalctl -u mediation-bench | grep 限速` 就能看见）。
    ⚠️ 这个文件是**运行态而且可能包含攻击者提交的用户名**，别提交、别打包、别让它可被 HTTP 取到。
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import sys
import threading
import time
from pathlib import Path
from typing import Any

CONF_NAME = "auth.local.json"
STATE_NAME = "auth.state.json"
COOKIE_NAME = "tjt_session"
ITERATIONS = 120_000          # PBKDF2 轮数：约 60~120ms/次，登录时一次，够用
FAIL_WINDOW = 600.0           # 失败计数窗口：10 分钟
FAIL_LIMIT = 10               # 窗口内最多失败几次（**按 IP**）
USER_FAIL_LIMIT = 20          # 窗口内同一账号最多失败几次（**按账号**）——
# 只按 IP 计数挡不住"换 IP 爆破同一个账号"：攻击者拿 100 个 IP 各试 9 次，
# per-IP 永远不触发。账号维度这条是补这个洞（阈值放宽些，避免误伤手滑的正常用户）。
SAVE_INTERVAL = 2.0           # 落盘节流：最多 2 秒写一次（防"失败洪流 → 磁盘写洪流"）


def is_loopback(ip: str) -> bool:
    """整个 127.0.0.0/8 都算回环 —— 让本机自测能用 127.0.0.2/3 模拟"多个客户端"。

    注意空串**不算**：拿不到来源时按最保守处理（要求登录），别让"未知"变成"免检"。
    """
    if not ip:
        return False
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False   # 主机名之类的一律不认，只认字面 IP


def _as_window_ts(value: Any, now: float) -> float | None:
    """把落盘里的一个时间戳收成"仍在窗口内"的 float；不合法或已过期一律 None。

    落盘文件是**外部输入**（可能是旧版本写的、可能被人手改过），所以逐个值都做类型与范围校验，
    别让一个 `"abc"` 或 `null` 把整个加载过程炸掉。
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    ts = float(value)
    if ts <= 0 or now - ts >= FAIL_WINDOW:
        return None
    return ts



class Auth:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        # TJ_AUTH_CONF 可指定另一份账号文件：自测时起临时实例就用它，
        # 免得测试去动项目里那份真实配置。
        override = os.environ.get("TJ_AUTH_CONF")
        self.conf_path = Path(override) if override else (self.root / CONF_NAME)
        # TJ_AUTH_STATE 同理：自测时把运行态指到临时目录，绝不碰项目里那份。
        state_override = os.environ.get("TJ_AUTH_STATE")
        self.state_path = Path(state_override) if state_override else (self.root / STATE_NAME)
        self._lock = threading.Lock()
        self._sessions: dict[str, dict[str, Any]] = {}
        self._fails: dict[str, list[float]] = {}
        self._user_fails: dict[str, list[float]] = {}   # 按账号（小写）计失败，见 USER_FAIL_LIMIT
        self._alerted_ips: set[str] = set()             # 已就"锁定"告警过的 IP（防日志洪水）
        self._alerted_users: set[str] = set()
        self._last_save = 0.0
        self._dirty = False            # 被节流跳过过写盘 → 下次请求补上，别让它一直停在旧值
        self._raw: dict[str, Any] = {}
        self._users: dict[str, dict[str, Any]] = {}
        self._dummy_salt = b"mediation-bench-dummy-salt"
        self.reload()
        self._load_state()

    # ------------------------------------------------------------ 配置
    def reload(self) -> None:
        raw: dict[str, Any] = {}
        if self.conf_path.is_file():
            try:
                raw = json.loads(self.conf_path.read_text(encoding="utf-8")) or {}
            except (OSError, json.JSONDecodeError):
                raw = {}
        self._raw = raw
        users = {}
        for u in raw.get("users") or []:
            name = str(u.get("name") or "").strip()
            if name and u.get("hash") and u.get("salt"):
                users[name] = {"salt": str(u["salt"]), "hash": str(u["hash"]),
                               "note": str(u.get("note") or "")}
        self._users = users
        self.ttl = float(raw.get("sessionTtlHours") or 12) * 3600.0
        self.fail_limit = int(raw.get("failLimitPer10Min") or FAIL_LIMIT)
        self.user_fail_limit = int(raw.get("failLimitPerUserPer10Min") or USER_FAIL_LIMIT)
        self.exempt_loopback = bool(raw.get("exemptLoopback", True))
        self.iterations = int(raw.get("iterations") or ITERATIONS)

    @property
    def enabled(self) -> bool:
        """没有配置账号时不拦（本地裸跑、评审前的自测都靠这个）。"""
        return bool(self._users)

    def user_names(self) -> list[str]:
        return sorted(self._users)

    # ------------------------------------------------- 失败计数落盘 / 告警
    # 以前失败计数只在内存里：服务重启即清零 → 等一次重启（或故意打崩进程）就又是满额尝试。
    # 计数不是审计账本，是**速率限制**，所以取舍是"够用就好"：节流写盘 + 过期即丢 + 坏了就重来，
    # 绝不因为文件有问题而让登录接口挂掉。
    def _load_state(self) -> None:
        """恢复窗口内的失败计数（文件缺失/损坏/结构不对都静默降级成从零开始）。"""
        raw: Any = {}
        if self.state_path.is_file():
            try:
                raw = json.loads(self.state_path.read_text(encoding="utf-8")) or {}
            except (OSError, json.JSONDecodeError):
                raw = {}
        if not isinstance(raw, dict):
            raw = {}
        now = time.time()
        self._fails = self._load_rows(raw.get("ipFails"), now)
        self._user_fails = self._load_rows(raw.get("userFails"), now)

    @staticmethod
    def _load_rows(obj: Any, now: float) -> dict[str, list[float]]:
        """只收窗口内的历史；**过期条目一律丢掉** —— 否则"上次锁到一半"会变成"这次一上来就锁"。"""
        out: dict[str, list[float]] = {}
        if not isinstance(obj, dict):
            return out
        for k, v in obj.items():
            if not isinstance(v, list):
                continue
            rows = sorted(t for t in (_as_window_ts(x, now) for x in v) if t is not None)
            if rows:
                out[str(k)] = rows
        return out

    def _save(self, force: bool = False) -> None:
        """原子落盘 + 节流。

        节流是必要的：失败是**攻击者可控的输入**，每次失败都写盘等于把磁盘当成放大器。
        2 秒一次够用；但**某个 key 刚被锁**、或**登录成功清了计数**要 force 立刻落盘。

        被节流跳过时置 `_dirty`：由 `throttled*`（每次登录尝试都会调）负责补写 ——
        否则被跳过的那半截更新可能一直停在磁盘上的旧值（我第一次手测就撞到：
        `ipFails` 写进去了、同一秒里的 `userFails` 被吞掉，文件里少一半）。
        """
        now = time.time()
        if not force and now - self._last_save < SAVE_INTERVAL:
            self._dirty = True
            return
        self._last_save = now
        self._dirty = False
        payload = {"note": "失败计数运行态（自动生成，可删）；窗口 %.0f 秒" % FAIL_WINDOW,
                   "saved": time.strftime("%Y-%m-%d %H:%M:%S"),
                   "ipFails": self._fails, "userFails": self._user_fails}
        tmp = self.state_path.with_name(self.state_path.name + ".tmp")
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.state_path)      # 原子替换：读的人永远看不到半个 JSON
            try:
                os.chmod(self.state_path, 0o600)  # 里面可能存着攻击者提交的用户名
            except OSError:
                pass
        except OSError:
            pass    # 盘写不了不该让登录接口 500

    def _alert(self, kind: str, key: str, wait: float) -> None:
        """锁定事件告警：**只在状态跃迁时打一行**（否则每个被拒请求一行 = 日志洪水）。

        线上由 systemd 收进 journal：`journalctl -u mediation-bench | grep 限速`
        """
        bucket = self._alerted_ips if kind == "ip" else self._alerted_users
        if key in bucket:
            return
        bucket.add(key)
        print("[限速] %s %s 触发失败上限，已挡 %.0fs（窗口 %.0f 分钟）"
              % ("来源 IP" if kind == "ip" else "账号", key, wait, FAIL_WINDOW / 60),
              file=sys.stderr, flush=True)

    def fail_state(self) -> dict[str, Any]:
        """当前被限速的 key（给探活/运维看；只有 IP 与**提交过的用户名**，不含口令）。"""
        now = time.time()
        with self._lock:
            ip_locked = sorted(k for k, v in self._fails.items()
                               if self.fail_limit and v and len(v) >= self.fail_limit
                               and now - v[0] < FAIL_WINDOW)
            user_locked = sorted(k for k, v in self._user_fails.items()
                                 if self.user_fail_limit and v and len(v) >= self.user_fail_limit
                                 and now - v[0] < FAIL_WINDOW)
            return {"stateFile": self.state_path.name,
                    "ipFailKeys": len(self._fails), "userFailKeys": len(self._user_fails),
                    "ipLocked": ip_locked, "userLocked": user_locked}

    # ------------------------------------------------------------ 口令
    def _digest(self, password: str, salt: str) -> str:
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                 salt.encode("utf-8"), self.iterations)
        return dk.hex()

    def make_account(self, name: str, password: str) -> dict[str, str]:
        """生成一条账号记录（salt + hash），供 make_account.py 写盘。"""
        salt = secrets.token_hex(16)
        return {"name": name, "salt": salt, "hash": self._digest(password, salt),
                "created": time.strftime("%Y-%m-%d %H:%M:%S")}

    def verify(self, name: str, password: str) -> bool:
        user = self._users.get((name or "").strip())
        given = password or ""
        if not user:
            # 用户名不存在时也走一遍哈希：别让"响应更快"暴露出哪些账号存在
            self._digest(given, self._dummy_salt.hex())
            return False
        return hmac.compare_digest(self._digest(given, user["salt"]), user["hash"])

    # ------------------------------------------------------------ 会话
    def open(self, name: str) -> tuple[str, float]:
        """开一个会话，返回 (token, 有效秒数)。"""
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._lock:
            self._sessions[token] = {"user": name, "exp": now + self.ttl}
            if len(self._sessions) > 2000:
                self._sessions = {k: v for k, v in self._sessions.items() if v["exp"] > now}
        return token, self.ttl

    def check(self, token: str) -> str | None:
        """校验会话；临近过期时滑动续期（用得多就不会中途掉线）。"""
        if not token:
            return None
        now = time.time()
        with self._lock:
            row = self._sessions.get(token)
            if not row:
                return None
            if row["exp"] <= now:
                del self._sessions[token]
                return None
            if row["exp"] - now < self.ttl * 0.5:
                row["exp"] = now + self.ttl
            return str(row["user"])

    def revoke(self, token: str) -> None:
        if not token:
            return
        with self._lock:
            self._sessions.pop(token, None)

    def active_sessions(self) -> int:
        now = time.time()
        with self._lock:
            return sum(1 for v in self._sessions.values() if v["exp"] > now)

    # ------------------------------------------------------------ 豁免 / 限速
    def exempt(self, ip: str, peer: str | None = None) -> bool:
        """是否免登录。

        · `ip`   = `_client_ip()` 的结果（优先 X-Real-IP，其次 XFF，最后 socket 源地址）
        · `peer` = **TCP 直连对端地址**（`client_address`），不可伪造

        安全性来自部署形态：线上服务只监听 127.0.0.1，外部一律经 nginx 反代进来，
        而 nginx 用 `$remote_addr` 覆盖 X-Real-IP —— 公网访客拿到的永远是自己那个公网 IP，
        伪造的头在 nginx 那一跳就被替换掉了。

        **为什么还要看 `peer`**：`_client_ip()` 是可以被请求头左右的。假设哪天把服务绑到
        0.0.0.0（或被同网段机器直连 127.0.0.1:8770 之外的可达地址），任何人在请求里塞一句
        `X-Real-IP: 127.0.0.1` 就能冒充回环、绕过登录。加上"直连对端也必须是回环"这一条后，
        伪造头在**非回环对端**下彻底无效，而本机 curl / 自测 / nginx 反代三条既有路径行为不变：

        | 场景 | peer | _client_ip() | 结果 |
        |---|---|---|---|
        | 本机 curl 探活 | 127.0.0.1 | 127.0.0.1 | 豁免 ✅ |
        | 公网 → nginx → 服务 | 127.0.0.1 | 访客公网 IP | 不豁免 ✅ |
        | 伪造头直连服务 | 公网/内网 IP | 127.0.0.1（伪造） | **不豁免** ✅（修复前会被放过）|
        """
        if not self.enabled:
            return True
        if not (self.exempt_loopback and is_loopback(ip)):
            return False
        # peer 拿不到时（极端情况）按最保守处理：不放行
        return peer is not None and is_loopback(peer)

    def throttled(self, ip: str) -> float:
        """被拦时返回还要等多少秒，0 表示放行。"""
        now = time.time()
        with self._lock:
            if self._dirty:       # 上次节流跳过的更新，趁这次请求补上
                self._save()
            rows = [t for t in self._fails.get(ip, []) if now - t < FAIL_WINDOW]
            if rows:
                self._fails[ip] = rows
            else:
                self._fails.pop(ip, None)      # 窗口内没记录了就整条丢掉，别让 dict 无限长
                self._alerted_ips.discard(ip)  # 解锁 → 下次再锁要重新告警（按"次"计）
            if self.fail_limit and len(rows) >= self.fail_limit:
                wait = max(1.0, FAIL_WINDOW - (now - rows[0]))
                self._alert("ip", ip, wait)
                self._save(force=True)
                return wait
            return 0.0

    def note_login_fail(self, ip: str, name: str = "") -> None:
        """记一次登录失败：**IP 与账号一起记、只落一次盘**。

        为什么要合成一个方法：分开记两次会各写一次盘，而写盘有 2 秒节流 ——
        同一秒里的第二次更新会被跳过，于是磁盘上可能只有 `ipFails` 没有 `userFails`
        （我第一次手测就撞到，文件里少一半）。合成之后"一次失败 = 一次完整快照"。
        """
        now = time.time()
        key = (name or "").strip().lower()
        with self._lock:
            ip_locked = False
            if ip:
                rows = [t for t in self._fails.get(ip, []) if now - t < FAIL_WINDOW]
                rows.append(now)
                self._fails[ip] = rows
                if len(self._fails) > 5000:
                    self._fails = {k: v for k, v in self._fails.items()
                                   if v and v[-1] > now - FAIL_WINDOW}
                ip_locked = bool(self.fail_limit) and len(rows) == self.fail_limit
                if ip_locked:
                    self._alert("ip", ip, FAIL_WINDOW)

            user_locked = False
            if key:
                urows = [t for t in self._user_fails.get(key, []) if now - t < FAIL_WINDOW]
                urows.append(now)
                self._user_fails[key] = urows
                if len(self._user_fails) > 1000:
                    self._user_fails = {k: v for k, v in self._user_fails.items()
                                        if v and v[-1] > now - FAIL_WINDOW}
                user_locked = bool(self.user_fail_limit) and len(urows) == self.user_fail_limit
                if user_locked:
                    self._alert("user", key, FAIL_WINDOW)

            # 刚踩线的立刻落盘；平时走节流（失败是攻击者可控的输入，别让磁盘当放大器）
            self._save(force=ip_locked or user_locked)

    # 兼容旧调用（=只记一边）。**新代码一律用 note_login_fail** —— 分开调会各写一次盘，
    # 被节流吞掉后磁盘上就只剩一半（见上面那段注释）。
    def note_fail(self, ip: str) -> None:
        self.note_login_fail(ip, "")

    def clear_fails(self, ip: str) -> None:
        with self._lock:
            self._fails.pop(ip, None)
            self._alerted_ips.discard(ip)
            self._save(force=True)             # 登录成功即清 —— 这个状态更要及时落盘

    # ------------------------------------------------- 失败计数（按账号）
    # 为什么还要一套：per-IP 闸只认来源地址，攻击者换 IP 就绕过了。
    # 账号闸按**提交的用户名**计数（不区分账号是否存在，所以不泄漏"哪个账号真实存在"），
    # 这样"100 个 IP 各试 9 次"的慢速爆破会在这里撞墙。
    # 代价：攻击者可以故意刷错口令把这个账号锁 10 分钟（DoS）。权衡下来选"宁可锁一会儿"——
    # 阈值放到 20 次，正常人手滑撞不到。
    def throttled_user(self, name: str) -> float:
        """按账号被限速时返回还要等多少秒，0 表示放行。"""
        key = (name or "").strip().lower()
        if not key or not self.user_fail_limit:
            return 0.0
        now = time.time()
        with self._lock:
            if self._dirty:       # 被节流跳过的那次更新，趁这次请求补写掉
                self._save()
            rows = [t for t in self._user_fails.get(key, []) if now - t < FAIL_WINDOW]
            if rows:
                self._user_fails[key] = rows
            else:
                self._user_fails.pop(key, None)
                self._alerted_users.discard(key)
            if len(rows) >= self.user_fail_limit:
                wait = max(1.0, FAIL_WINDOW - (now - rows[0]))
                self._alert("user", key, wait)
                self._save(force=True)
                return wait
            return 0.0

    def note_user_fail(self, name: str) -> None:
        self.note_login_fail("", name)

    def clear_user_fails(self, name: str) -> None:
        """登录成功就清空 —— 否则手滑几次会一直攒着，下次差一次就被关在门外。"""
        key = (name or "").strip().lower()
        with self._lock:
            self._user_fails.pop(key, None)
            self._alerted_users.discard(key)
            self._save(force=True)

    # ------------------------------------------------------------ Cookie
    def cookie_header(self, token: str, secure: bool) -> str:
        parts = ["%s=%s" % (COOKIE_NAME, token), "Path=/", "HttpOnly", "SameSite=Lax",
                 "Max-Age=%d" % int(self.ttl)]
        if secure:
            parts.append("Secure")
        return "; ".join(parts)

    def clear_cookie_header(self, secure: bool) -> str:
        parts = ["%s=" % COOKIE_NAME, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"]
        if secure:
            parts.append("Secure")
        return "; ".join(parts)

    @staticmethod
    def cookie_from(raw_cookie: str, name: str = COOKIE_NAME) -> str:
        for part in (raw_cookie or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v.strip()
        return ""
