#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""模型调用层 —— 只用标准库，兼容 OpenAI 格式的 /chat/completions。

原则（写死在这里，改之前先想清楚后果）：
  · **调用失败一律返回 None，绝不抛异常给上层**。对话层拿到 None 就走剧本台词，
    功能不中断 —— 拔掉网络、key 过期、接口 502，训练台都必须还能走完一个案子。
  · 密钥只从环境变量或 config.local.json 读，**不进代码、不进版本库、不写日志**。
  · 超时给足 10 秒但不多给：现场演示时宁可一句话呆板，也不要卡住不动。
"""
from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.request
from typing import Any

DEFAULT_BASE = "https://api.deepseek.com/v1"
DEFAULT_MODEL = "deepseek-chat"


class LLMClient:
    def __init__(self, base_url: str = "", key: str = "", model: str = "",
                 timeout: float = 10.0) -> None:
        self.base_url = (base_url or DEFAULT_BASE).rstrip("/")
        self.key = key or ""
        self.model = model or DEFAULT_MODEL
        self.timeout = timeout
        # 本机有代理环境变量时，访问 127.0.0.1 的本地模型要绕开；访问公网则要沿用。
        self._opener = urllib.request.build_opener()
        self.last_error = ""
        self.calls = 0

    # ------------------------------------------------------------ 构造
    @classmethod
    def from_project(cls, root, config: dict[str, Any] | None = None) -> "LLMClient":
        cfg = (config or {}).get("llm") or {}
        key = os.environ.get("TJ_LLM_KEY") or str(cfg.get("key") or "")
        base = os.environ.get("TJ_LLM_BASE") or str(cfg.get("baseUrl") or DEFAULT_BASE)
        model = os.environ.get("TJ_LLM_MODEL") or str(cfg.get("model") or DEFAULT_MODEL)
        timeout = float(os.environ.get("TJ_LLM_TIMEOUT") or cfg.get("timeout") or 10.0)
        client = cls(base, key, model, timeout)
        if client.base_url.startswith("http://127.0.0.1") or client.base_url.startswith("http://localhost"):
            client._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        return client

    @property
    def enabled(self) -> bool:
        """没有密钥就是离线模式，不是错误。"""
        return bool(self.key)

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "model": self.model,
            "base": self.base_url,
            "calls": self.calls,
            "lastError": self.last_error,
        }

    # ------------------------------------------------------------ 调用
    def chat(self, messages: list[dict[str, str]], temperature: float = 0.85,
             max_tokens: int = 220) -> str | None:
        """返回模型文本；任何异常都返回 None（上层据此降级）。"""
        if not self.enabled:
            return None
        body = json.dumps({
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + self.key},
            method="POST",
        )
        self.calls += 1
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            text = text.strip()
            if not text:
                self.last_error = "空回复"
                return None
            return text
        except urllib.error.HTTPError as exc:
            # 只记状态码，不记响应体 —— 响应体里可能带密钥相关的提示
            self.last_error = "HTTP %s" % exc.code
            return None
        except (urllib.error.URLError, socket.timeout, TimeoutError, ValueError, OSError) as exc:
            self.last_error = "%s: %s" % (type(exc).__name__, exc)
            return None

    def ping(self) -> str:
        """最小代价探活：一句话问答。失败返回空串。"""
        return self.chat([{"role": "user", "content": "回两个字：在线"}], temperature=0,
                         max_tokens=8) or ""
