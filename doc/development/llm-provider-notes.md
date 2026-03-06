# LLM Provider Notes

## Provider Strategy

统一走 OpenAI-compatible chat completions 协议，根据 provider 调整 URL 与头部。

## URL 解析规则

用户输入 `base_url` 通常只到网关根路径（例如 `/v1` 或 `/google`），系统自动补全 `/chat/completions` 路径。

- OpenAI compatible 默认：`https://api.openai.com/v1/chat/completions`
- Google 默认：`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`

## Headers

通用：

- `Authorization: Bearer ...`
- `Accept: application/json`
- `Content-Type: application/json`
- `User-Agent: DeepLab/0.1.0`
- `x-client-request-id`

Google 额外：

- `x-goog-api-client`

## Retry

指数退避，最多 3 次；重试状态码：

- `429, 500, 502, 503, 504`

## JSON 校验

LLM 返回 JSON 必须满足：

1. `decisions` 覆盖全部候选 id
2. `selected_ids` 与 `selected=true` 一致
3. `rank` 仅出现在 selected 项且从 1 连续
