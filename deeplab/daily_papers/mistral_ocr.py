import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, NamedTuple
from urllib import error as urllib_error
from urllib import request as urllib_request

DEFAULT_MISTRAL_BASE_URL = "https://api.mistral.ai"
DEFAULT_MISTRAL_OCR_MODEL = "mistral-ocr-latest"
DEFAULT_MISTRAL_TIMEOUT_SECONDS = 180
DEFAULT_MISTRAL_RETRY_MAX_ATTEMPTS = 4
DEFAULT_MISTRAL_RETRY_BASE_SECONDS = 1.0


class MistralAPIError(RuntimeError):
    def __init__(
        self,
        *,
        method: str,
        url: str,
        status_code: int | None = None,
        body: str | None = None,
        message: str | None = None,
    ) -> None:
        self.method = method
        self.url = url
        self.status_code = status_code
        self.body = body or ""
        detail = message or (
            f"Mistral API 请求失败: {method} {url}, "
            f"status={status_code}, body={self.body[:1000] or '<empty-body>'}"
        )
        super().__init__(detail)


def _is_retryable_error(exc: Exception) -> bool:
    if not isinstance(exc, MistralAPIError):
        return False
    if exc.status_code is None:
        return True
    return exc.status_code == 429 or 500 <= exc.status_code < 600


def _request_json_with_retry(
    *,
    method: str,
    url: str,
    api_key: str,
    payload: dict[str, Any] | None = None,
    timeout: int = DEFAULT_MISTRAL_TIMEOUT_SECONDS,
    max_attempts: int = DEFAULT_MISTRAL_RETRY_MAX_ATTEMPTS,
) -> dict[str, Any]:
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return _request_json(
                method=method,
                url=url,
                api_key=api_key,
                payload=payload,
                timeout=timeout,
            )
        except Exception as exc:
            last_exc = exc
            if attempt >= max_attempts or not _is_retryable_error(exc):
                raise
            sleep_seconds = DEFAULT_MISTRAL_RETRY_BASE_SECONDS * (2 ** (attempt - 1))
            time.sleep(sleep_seconds)

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("Mistral API 重试失败，且未捕获到具体异常。")


class MistralOCRSettings(NamedTuple):
    api_key: str
    base_url: str
    model: str


def _first_nonempty_env(*keys: str) -> str | None:
    for key in keys:
        value = os.getenv(key)
        if value and value.strip():
            return value.strip()
    return None


def get_mistral_ocr_settings() -> MistralOCRSettings:
    api_key = _first_nonempty_env(
        "mistral_api_key",
        "MISTRAL_API_KEY",
        "MISTRAL_KEY",
        "MISTRAL_OCR_API_KEY",
    )
    if not api_key:
        raise ValueError(
            "缺少 Mistral OCR API Key，请设置 mistral_api_key 或 MISTRAL_API_KEY。"
        )

    base_url = (
        _first_nonempty_env("mistral_base_url", "MISTRAL_BASE_URL")
        or DEFAULT_MISTRAL_BASE_URL
    )
    model = (
        _first_nonempty_env("mistral_ocr_model", "MISTRAL_OCR_MODEL")
        or DEFAULT_MISTRAL_OCR_MODEL
    )
    return MistralOCRSettings(
        api_key=api_key,
        base_url=base_url.rstrip("/"),
        model=model,
    )


def _request_json(
    *,
    method: str,
    url: str,
    api_key: str,
    payload: dict[str, Any] | None = None,
    timeout: int = DEFAULT_MISTRAL_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"

    req = urllib_request.Request(url=url, method=method, headers=headers, data=data)
    try:
        with urllib_request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib_error.HTTPError as exc:
        body = ""
        if exc.fp is not None:
            body = exc.read().decode("utf-8", errors="replace")
        message = body[:1000] if body else "<empty-body>"
        raise MistralAPIError(
            method=method,
            url=url,
            status_code=exc.code,
            body=message,
        ) from exc
    except urllib_error.URLError as exc:
        raise MistralAPIError(
            method=method,
            url=url,
            status_code=None,
            message=f"Mistral API 网络请求失败: {method} {url}, reason={exc.reason}",
        ) from exc

    if not body.strip():
        return {}

    try:
        data_obj = json.loads(body)
    except json.JSONDecodeError as exc:
        raise MistralAPIError(
            method=method,
            url=url,
            status_code=None,
            body=body[:1000],
            message=f"Mistral API 返回非 JSON 响应: {url}",
        ) from exc

    if not isinstance(data_obj, dict):
        raise MistralAPIError(
            method=method,
            url=url,
            status_code=None,
            body=body[:1000],
            message=f"Mistral API 返回结构异常: {url}",
        )
    return data_obj


def _build_multipart_body(
    *,
    purpose: str,
    pdf_path: Path,
    mime_type: str = "application/pdf",
) -> tuple[bytes, str]:
    boundary = f"----DeepLabBoundary{uuid.uuid4().hex}"
    line_break = b"\r\n"

    body = bytearray()
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="purpose"\r\n\r\n')
    body.extend(purpose.encode("utf-8"))
    body.extend(line_break)

    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(
        (
            f'Content-Disposition: form-data; name="file"; filename="{pdf_path.name}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode("utf-8")
    )
    body.extend(pdf_path.read_bytes())
    body.extend(line_break)

    body.extend(f"--{boundary}--\r\n".encode("utf-8"))
    return bytes(body), boundary


def _upload_pdf_for_ocr(
    *,
    settings: MistralOCRSettings,
    pdf_path: Path,
) -> str:
    body, boundary = _build_multipart_body(purpose="ocr", pdf_path=pdf_path)
    headers = {
        "Authorization": f"Bearer {settings.api_key}",
        "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    last_exc: Exception | None = None
    for attempt in range(1, DEFAULT_MISTRAL_RETRY_MAX_ATTEMPTS + 1):
        req = urllib_request.Request(
            url=f"{settings.base_url}/v1/files",
            method="POST",
            headers=headers,
            data=body,
        )
        try:
            with urllib_request.urlopen(req, timeout=DEFAULT_MISTRAL_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))
            file_id = str(payload.get("id", "")).strip() if isinstance(payload, dict) else ""
            if not file_id:
                raise RuntimeError("Mistral 文件上传成功但未返回 file id。")
            return file_id
        except urllib_error.HTTPError as exc:
            body_text = ""
            if exc.fp is not None:
                body_text = exc.read().decode("utf-8", errors="replace")
            err = MistralAPIError(
                method="POST",
                url=f"{settings.base_url}/v1/files",
                status_code=exc.code,
                body=body_text[:1000] if body_text else "<empty-body>",
            )
            last_exc = err
            if attempt >= DEFAULT_MISTRAL_RETRY_MAX_ATTEMPTS or not _is_retryable_error(err):
                raise err from exc
            sleep_seconds = DEFAULT_MISTRAL_RETRY_BASE_SECONDS * (2 ** (attempt - 1))
            time.sleep(sleep_seconds)
        except urllib_error.URLError as exc:
            err = MistralAPIError(
                method="POST",
                url=f"{settings.base_url}/v1/files",
                status_code=None,
                message=f"Mistral 文件上传网络失败: reason={exc.reason}",
            )
            last_exc = err
            if attempt >= DEFAULT_MISTRAL_RETRY_MAX_ATTEMPTS:
                raise err from exc
            sleep_seconds = DEFAULT_MISTRAL_RETRY_BASE_SECONDS * (2 ** (attempt - 1))
            time.sleep(sleep_seconds)

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("Mistral 文件上传失败，且未捕获到具体异常。")


def _get_signed_file_url(*, settings: MistralOCRSettings, file_id: str) -> str:
    data = _request_json_with_retry(
        method="GET",
        url=f"{settings.base_url}/v1/files/{file_id}/url",
        api_key=settings.api_key,
        payload=None,
    )
    signed_url = str(data.get("url", "")).strip()
    if not signed_url:
        raise RuntimeError("获取 Mistral 文件签名 URL 失败：响应中缺少 url 字段。")
    return signed_url


def _delete_uploaded_file(*, settings: MistralOCRSettings, file_id: str) -> None:
    _request_json(
        method="DELETE",
        url=f"{settings.base_url}/v1/files/{file_id}",
        api_key=settings.api_key,
        payload=None,
    )


def _ocr_from_document_url(
    *,
    settings: MistralOCRSettings,
    document_url: str,
) -> dict[str, Any]:
    return _request_json_with_retry(
        method="POST",
        url=f"{settings.base_url}/v1/ocr",
        api_key=settings.api_key,
        payload={
            "model": settings.model,
            "document": {
                "type": "document_url",
                "document_url": document_url,
            },
            "include_image_base64": False,
        },
    )


def _extract_ocr_text(payload: dict[str, Any]) -> tuple[str, int]:
    pages = payload.get("pages", [])
    if not isinstance(pages, list):
        pages = []

    blocks: list[str] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        markdown = str(page.get("markdown", "")).strip()
        if not markdown:
            continue
        index = page.get("index")
        if isinstance(index, int):
            blocks.append(f"[第{index + 1}页]\n{markdown}")
        else:
            blocks.append(markdown)

    content = "\n\n".join(blocks).strip()
    return content, len(blocks)


def _ocr_pdf_sync(
    *,
    settings: MistralOCRSettings,
    pdf_path: Path,
) -> tuple[str, dict[str, Any]]:
    uploaded_file_id: str | None = None
    try:
        uploaded_file_id = _upload_pdf_for_ocr(settings=settings, pdf_path=pdf_path)
        signed_url = _get_signed_file_url(settings=settings, file_id=uploaded_file_id)
        ocr_document_source = "signed_file_url"
        try:
            ocr_payload = _ocr_from_document_url(settings=settings, document_url=signed_url)
        except Exception as exc:
            if not _is_retryable_error(exc):
                raise
            # Fallback: when signed URL OCR path hits transient 5xx, retry with public arXiv URL.
            ocr_document_source = "arxiv_pdf_url"
            fallback_url = f"https://arxiv.org/pdf/{pdf_path.stem}"
            ocr_payload = _ocr_from_document_url(settings=settings, document_url=fallback_url)

        text, page_count = _extract_ocr_text(ocr_payload)
        if not text:
            raise RuntimeError("Mistral OCR 未提取出可用文本。")

        usage_info = ocr_payload.get("usage_info")
        metadata = {
            "provider": "mistral-ocr",
            "model": settings.model,
            "file_id": uploaded_file_id,
            "ocr_document_source": ocr_document_source,
            "page_count": page_count,
            "usage_info": usage_info if isinstance(usage_info, dict) else None,
        }
        return text, metadata
    finally:
        if uploaded_file_id:
            try:
                _delete_uploaded_file(settings=settings, file_id=uploaded_file_id)
            except Exception:
                # best effort cleanup
                pass


async def extract_pdf_text_with_mistral(
    *,
    settings: MistralOCRSettings,
    pdf_path: Path,
) -> tuple[str, dict[str, Any]]:
    return await asyncio.to_thread(
        _ocr_pdf_sync,
        settings=settings,
        pdf_path=pdf_path,
    )


def _extract_pdf_text_with_basic_library_sync(
    *,
    pdf_path: Path,
) -> tuple[str, dict[str, Any]]:
    try:
        from pypdf import PdfReader
    except Exception as exc:
        raise RuntimeError(
            "未配置 Mistral OCR API Key，且未安装基础 PDF 文本提取依赖 pypdf。"
            "请安装 pypdf 或配置 Mistral OCR。"
        ) from exc

    reader = PdfReader(str(pdf_path))
    page_count = len(reader.pages)
    blocks: list[str] = []
    for index, page in enumerate(reader.pages):
        page_text = str(page.extract_text() or "").strip()
        if not page_text:
            continue
        blocks.append(f"[第{index + 1}页]\n{page_text}")

    content = "\n\n".join(blocks).strip()
    if not content:
        raise RuntimeError("基础 PDF 文本提取未提取出可用文本。")

    return content, {
        "provider": "pypdf",
        "model": "pypdf",
        "page_count": page_count,
        "extracted_page_count": len(blocks),
        "ocr_document_source": "local_pdf",
    }


async def extract_pdf_text_with_basic_library(
    *,
    pdf_path: Path,
) -> tuple[str, dict[str, Any]]:
    return await asyncio.to_thread(
        _extract_pdf_text_with_basic_library_sync,
        pdf_path=pdf_path,
    )


async def extract_pdf_text(
    *,
    pdf_path: Path,
    settings: MistralOCRSettings | None,
) -> tuple[str, dict[str, Any]]:
    if settings is None or not settings.api_key.strip():
        return await extract_pdf_text_with_basic_library(pdf_path=pdf_path)
    return await extract_pdf_text_with_mistral(settings=settings, pdf_path=pdf_path)
