"""
services/llm_provider.py
ローカル LLM プロバイダへの呼び出しを抽象化する。
現時点では Ollama と OpenAI 互換 API（llama-server 想定）に対応する。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal, Optional

import httpx

LLMProviderName = Literal["ollama", "openai_compatible"]

DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "qwen3:4b"

# 配布版では llama.cpp / llama-server を想定する。
# モデル ID は sidecar 起動時の alias に合わせて差し替えられるよう環境変数で上書き可能にする。
DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "http://127.0.0.1:8080/v1"
DEFAULT_OPENAI_COMPATIBLE_MODEL = "qwen3-4b"

DEFAULT_LLM_PROVIDER: LLMProviderName = "ollama"


@dataclass(frozen=True)
class LLMSettings:
    provider: LLMProviderName
    base_url: str
    model: str
    api_key: Optional[str] = None


def _normalize_provider(value: str) -> LLMProviderName:
    normalized = (value or "").strip().lower()
    if normalized in {"openai", "openai_compatible", "llama_cpp", "llama-server"}:
        return "openai_compatible"
    return "ollama"


def _get_env(name: str) -> Optional[str]:
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def get_llm_settings() -> LLMSettings:
    provider = _normalize_provider(
        os.getenv("LOCAL_MINUTES_LLM_PROVIDER", DEFAULT_LLM_PROVIDER)
    )

    if provider == "openai_compatible":
        return LLMSettings(
            provider=provider,
            base_url=_get_env("LOCAL_MINUTES_LLM_BASE_URL")
            or DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
            model=_get_env("LOCAL_MINUTES_LLM_MODEL")
            or DEFAULT_OPENAI_COMPATIBLE_MODEL,
            api_key=_get_env("LOCAL_MINUTES_LLM_API_KEY"),
        )

    return LLMSettings(
        provider="ollama",
        base_url=_get_env("LOCAL_MINUTES_LLM_BASE_URL") or DEFAULT_OLLAMA_BASE_URL,
        model=_get_env("LOCAL_MINUTES_LLM_MODEL") or DEFAULT_OLLAMA_MODEL,
        api_key=None,
    )


def get_default_llm_model() -> str:
    return get_llm_settings().model


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _model_matches(candidate: str, target: str) -> bool:
    candidate_normalized = candidate.strip().lower()
    target_normalized = target.strip().lower()
    return (
        candidate_normalized == target_normalized
        or target_normalized in candidate_normalized
    )


def call_llm(
    prompt: str,
    model: Optional[str],
    system_prompt: str,
) -> str:
    settings = get_llm_settings()
    selected_model = model or settings.model

    if settings.provider == "openai_compatible":
        return _call_openai_compatible(
            base_url=settings.base_url,
            model=selected_model,
            system_prompt=system_prompt,
            prompt=prompt,
            api_key=settings.api_key,
        )

    return _call_ollama(
        base_url=settings.base_url,
        model=selected_model,
        system_prompt=system_prompt,
        prompt=prompt,
    )


def _call_ollama(
    *,
    base_url: str,
    model: str,
    system_prompt: str,
    prompt: str,
) -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "system": system_prompt,
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": 2048,
        },
    }

    try:
        with httpx.Client(timeout=300.0) as client:
            response = client.post(_join_url(base_url, "/api/generate"), json=payload)
            response.raise_for_status()
            data = response.json()
            return data.get("response", "").strip()
    except httpx.ConnectError as exc:
        raise RuntimeError(
            "LLM ランタイムに接続できません。"
            "Ollama または同梱ランタイムが起動しているか確認してください。"
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"LLM API エラー: {exc.response.status_code} / {exc.response.text[:200]}"
        ) from exc
    except Exception as exc:
        raise RuntimeError(f"LLM 呼び出しエラー: {exc}") from exc


def _call_openai_compatible(
    *,
    base_url: str,
    model: str,
    system_prompt: str,
    prompt: str,
    api_key: Optional[str],
) -> str:
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "top_p": 0.8,
        "presence_penalty": 1.5,
        "max_tokens": 2048,
        "stream": False,
    }

    try:
        with httpx.Client(timeout=300.0, headers=headers) as client:
            response = client.post(
                _join_url(base_url, "/chat/completions"),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError("応答に choices がありません。")

            message = choices[0].get("message") or {}
            content = message.get("content")
            if isinstance(content, str):
                return content.strip()

            if isinstance(content, list):
                text_parts = [
                    item.get("text", "")
                    for item in content
                    if isinstance(item, dict) and item.get("type") == "text"
                ]
                return "\n".join(part for part in text_parts if part).strip()

            raise RuntimeError("応答本文の形式が不正です。")
    except httpx.ConnectError as exc:
        raise RuntimeError(
            "LLM ランタイムに接続できません。"
            "同梱の llama.cpp ランタイムが起動しているか確認してください。"
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"LLM API エラー: {exc.response.status_code} / {exc.response.text[:200]}"
        ) from exc
    except Exception as exc:
        raise RuntimeError(f"LLM 呼び出しエラー: {exc}") from exc


async def check_llm_availability(model: Optional[str] = None) -> dict:
    settings = get_llm_settings()
    selected_model = model or settings.model

    if settings.provider == "openai_compatible":
        return await _check_openai_compatible_availability(settings, selected_model)

    return await _check_ollama_availability(settings, selected_model)


async def _check_ollama_availability(settings: LLMSettings, model: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(_join_url(settings.base_url, "/api/tags"))
            response.raise_for_status()
            data = response.json()
            models = [item["name"] for item in data.get("models", []) if "name" in item]
            model_available = any(_model_matches(item, model) for item in models)
            return {
                "provider": settings.provider,
                "base_url": settings.base_url,
                "configured_model": model,
                "available": True,
                "model_loaded": model_available,
                "available_models": models,
                "message": "Ollama は正常に動作しています" if model_available
                else f"モデル '{model}' が見つかりません。",
            }
    except Exception as exc:
        return {
            "provider": settings.provider,
            "base_url": settings.base_url,
            "configured_model": model,
            "available": False,
            "model_loaded": False,
            "available_models": [],
            "message": f"Ollama に接続できません: {exc}",
        }


async def _check_openai_compatible_availability(settings: LLMSettings, model: str) -> dict:
    headers = {}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"

    try:
        async with httpx.AsyncClient(timeout=5.0, headers=headers) as client:
            response = await client.get(_join_url(settings.base_url, "/models"))
            response.raise_for_status()
            data = response.json()
            models = [
                item["id"]
                for item in data.get("data", [])
                if isinstance(item, dict) and "id" in item
            ]
            model_available = not models or any(_model_matches(item, model) for item in models)
            return {
                "provider": settings.provider,
                "base_url": settings.base_url,
                "configured_model": model,
                "available": True,
                "model_loaded": model_available,
                "available_models": models,
                "message": "OpenAI 互換 LLM ランタイムは正常に動作しています"
                if model_available
                else f"モデル '{model}' が起動済みランタイムに見つかりません。",
            }
    except Exception as exc:
        return {
            "provider": settings.provider,
            "base_url": settings.base_url,
            "configured_model": model,
            "available": False,
            "model_loaded": False,
            "available_models": [],
            "message": f"OpenAI 互換 LLM ランタイムに接続できません: {exc}",
        }
