use crate::{
  db::write_llm_log,
  types::{LlmResponse, PaperRecommendationResult, RuntimeSettingRow},
};
use reqwest::{
  header::{HeaderMap, HeaderValue, InvalidHeaderValue, ACCEPT, CONTENT_TYPE, USER_AGENT},
  Client,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::{collections::HashSet, time::Duration};

const MAX_ATTEMPTS: u32 = 3;
const OPENAI_DEFAULT_CHAT_URL: &str = "https://api.openai.com/v1/chat/completions";
const GOOGLE_DEFAULT_CHAT_URL: &str =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GOOGLE_DEFAULT_NATIVE_BASE_URL: &str = "https://generativelanguage.googleapis.com";
const CHAT_COMPLETIONS_SUFFIX: &str = "/chat/completions";

pub async fn call_llm(
  pool: &SqlitePool,
  http: &Client,
  runtime_setting: &RuntimeSettingRow,
  system_prompt: &str,
  user_prompt: &str,
  retry_instruction: Option<String>,
) -> Result<String, String> {
  let endpoint = resolve_llm_endpoint(runtime_setting);
  let mut user_content = String::from(user_prompt);
  if let Some(extra) = retry_instruction {
    user_content = format!("{user_prompt}\n\n{extra}");
  }

  let messages = json!([
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": user_content}
  ]);
  let prompt_payload = messages.to_string();

  let (body, use_google_native_payload) = match endpoint {
    ResolvedLlmEndpoint::GoogleNativeGenerateContent { .. } => (
      json!({
        "systemInstruction": {
          "parts": [{"text": system_prompt}],
        },
        "contents": [
          {
            "role": "user",
            "parts": [{"text": user_content}],
          }
        ],
        "generationConfig": {
          "temperature": runtime_setting.temperature.unwrap_or(0.2),
          "thinkingConfig": {
            "thinkingLevel": runtime_setting
              .thinking_level
              .clone()
              .unwrap_or_else(|| String::from("medium")),
          }
        }
      }),
      true,
    ),
    ResolvedLlmEndpoint::OpenAiCompatibleChat { .. } => {
      let mut openai_body = json!({
        "model": &runtime_setting.model_name,
        "messages": messages.clone(),
        "temperature": runtime_setting.temperature.unwrap_or(0.2),
      });

      if is_google_provider(&runtime_setting.provider) {
        // Google OpenAI-compatible endpoint supports this switch directly.
        openai_body["reasoning_effort"] = json!(runtime_setting
          .thinking_level
          .clone()
          .unwrap_or_else(|| String::from("medium")));
      }

      (openai_body, false)
    }
  };

  let mut last_error_for_log = String::new();
  let mut any_non_404_error = false;

  let urls = endpoint.urls();
  for url in urls {
    for attempt in 1..=MAX_ATTEMPTS {
      let mut request = http
        .post(url.as_str())
        .json(&body)
        .headers(build_common_headers(attempt)?);

      if use_google_native_payload {
        request = request
          .header("x-goog-api-key", &runtime_setting.api_key)
          .bearer_auth(&runtime_setting.api_key);
      } else {
        request = request.bearer_auth(&runtime_setting.api_key);
      }

      if is_google_provider(&runtime_setting.provider) {
        request = request.header(
          "x-goog-api-client",
          "deeplab-tauri/0.1.0 llm-openai-compat/1",
        );
      }

      match request.send().await {
        Ok(response) => {
          let status = response.status();
          let response_text = response.text().await.map_err(|e| e.to_string())?;

          if status.is_success() {
            let (content, input_tokens, output_tokens) = if use_google_native_payload {
              parse_google_native_response(&response_text)?
            } else {
              parse_openai_compatible_response(&response_text)?
            };

            let _ = write_llm_log(
              pool,
              &runtime_setting.base_url,
              &runtime_setting.model_name,
              &prompt_payload,
              &content,
              input_tokens,
              output_tokens,
              runtime_setting.temperature,
              runtime_setting.thinking_level.as_deref(),
            )
            .await;

            return Ok(content);
          }

          last_error_for_log = format!("LLM request failed: {status} {response_text} (url: {url})");
          if status.as_u16() != 404 {
            any_non_404_error = true;
          }
          if attempt < MAX_ATTEMPTS && is_retryable_status(status.as_u16()) {
            tokio::time::sleep(backoff_delay(attempt)).await;
            continue;
          }
        }
        Err(err) => {
          last_error_for_log = format!("LLM transport failed: {err} (url: {url})");
          any_non_404_error = true;
          if attempt < MAX_ATTEMPTS && err.is_timeout() {
            tokio::time::sleep(backoff_delay(attempt)).await;
            continue;
          }
        }
      }

      break;
    }

    if any_non_404_error {
      break;
    }
  }

  let _ = write_llm_log(
    pool,
    &runtime_setting.base_url,
    &runtime_setting.model_name,
    &prompt_payload,
    &last_error_for_log,
    None,
    None,
    runtime_setting.temperature,
    runtime_setting.thinking_level.as_deref(),
  )
  .await;

  Err(last_error_for_log)
}

enum ResolvedLlmEndpoint {
  OpenAiCompatibleChat { urls: Vec<String> },
  GoogleNativeGenerateContent { urls: Vec<String> },
}

impl ResolvedLlmEndpoint {
  fn urls(&self) -> &[String] {
    match self {
      ResolvedLlmEndpoint::OpenAiCompatibleChat { urls } => urls,
      ResolvedLlmEndpoint::GoogleNativeGenerateContent { urls } => urls,
    }
  }
}

fn resolve_llm_endpoint(runtime_setting: &RuntimeSettingRow) -> ResolvedLlmEndpoint {
  if should_use_google_native_generate_content(runtime_setting) {
    return ResolvedLlmEndpoint::GoogleNativeGenerateContent {
      urls: resolve_google_native_generate_content_urls(runtime_setting),
    };
  }

  ResolvedLlmEndpoint::OpenAiCompatibleChat {
    urls: vec![resolve_chat_completions_url(runtime_setting)],
  }
}

fn should_use_google_native_generate_content(runtime_setting: &RuntimeSettingRow) -> bool {
  if !is_google_provider(&runtime_setting.provider) {
    return false;
  }
  runtime_setting
    .base_url
    .trim()
    .trim_end_matches('/')
    .ends_with("/google")
}

fn resolve_google_native_generate_content_urls(runtime_setting: &RuntimeSettingRow) -> Vec<String> {
  let base = runtime_setting.base_url.trim().trim_end_matches('/');
  let model = runtime_setting.model_name.trim();
  let model_segment = if model.starts_with("models/") {
    model.to_owned()
  } else {
    format!("models/{model}")
  };

  if base.is_empty() {
    return vec![format!(
      "{GOOGLE_DEFAULT_NATIVE_BASE_URL}/v1beta/{model_segment}:generateContent"
    )];
  }

  if base.contains(":generateContent") {
    return vec![String::from(base)];
  }

  let mut candidates = Vec::new();
  candidates.push(format!("{base}/v1beta/{model_segment}:generateContent"));
  candidates.push(format!("{base}/{model_segment}:generateContent"));
  candidates
}

fn resolve_chat_completions_url(runtime_setting: &RuntimeSettingRow) -> String {
  let base = runtime_setting.base_url.trim().trim_end_matches('/');

  if base.is_empty() {
    return if is_google_provider(&runtime_setting.provider) {
      String::from(GOOGLE_DEFAULT_CHAT_URL)
    } else {
      String::from(OPENAI_DEFAULT_CHAT_URL)
    };
  }

  if base.ends_with(CHAT_COMPLETIONS_SUFFIX) {
    return String::from(base);
  }

  // User input should usually stop at gateway root such as:
  // - OpenAI compatible: .../v1
  // - Google proxy style: .../google
  // We normalize to a chat completions URL here.
  if is_google_provider(&runtime_setting.provider) {
    if base.ends_with("/v1beta/openai") {
      return format!("{base}{CHAT_COMPLETIONS_SUFFIX}");
    }
    if base.ends_with("/google") {
      return format!("{base}{CHAT_COMPLETIONS_SUFFIX}");
    }
    if base.ends_with("/v1") || base.ends_with("/v1beta") {
      return format!("{base}/openai{CHAT_COMPLETIONS_SUFFIX}");
    }
    return format!("{base}{CHAT_COMPLETIONS_SUFFIX}");
  }

  if base.ends_with("/v1") {
    return format!("{base}{CHAT_COMPLETIONS_SUFFIX}");
  }
  if base.ends_with("/openai") {
    return format!("{base}/v1{CHAT_COMPLETIONS_SUFFIX}");
  }
  format!("{base}{CHAT_COMPLETIONS_SUFFIX}")
}

fn build_common_headers(attempt: u32) -> Result<HeaderMap, String> {
  let mut headers = HeaderMap::new();
  headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
  headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
  headers.insert(USER_AGENT, HeaderValue::from_static("DeepLab/0.1.0"));

  let request_id = format!(
    "deeplab-{}-{attempt}",
    chrono::Local::now().timestamp_millis()
  );
  let request_id_value =
    HeaderValue::from_str(&request_id).map_err(|err: InvalidHeaderValue| err.to_string())?;
  headers.insert("x-client-request-id", request_id_value);

  Ok(headers)
}

fn is_google_provider(provider: &str) -> bool {
  provider.trim().eq_ignore_ascii_case("google")
}

fn is_retryable_status(status: u16) -> bool {
  matches!(status, 429 | 500 | 502 | 503 | 504)
}

fn backoff_delay(attempt: u32) -> Duration {
  let base_ms = 350_u64;
  let exponential = 2_u64.saturating_pow(attempt.saturating_sub(1));
  Duration::from_millis(base_ms.saturating_mul(exponential))
}

fn extract_message_content(content: &Value) -> String {
  match content {
    Value::String(text) => text.clone(),
    Value::Array(items) => {
      let mut text = String::new();
      for item in items {
        if let Some(piece) = item.get("text").and_then(Value::as_str) {
          if !text.is_empty() {
            text.push('\n');
          }
          text.push_str(piece);
        }
      }
      text
    }
    _ => String::new(),
  }
}

fn parse_openai_compatible_response(
  response_text: &str,
) -> Result<(String, Option<i64>, Option<i64>), String> {
  let parsed_response: LlmResponse = serde_json::from_str(response_text)
    .map_err(|e| format!("failed to parse LLM response envelope: {e}"))?;

  let content = parsed_response
    .choices
    .first()
    .map(|choice| extract_message_content(&choice.message.content))
    .ok_or_else(|| String::from("LLM choices is empty"))?;

  let output_tokens = parsed_response
    .usage
    .as_ref()
    .and_then(|usage| usage.total_tokens.or(usage.completion_tokens))
    .map(i64::from);
  let input_tokens = parsed_response
    .usage
    .as_ref()
    .and_then(|usage| usage.prompt_tokens)
    .map(i64::from);

  Ok((content, input_tokens, output_tokens))
}

fn parse_google_native_response(
  response_text: &str,
) -> Result<(String, Option<i64>, Option<i64>), String> {
  let value: Value = serde_json::from_str(response_text)
    .map_err(|e| format!("failed to parse Gemini native response: {e}"))?;

  let content = value
    .get("candidates")
    .and_then(Value::as_array)
    .and_then(|candidates| candidates.first())
    .and_then(|candidate| candidate.get("content"))
    .and_then(|content| content.get("parts"))
    .and_then(Value::as_array)
    .map(|parts| {
      parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<&str>>()
        .join("\n")
    })
    .unwrap_or_default();

  if content.is_empty() {
    return Err(String::from(
      "Gemini native response contains empty candidates.content.parts.text",
    ));
  }

  let usage = value.get("usageMetadata");
  let input_tokens = usage
    .and_then(|u| u.get("promptTokenCount"))
    .and_then(Value::as_i64);
  let output_tokens = usage
    .and_then(|u| u.get("totalTokenCount"))
    .and_then(Value::as_i64)
    .or_else(|| {
      usage
        .and_then(|u| u.get("candidatesTokenCount"))
        .and_then(Value::as_i64)
    });

  Ok((content, input_tokens, output_tokens))
}

pub fn parse_llm_json(raw: &str) -> Result<PaperRecommendationResult, String> {
  let trimmed = raw.trim();
  let json_str = if trimmed.starts_with("```") {
    trimmed
      .trim_start_matches("```json")
      .trim_start_matches("```")
      .trim_end_matches("```")
      .trim()
      .to_owned()
  } else {
    trimmed.to_owned()
  };

  serde_json::from_str::<PaperRecommendationResult>(&json_str)
    .map_err(|e| format!("LLM JSON parse failed: {e}"))
}

pub fn validate_recommendation_result(
  result: &PaperRecommendationResult,
  candidate_ids: &[String],
) -> Result<(), String> {
  let candidate_set: HashSet<&str> = candidate_ids.iter().map(String::as_str).collect();
  let mut decision_set: HashSet<&str> = HashSet::new();

  if result.decisions.len() != candidate_ids.len() {
    return Err(String::from("decisions size must cover all candidates"));
  }

  for decision in &result.decisions {
    if !candidate_set.contains(decision.id.as_str()) {
      return Err(format!("unknown decision id: {}", decision.id));
    }
    if !decision_set.insert(decision.id.as_str()) {
      return Err(format!("duplicate decision id: {}", decision.id));
    }
    if !decision.selected && decision.rank.is_some() {
      return Err(format!(
        "rank should be omitted when selected=false for {}",
        decision.id
      ));
    }
  }

  let selected_ids_from_decisions: HashSet<&str> = result
    .decisions
    .iter()
    .filter(|decision| decision.selected)
    .map(|decision| decision.id.as_str())
    .collect();
  let selected_ids_from_root: HashSet<&str> =
    result.selected_ids.iter().map(String::as_str).collect();

  if selected_ids_from_decisions != selected_ids_from_root {
    return Err(String::from(
      "selected_ids must equal decisions(selected=true)",
    ));
  }

  let mut ranks = result
    .decisions
    .iter()
    .filter(|decision| decision.selected)
    .map(|decision| {
      decision
        .rank
        .ok_or_else(|| format!("selected paper missing rank: {}", decision.id))
    })
    .collect::<Result<Vec<u32>, String>>()?;

  ranks.sort_unstable();
  for (index, rank) in ranks.iter().enumerate() {
    let expected = (index as u32) + 1;
    if *rank != expected {
      return Err(String::from("rank must be continuous starting from 1"));
    }
  }

  Ok(())
}
