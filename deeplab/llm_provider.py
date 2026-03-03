import json
import logging
import time
from dataclasses import dataclass
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

try:
    import httpx
except Exception:  # pragma: no cover - fallback for environments without httpx
    httpx = None
from google import genai
from google.genai import types as genai_types

from deeplab.runtime_settings import (
    DEFAULT_GOOGLE_GENAI_MODEL,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_OPENAI_BASE_URL,
    GOOGLE_API_KEY_ENV_KEYS,
    GOOGLE_BASE_URL_ENV_KEYS,
    GOOGLE_MODEL_ENV_KEYS,
    GOOGLE_THINKING_LEVEL_ENV_KEYS,
    LLM_PROVIDER_ENV_KEYS,
    OPENAI_API_KEY_ENV_KEYS,
    OPENAI_BASE_URL_ENV_KEYS,
    OPENAI_MODEL_ENV_KEYS,
    resolve_setting_value,
)

LLM_PROVIDER_GOOGLE = "google-genai"
LLM_PROVIDER_OPENAI_COMPATIBLE = "openai-compatible"
LLM_NETWORK_MAX_RETRIES = 3
LLM_NETWORK_RETRY_BASE_SECONDS = 1.0

logger = logging.getLogger(__name__)


class LLMNetworkError(RuntimeError):
    pass


@dataclass(slots=True)
class LLMRuntimeSettings:
    provider: str
    model: str
    api_key: str
    base_url: str | None
    google_thinking_level: str | None


def normalize_llm_provider(raw_value: str | None) -> str:
    value = (raw_value or DEFAULT_LLM_PROVIDER).strip().lower().replace("_", "-")
    if value in {"google", "google-genai"}:
        return LLM_PROVIDER_GOOGLE
    if value in {"openai", "openai-compatible", "openai-compat", "openai-api-compatible"}:
        return LLM_PROVIDER_OPENAI_COMPATIBLE
    raise ValueError(
        "llm_provider 仅支持 google-genai 或 openai-compatible。"
    )


def normalize_google_thinking_level(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None
    value = raw_value.strip().upper()
    if not value:
        return None
    allowed = {"MINIMAL", "LOW", "MEDIUM", "HIGH"}
    if value not in allowed:
        raise ValueError(
            "google_thinking_level 仅支持 minimal/low/medium/high，或留空。"
        )
    return value


async def get_llm_runtime_settings() -> LLMRuntimeSettings:
    provider_raw = await resolve_setting_value(
        key="llm_provider",
        env_keys=LLM_PROVIDER_ENV_KEYS,
        default=DEFAULT_LLM_PROVIDER,
    )
    provider = normalize_llm_provider(provider_raw)

    if provider == LLM_PROVIDER_GOOGLE:
        api_key = await resolve_setting_value(
            key="google_api_key",
            env_keys=GOOGLE_API_KEY_ENV_KEYS,
        )
        if not api_key:
            raise ValueError("缺少 Google GenAI API Key，请先在前端“系统设置”页面配置。")

        base_url = await resolve_setting_value(
            key="google_base_url",
            env_keys=GOOGLE_BASE_URL_ENV_KEYS,
        )

        model = await resolve_setting_value(
            key="google_model",
            env_keys=GOOGLE_MODEL_ENV_KEYS,
            default=DEFAULT_GOOGLE_GENAI_MODEL,
        )
        if not model:
            model = DEFAULT_GOOGLE_GENAI_MODEL

        thinking_level = normalize_google_thinking_level(
            await resolve_setting_value(
                key="google_thinking_level",
                env_keys=GOOGLE_THINKING_LEVEL_ENV_KEYS,
                default="",
            )
        )

        return LLMRuntimeSettings(
            provider=provider,
            model=model,
            api_key=api_key,
            base_url=base_url,
            google_thinking_level=thinking_level,
        )

    api_key = await resolve_setting_value(
        key="openai_api_key",
        env_keys=OPENAI_API_KEY_ENV_KEYS,
    )
    if not api_key:
        raise ValueError("缺少 OpenAI Compatible API Key，请先在前端“系统设置”页面配置。")

    base_url = await resolve_setting_value(
        key="openai_base_url",
        env_keys=OPENAI_BASE_URL_ENV_KEYS,
        default=DEFAULT_OPENAI_BASE_URL,
    )
    if not base_url:
        base_url = DEFAULT_OPENAI_BASE_URL

    model = await resolve_setting_value(
        key="openai_model",
        env_keys=OPENAI_MODEL_ENV_KEYS,
        default="",
    )
    if not model:
        raise ValueError("缺少 OpenAI Compatible Model，请先在前端“系统设置”页面配置。")

    return LLMRuntimeSettings(
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=base_url,
        google_thinking_level=None,
    )


def _response_to_dict(response: Any) -> dict[str, Any]:
    try:
        return json.loads(response.model_dump_json(exclude_none=False))
    except Exception:
        return response.model_dump(mode="json")


def _extract_openai_completion_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""

    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        return ""

    message = first_choice.get("message")
    if not isinstance(message, dict):
        return ""

    content = message.get("content")
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        text_chunks: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "text":
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                text_chunks.append(text)
        return "\n".join(text_chunks).strip()

    return ""


def _iter_exception_chain(exc: BaseException) -> list[BaseException]:
    chain: list[BaseException] = []
    seen: set[int] = set()
    current: BaseException | None = exc

    while current is not None and id(current) not in seen:
        chain.append(current)
        seen.add(id(current))
        next_exc = current.__cause__ or current.__context__
        current = next_exc if isinstance(next_exc, BaseException) else None

    return chain


def _is_network_related_exception(exc: Exception) -> bool:
    for current in _iter_exception_chain(exc):
        if isinstance(current, LLMNetworkError):
            return True
        if isinstance(current, (urllib_error.URLError, TimeoutError, ConnectionError)):
            return True
        if httpx is not None and isinstance(current, httpx.RequestError):
            return True
    return False


def _google_invoke_sync(
    *,
    settings: LLMRuntimeSettings,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    response_mime_type: str,
) -> tuple[str, dict[str, Any], int]:
    http_options = genai_types.HttpOptions(base_url=settings.base_url) if settings.base_url else None
    client = genai.Client(api_key=settings.api_key, http_options=http_options)
    started = time.perf_counter()
    try:
        config_kwargs: dict[str, Any] = {
            "system_instruction": system_prompt,
            "response_mime_type": response_mime_type,
            "temperature": temperature,
        }
        if settings.google_thinking_level:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(
                thinking_level=settings.google_thinking_level,
            )

        response = client.models.generate_content(
            model=settings.model,
            contents=user_prompt,
            config=genai_types.GenerateContentConfig(**config_kwargs),
        )
    finally:
        client.close()

    latency_ms = int((time.perf_counter() - started) * 1000)
    response_text = response.text or ""
    response_payload = _response_to_dict(response)
    return response_text, response_payload, latency_ms


def _openai_compatible_invoke_sync(
    *,
    settings: LLMRuntimeSettings,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
) -> tuple[str, dict[str, Any], int]:
    base_url = (settings.base_url or "").rstrip("/")
    if not base_url:
        raise ValueError("缺少 OpenAI Compatible Base URL，请先在前端“系统设置”页面配置。")
    url = f"{base_url}/chat/completions"

    payload = {
        "model": settings.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
    }

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib_request.Request(
        url=url,
        method="POST",
        data=body,
        headers={
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
        },
    )

    started = time.perf_counter()
    try:
        with urllib_request.urlopen(req, timeout=300) as response:
            raw_text = response.read().decode("utf-8")
    except urllib_error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            f"OpenAI compatible API 请求失败: POST {url}, status={exc.code}, body={err_body[:2000]}"
        ) from exc
    except urllib_error.URLError as exc:
        raise LLMNetworkError(f"OpenAI compatible API 网络请求失败: {exc}") from exc

    latency_ms = int((time.perf_counter() - started) * 1000)

    try:
        response_payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("OpenAI compatible API 返回了非 JSON 内容。") from exc

    response_text = _extract_openai_completion_text(response_payload)
    if not response_text:
        raise RuntimeError("OpenAI compatible API 返回为空。")

    return response_text, response_payload, latency_ms


def invoke_llm_sync(
    *,
    settings: LLMRuntimeSettings,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    response_mime_type: str,
) -> tuple[str, dict[str, Any], int]:
    last_exc: Exception | None = None
    total_attempts = LLM_NETWORK_MAX_RETRIES + 1
    for attempt in range(1, total_attempts + 1):
        try:
            if settings.provider == LLM_PROVIDER_GOOGLE:
                return _google_invoke_sync(
                    settings=settings,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=temperature,
                    response_mime_type=response_mime_type,
                )

            return _openai_compatible_invoke_sync(
                settings=settings,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature,
            )
        except Exception as exc:
            last_exc = exc
            if attempt >= total_attempts or not _is_network_related_exception(exc):
                raise
            retry_count = attempt
            sleep_seconds = LLM_NETWORK_RETRY_BASE_SECONDS * (2 ** (retry_count - 1))
            logger.warning(
                "LLM 网络请求失败，准备第 %s/%s 次重试，%.1f 秒后重试。错误: %s",
                retry_count,
                LLM_NETWORK_MAX_RETRIES,
                sleep_seconds,
                exc,
            )
            time.sleep(sleep_seconds)

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("LLM 请求重试失败，且未捕获到具体异常。")
