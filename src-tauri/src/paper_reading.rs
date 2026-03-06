use crate::{
  db::{
    find_ready_paper_report_workflow, find_running_paper_reading_workflow,
    get_paper_report_detail_by_paper_id, get_runtime_setting_row, get_workflow_payload,
    insert_workflow_running_with_payload, list_paper_report_history, mark_workflow_failed,
    save_paper_report_result, save_workflow, update_paper_report_comment_by_paper_id,
  },
  llm::call_llm,
  state::{
    now_rfc3339, AppState, DEFAULT_MISTRAL_OCR_BASE_URL, DEFAULT_MISTRAL_OCR_MODEL,
    DEFAULT_PAPER_READING_PROMPT, DEFAULT_PAPER_READING_SYSTEM_PROMPT, HF_PAPER_API_BASE_URL,
    PAPER_READING_WORKFLOW_NAME,
  },
  types::{
    HfPaperApiResponse, PaperReadingTriggerInput, PaperReportCommentInput, PaperReportDetailDto,
    PaperReportListResponse, PersistPaper, StartPaperReadingResponse,
  },
};
use reqwest::{header, Client};
use serde_json::{json, Value};
use tauri::State;

const ARXIV_ABS_PREFIX: &str = "https://arxiv.org/abs/";
const ARXIV_PDF_PREFIX: &str = "https://arxiv.org/pdf/";

#[tauri::command]
pub async fn start_paper_reading_workflow(
  state: State<'_, AppState>,
  input: PaperReadingTriggerInput,
) -> Result<StartPaperReadingResponse, String> {
  let paper_id = parse_arxiv_id(&input.paper_id_or_url)?;

  if let Some(workflow_id) = find_ready_paper_report_workflow(&state.pool, &paper_id).await? {
    return Ok(StartPaperReadingResponse {
      workflow_id,
      paper_id,
      reused: true,
    });
  }

  if let Some(workflow_id) =
    find_running_paper_reading_workflow(&state.pool, PAPER_READING_WORKFLOW_NAME, &paper_id).await?
  {
    return Ok(StartPaperReadingResponse {
      workflow_id,
      paper_id,
      reused: true,
    });
  }

  let payload = json!({
    "paperId": paper_id,
    "triggeredAt": now_rfc3339(),
    "retries": 0,
  });
  let workflow_id =
    insert_workflow_running_with_payload(&state.pool, PAPER_READING_WORKFLOW_NAME, &payload)
      .await?;

  let pool = state.pool.clone();
  let http = state.http.clone();
  let task_paper_id = paper_id.clone();

  tauri::async_runtime::spawn(async move {
    let run_result = run_paper_reading_workflow(&pool, &http, workflow_id, &task_paper_id).await;
    if let Err(error) = run_result {
      let _ = mark_workflow_failed(&pool, workflow_id, &error).await;
    }
  });

  Ok(StartPaperReadingResponse {
    workflow_id,
    paper_id,
    reused: false,
  })
}

#[tauri::command]
pub async fn get_paper_report_history(
  state: State<'_, AppState>,
  page: Option<u32>,
) -> Result<PaperReportListResponse, String> {
  let safe_page = page.unwrap_or(1).max(1);
  let page_size = 10_u32;
  let (total, items) = list_paper_report_history(&state.pool, safe_page, page_size).await?;
  Ok(PaperReportListResponse {
    page: safe_page,
    page_size,
    total,
    items,
  })
}

#[tauri::command]
pub async fn get_paper_report_detail(
  state: State<'_, AppState>,
  paper_id: String,
) -> Result<PaperReportDetailDto, String> {
  let normalized = parse_arxiv_id(&paper_id)?;
  get_paper_report_detail_by_paper_id(&state.pool, &normalized).await
}

#[tauri::command]
pub async fn update_paper_report_comment(
  state: State<'_, AppState>,
  paper_id: String,
  input: PaperReportCommentInput,
) -> Result<(), String> {
  let normalized = parse_arxiv_id(&paper_id)?;
  update_paper_report_comment_by_paper_id(&state.pool, &normalized, &input.comment).await
}

async fn run_paper_reading_workflow(
  pool: &sqlx::SqlitePool,
  http: &Client,
  workflow_id: i64,
  paper_id: &str,
) -> Result<(), String> {
  let mut payload = get_workflow_payload(pool, workflow_id).await?;
  payload["startedAt"] = Value::String(now_rfc3339());
  save_workflow(pool, workflow_id, "running", None, &payload).await?;

  let runtime_setting = get_runtime_setting_row(pool).await?;
  if !runtime_setting
    .ocr_provider
    .trim()
    .eq_ignore_ascii_case("mistral_ai")
  {
    return Err(String::from("only mistral_ai OCR provider is supported"));
  }
  let ocr_model = runtime_setting
    .ocr_model
    .clone()
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| String::from(DEFAULT_MISTRAL_OCR_MODEL));

  let (paper, source) = match fetch_hf_paper(http, paper_id).await? {
    Some(hf_paper) => (hf_paper_to_persist(hf_paper), String::from("huggingface")),
    None => (
      fetch_arxiv_paper_fallback(http, paper_id).await?,
      String::from("arxiv"),
    ),
  };

  payload["source"] = Value::String(source.clone());
  let pdf_url = format!("{ARXIV_PDF_PREFIX}{paper_id}");
  payload["pdfUrl"] = Value::String(pdf_url.clone());

  let ocr_markdown = call_mistral_ocr_markdown(http, &runtime_setting, &pdf_url).await?;
  payload["ocrChars"] = json!(ocr_markdown.chars().count());

  let prompt_template = runtime_setting
    .paper_reading_prompt
    .clone()
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| String::from(DEFAULT_PAPER_READING_PROMPT));
  let user_prompt = prompt_template
    .replace("{{PAPER_ID}}", paper_id)
    .replace("{{PAPER_TITLE}}", &paper.title)
    .replace("{{PAPER_OCR_TEXT}}", &ocr_markdown);

  let llm_output = call_llm(
    pool,
    http,
    &runtime_setting,
    DEFAULT_PAPER_READING_SYSTEM_PROMPT,
    &user_prompt,
    None,
  )
  .await?;
  let report_markdown = extract_report_xml(&llm_output)?;

  save_paper_report_result(
    pool,
    &paper,
    paper_id,
    workflow_id,
    &source,
    &ocr_model,
    &report_markdown,
  )
  .await?;

  payload["finishedAt"] = Value::String(now_rfc3339());
  save_workflow(pool, workflow_id, "success", None, &payload).await
}

fn parse_arxiv_id(input: &str) -> Result<String, String> {
  let raw = input.trim();
  if raw.is_empty() {
    return Err(String::from("paper id or url cannot be empty"));
  }

  let mut candidate = if raw.contains("arxiv.org") {
    if let Some(rest) = raw.split("/abs/").nth(1) {
      rest.to_string()
    } else if let Some(rest) = raw.split("/pdf/").nth(1) {
      rest.to_string()
    } else {
      return Err(String::from("unsupported arxiv url"));
    }
  } else {
    raw.to_string()
  };

  if let Some((value, _)) = candidate.split_once('?') {
    candidate = value.to_string();
  }
  if let Some((value, _)) = candidate.split_once('#') {
    candidate = value.to_string();
  }
  if let Some(value) = candidate.strip_suffix(".pdf") {
    candidate = value.to_string();
  }
  candidate = candidate.trim().to_string();

  if let Some(version_index) = candidate.rfind('v') {
    let suffix = &candidate[version_index + 1..];
    if !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit()) {
      candidate = candidate[..version_index].to_string();
    }
  }

  if candidate.is_empty()
    || !candidate
      .chars()
      .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '/'))
  {
    return Err(String::from("invalid arxiv id"));
  }

  Ok(candidate)
}

fn extract_report_xml(content: &str) -> Result<String, String> {
  let start_tag = "<report>";
  let end_tag = "</report>";

  let start = content
    .find(start_tag)
    .ok_or_else(|| String::from("missing <report> tag"))?;
  let end = content
    .find(end_tag)
    .ok_or_else(|| String::from("missing </report> tag"))?;
  if end <= start {
    return Err(String::from("invalid <report> tag range"));
  }

  let second_start = content[start + start_tag.len()..].find(start_tag);
  if second_start.is_some() {
    return Err(String::from("multiple <report> tags are not allowed"));
  }

  let second_end = content[end + end_tag.len()..].find(end_tag);
  if second_end.is_some() {
    return Err(String::from("multiple </report> tags are not allowed"));
  }

  let report = content[start + start_tag.len()..end].trim().to_string();
  if report.is_empty() {
    return Err(String::from("report content is empty"));
  }
  Ok(report)
}

fn hf_paper_to_persist(item: HfPaperApiResponse) -> PersistPaper {
  PersistPaper {
    id: item.id.clone(),
    title: item.title.unwrap_or_else(|| item.id.clone()),
    authors: item.authors.into_iter().map(|author| author.name).collect(),
    organization: item.organization.map(|org| org.name),
    summary: item.summary.unwrap_or_default(),
    ai_summary: item.ai_summary.unwrap_or_default(),
    ai_keywords: item.ai_keywords,
    upvotes: item.upvotes,
    github_repo: item.github_repo,
    github_stars: item.github_stars,
    published_at: item.published_at,
  }
}

async fn fetch_hf_paper(
  http: &Client,
  paper_id: &str,
) -> Result<Option<HfPaperApiResponse>, String> {
  let url = format!("{HF_PAPER_API_BASE_URL}/{paper_id}");
  let response = http.get(url).send().await.map_err(|e| e.to_string())?;

  if response.status().as_u16() == 404 {
    return Ok(None);
  }

  let response = response.error_for_status().map_err(|e| e.to_string())?;
  let value = response.json::<Value>().await.map_err(|e| e.to_string())?;
  if let Ok(paper) = serde_json::from_value::<HfPaperApiResponse>(value.clone()) {
    return Ok(Some(paper));
  }
  if let Some(nested) = value.get("paper") {
    let paper =
      serde_json::from_value::<HfPaperApiResponse>(nested.clone()).map_err(|e| e.to_string())?;
    return Ok(Some(paper));
  }
  Err(String::from("unexpected huggingface paper response format"))
}

async fn fetch_arxiv_paper_fallback(http: &Client, paper_id: &str) -> Result<PersistPaper, String> {
  let url = format!("{ARXIV_ABS_PREFIX}{paper_id}");
  let html = http
    .get(url)
    .send()
    .await
    .map_err(|e| e.to_string())?
    .error_for_status()
    .map_err(|e| e.to_string())?
    .text()
    .await
    .map_err(|e| e.to_string())?;

  let title = extract_meta_content(&html, "citation_title")
    .or_else(|| extract_tag_title(&html))
    .unwrap_or_else(|| paper_id.to_string());
  let summary = extract_meta_content(&html, "description").unwrap_or_default();
  let authors = extract_all_meta_contents(&html, "citation_author");

  Ok(PersistPaper {
    id: paper_id.to_string(),
    title,
    authors,
    organization: None,
    summary,
    ai_summary: String::new(),
    ai_keywords: Vec::new(),
    upvotes: None,
    github_repo: None,
    github_stars: None,
    published_at: None,
  })
}

fn extract_meta_content(html: &str, name: &str) -> Option<String> {
  let marker = format!("name=\"{name}\"");
  let idx = html.find(&marker)?;
  let tail = &html[idx..];
  let content_marker = "content=\"";
  let content_start = tail.find(content_marker)? + content_marker.len();
  let content_tail = &tail[content_start..];
  let content_end = content_tail.find('"')?;
  Some(decode_html_entities(&content_tail[..content_end]))
}

fn extract_all_meta_contents(html: &str, name: &str) -> Vec<String> {
  let marker = format!("name=\"{name}\"");
  let content_marker = "content=\"";
  let mut values = Vec::new();
  let mut offset = 0_usize;

  while let Some(idx) = html[offset..].find(&marker) {
    let absolute_idx = offset + idx;
    let tail = &html[absolute_idx..];
    if let Some(content_idx) = tail.find(content_marker) {
      let value_tail = &tail[content_idx + content_marker.len()..];
      if let Some(end_idx) = value_tail.find('"') {
        let decoded = decode_html_entities(&value_tail[..end_idx]);
        if !decoded.trim().is_empty() {
          values.push(decoded);
        }
      }
    }
    offset = absolute_idx + marker.len();
  }

  values
}

fn extract_tag_title(html: &str) -> Option<String> {
  let open = html.find("<title>")? + "<title>".len();
  let close = html[open..].find("</title>")? + open;
  Some(decode_html_entities(html[open..close].trim()))
}

fn decode_html_entities(value: &str) -> String {
  value
    .replace("&amp;", "&")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
}

async fn call_mistral_ocr_markdown(
  http: &Client,
  runtime_setting: &crate::types::RuntimeSettingRow,
  pdf_url: &str,
) -> Result<String, String> {
  let base = runtime_setting.ocr_base_url.as_deref().unwrap_or("").trim();
  let endpoint = if base.is_empty() {
    format!("{DEFAULT_MISTRAL_OCR_BASE_URL}/ocr")
  } else if base.ends_with("/ocr") {
    base.to_string()
  } else {
    format!("{}/ocr", base.trim_end_matches('/'))
  };

  let ocr_model = runtime_setting
    .ocr_model
    .clone()
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| String::from(DEFAULT_MISTRAL_OCR_MODEL));
  let api_key = runtime_setting
    .ocr_api_key
    .as_deref()
    .filter(|value| !value.trim().is_empty())
    .ok_or_else(|| String::from("ocr_api_key is required for paper reading"))?;

  let body = json!({
    "model": ocr_model,
    "document": {
      "type": "document_url",
      "document_url": pdf_url,
    },
    "include_image_base64": false,
  });

  let response: Value = http
    .post(endpoint)
    .header(header::ACCEPT, "application/json")
    .header(header::CONTENT_TYPE, "application/json")
    .header(header::USER_AGENT, "DeepLab/0.1.0")
    .bearer_auth(api_key)
    .json(&body)
    .send()
    .await
    .map_err(|e| e.to_string())?
    .error_for_status()
    .map_err(|e| e.to_string())?
    .json()
    .await
    .map_err(|e| e.to_string())?;

  if let Some(markdown) = response.get("markdown").and_then(Value::as_str) {
    let trimmed = markdown.trim().to_string();
    if !trimmed.is_empty() {
      return Ok(trimmed);
    }
  }

  if let Some(pages) = response.get("pages").and_then(Value::as_array) {
    let mut chunks = Vec::new();
    for page in pages {
      if let Some(markdown) = page.get("markdown").and_then(Value::as_str) {
        let trimmed = markdown.trim();
        if !trimmed.is_empty() {
          chunks.push(trimmed.to_string());
        }
      }
    }
    if !chunks.is_empty() {
      return Ok(chunks.join("\n\n"));
    }
  }

  Err(String::from(
    "OCR response does not contain markdown content",
  ))
}

#[cfg(test)]
mod tests {
  use super::{extract_report_xml, parse_arxiv_id};

  #[test]
  fn parse_arxiv_id_supports_plain_and_url_inputs() {
    assert_eq!(
      parse_arxiv_id("2501.12345").expect("parse plain id"),
      "2501.12345"
    );
    assert_eq!(
      parse_arxiv_id("2501.12345v2").expect("parse id with version"),
      "2501.12345"
    );
    assert_eq!(
      parse_arxiv_id("https://arxiv.org/abs/2501.12345v3").expect("parse abs url"),
      "2501.12345"
    );
    assert_eq!(
      parse_arxiv_id("https://arxiv.org/pdf/2501.12345v1").expect("parse pdf url"),
      "2501.12345"
    );
  }

  #[test]
  fn parse_arxiv_id_rejects_invalid_input() {
    assert!(parse_arxiv_id("   ").is_err());
    assert!(parse_arxiv_id("https://arxiv.org/help").is_err());
    assert!(parse_arxiv_id("abc$%^&").is_err());
  }

  #[test]
  fn extract_report_xml_works() {
    let content = "<report>## title\ncontent</report>";
    assert_eq!(
      extract_report_xml(content).expect("extract report"),
      "## title\ncontent"
    );
  }

  #[test]
  fn extract_report_xml_requires_single_tag_pair() {
    assert!(extract_report_xml("no xml").is_err());
    assert!(extract_report_xml("<report>a</report><report>b</report>").is_err());
  }
}
