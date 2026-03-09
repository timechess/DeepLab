use crate::{
  db::{
    create_note, delete_note, get_note_detail_by_id, get_note_linked_context_by_id,
    get_note_revision_detail_by_id, list_note_history, list_note_revisions,
    search_note_paper_options, search_note_work_report_options, update_note_content_and_links,
  },
  state::AppState,
  types::{
    NoteDetailDto, NoteHistoryResponse, NoteLinkRefInput, NoteLinkedContextDto, NotePaperOptionDto,
    NoteRevisionDetailDto, NoteRevisionResponse, NoteSaveResultDto, NoteUpsertInput,
    NoteWorkReportOptionDto,
  },
};
use serde_json::json;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn get_note_history(
  state: State<'_, AppState>,
  page: Option<u32>,
  query: Option<String>,
) -> Result<NoteHistoryResponse, String> {
  let safe_page = page.unwrap_or(1).max(1);
  let page_size = 10_u32;
  let normalized_query = normalize_query(query);
  let (total, items) = list_note_history(
    &state.pool,
    safe_page,
    page_size,
    normalized_query.as_deref(),
  )
  .await?;
  Ok(NoteHistoryResponse {
    page: safe_page,
    page_size,
    total,
    items,
  })
}

#[tauri::command]
pub async fn create_note_item(state: State<'_, AppState>) -> Result<NoteDetailDto, String> {
  create_note(&state.pool).await
}

#[tauri::command]
pub async fn delete_note_item(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  delete_note(&state.pool, id).await
}

#[tauri::command]
pub async fn get_note_detail(state: State<'_, AppState>, id: i64) -> Result<NoteDetailDto, String> {
  get_note_detail_by_id(&state.pool, id).await
}

#[tauri::command]
pub async fn update_note_content(
  state: State<'_, AppState>,
  id: i64,
  input: NoteUpsertInput,
) -> Result<NoteSaveResultDto, String> {
  let NoteUpsertInput {
    title: raw_title,
    content: raw_content,
    expected_updated_at: raw_expected_updated_at,
    save_source: raw_save_source,
  } = input;
  let title = normalize_title(&raw_title)?;
  let content = normalize_content(&raw_content)?;
  let expected_updated_at = normalize_expected_updated_at(raw_expected_updated_at);
  let save_source = normalize_save_source(raw_save_source);
  // Rebuild structured links from document content to keep note_links consistent with the actual snapshot.
  let links = extract_links_from_note_content(&content)?;
  update_note_content_and_links(
    &state.pool,
    id,
    &title,
    &content,
    expected_updated_at.as_deref(),
    save_source.as_deref().unwrap_or("unknown"),
    true,
    &links,
  )
  .await
}

#[tauri::command]
pub async fn get_note_revisions(
  state: State<'_, AppState>,
  id: i64,
  page: Option<u32>,
  page_size: Option<u32>,
) -> Result<NoteRevisionResponse, String> {
  let safe_page = page.unwrap_or(1).max(1);
  let safe_page_size = page_size.unwrap_or(20).clamp(1, 100);
  let (total, items) = list_note_revisions(&state.pool, id, safe_page, safe_page_size).await?;
  Ok(NoteRevisionResponse {
    page: safe_page,
    page_size: safe_page_size,
    total,
    items,
  })
}

#[tauri::command]
pub async fn get_note_revision_detail(
  state: State<'_, AppState>,
  id: i64,
  revision_id: i64,
) -> Result<NoteRevisionDetailDto, String> {
  get_note_revision_detail_by_id(&state.pool, id, revision_id).await
}

#[tauri::command]
pub async fn restore_note_revision(
  state: State<'_, AppState>,
  id: i64,
  revision_id: i64,
  expected_updated_at: Option<String>,
) -> Result<NoteSaveResultDto, String> {
  let expected_updated_at = normalize_expected_updated_at(expected_updated_at);
  let revision = get_note_revision_detail_by_id(&state.pool, id, revision_id).await?;
  let title = normalize_title(&revision.title)?;
  let content = normalize_restored_note_content(&revision.content)?;
  let links = extract_links_from_note_content(&content)?;
  update_note_content_and_links(
    &state.pool,
    id,
    &title,
    &content,
    expected_updated_at.as_deref(),
    "restore",
    false,
    &links,
  )
  .await
}

#[tauri::command]
pub async fn get_note_linked_context(
  state: State<'_, AppState>,
  id: i64,
) -> Result<NoteLinkedContextDto, String> {
  get_note_linked_context_by_id(&state.pool, id).await
}

#[tauri::command]
pub async fn search_note_papers(
  state: State<'_, AppState>,
  query: Option<String>,
) -> Result<Vec<NotePaperOptionDto>, String> {
  let normalized_query = normalize_query(query);
  search_note_paper_options(&state.pool, normalized_query.as_deref(), 30).await
}

#[tauri::command]
pub async fn search_note_work_reports(
  state: State<'_, AppState>,
  query: Option<String>,
) -> Result<Vec<NoteWorkReportOptionDto>, String> {
  let normalized_query = normalize_query(query);
  search_note_work_report_options(&state.pool, normalized_query.as_deref(), 30).await
}

fn normalize_query(query: Option<String>) -> Option<String> {
  query.and_then(|value| {
    let trimmed = value.trim();
    if trimmed.is_empty() {
      None
    } else {
      Some(trimmed.to_string())
    }
  })
}

fn is_ignorable_text_char(ch: char) -> bool {
  ch.is_whitespace()
    || matches!(
      ch,
      '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}'
    )
}

fn has_meaningful_text(value: &str) -> bool {
  value.chars().any(|ch| !is_ignorable_text_char(ch))
}

fn normalize_title(title: &str) -> Result<String, String> {
  let trimmed = title.trim();
  if trimmed.is_empty() {
    return Err(String::from("note title cannot be empty"));
  }
  Ok(trimmed.to_string())
}

fn normalize_content(content: &str) -> Result<String, String> {
  let trimmed = content.trim();
  if trimmed.is_empty() {
    return Err(String::from("note content cannot be empty"));
  }
  if is_effectively_empty_note_document(trimmed)? {
    return Err(String::from(
      "note content is empty and was blocked to prevent accidental overwrite",
    ));
  }
  Ok(trimmed.to_string())
}

fn normalize_restored_note_content(content: &str) -> Result<String, String> {
  let trimmed = content.trim();
  if trimmed.is_empty() {
    return Err(String::from("note content cannot be empty"));
  }

  let parsed_value = match serde_json::from_str::<Value>(trimmed) {
    Ok(value) => unwrap_stringified_json_value(value, 3),
    Err(_) => Value::String(trimmed.to_string()),
  };
  let normalized_value = normalize_note_value_to_doc(parsed_value);
  let serialized = serde_json::to_string(&normalized_value).map_err(|e| e.to_string())?;

  if is_effectively_empty_note_document(&serialized)? {
    return Err(String::from(
      "note content is empty and was blocked to prevent accidental overwrite",
    ));
  }
  Ok(serialized)
}

fn normalize_expected_updated_at(value: Option<String>) -> Option<String> {
  value.and_then(|raw| {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
      None
    } else {
      Some(trimmed.to_string())
    }
  })
}

fn normalize_save_source(value: Option<String>) -> Option<String> {
  value.and_then(|raw| {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() {
      return None;
    }
    match trimmed.as_str() {
      "autosave" | "shortcut" | "visibility" | "restore" | "manual" | "unknown" => Some(trimmed),
      _ => Some(String::from("unknown")),
    }
  })
}

fn is_effectively_empty_note_document(content: &str) -> Result<bool, String> {
  let value: Value =
    serde_json::from_str(content).map_err(|_| String::from("note content is invalid JSON"))?;
  let Some(root) = value.as_object() else {
    return Ok(false);
  };
  let root_type = root.get("type").and_then(Value::as_str).unwrap_or("");
  if root_type != "doc" {
    return Ok(false);
  }
  Ok(!node_has_meaningful_content(&value))
}

fn node_has_meaningful_content(node: &Value) -> bool {
  let Some(map) = node.as_object() else {
    return false;
  };
  let node_type = map.get("type").and_then(Value::as_str).unwrap_or("");
  if node_type == "text" {
    return map
      .get("text")
      .and_then(Value::as_str)
      .map(has_meaningful_text)
      .unwrap_or(false);
  }
  if node_type == "noteReference" {
    return true;
  }
  if node_type == "image" {
    return map
      .get("attrs")
      .and_then(Value::as_object)
      .and_then(|attrs| attrs.get("src"))
      .and_then(Value::as_str)
      .map(has_meaningful_text)
      .unwrap_or(false);
  }

  if let Some(attrs) = map.get("attrs").and_then(Value::as_object) {
    let latex = attrs
      .get("latex")
      .or_else(|| attrs.get("value"))
      .or_else(|| attrs.get("text"))
      .and_then(Value::as_str)
      .map(has_meaningful_text)
      .unwrap_or(false);
    if latex {
      return true;
    }
  }

  if let Some(children) = map.get("content").and_then(Value::as_array) {
    return children.iter().any(node_has_meaningful_content);
  }
  false
}

fn unwrap_stringified_json_value(value: Value, max_depth: usize) -> Value {
  let mut current = value;
  for _ in 0..max_depth {
    let Value::String(raw) = current else {
      return current;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
      return Value::String(raw);
    }
    current = match serde_json::from_str::<Value>(trimmed) {
      Ok(next) => next,
      Err(_) => return Value::String(raw),
    };
  }
  current
}

fn normalize_note_value_to_doc(value: Value) -> Value {
  match value {
    Value::Object(map) => {
      if let Some(node_type) = map.get("type").and_then(Value::as_str) {
        if node_type == "doc" {
          return Value::Object(map);
        }
        return json!({
          "type": "doc",
          "content": [Value::Object(map)],
        });
      }

      let fallback_text = map
        .get("content")
        .and_then(Value::as_str)
        .or_else(|| map.get("markdown").and_then(Value::as_str))
        .or_else(|| map.get("text").and_then(Value::as_str))
        .map(ToString::to_string);
      if let Some(text) = fallback_text {
        if !text.trim().is_empty() {
          return build_plain_text_doc(&text);
        }
      }

      let object_value = Value::Object(map);
      let serialized = serde_json::to_string(&object_value).unwrap_or_default();
      build_plain_text_doc(&serialized)
    }
    Value::Array(items) => {
      let node_like = items.iter().all(|item| {
        item
          .as_object()
          .and_then(|map| map.get("type"))
          .and_then(Value::as_str)
          .map(|value| !value.trim().is_empty())
          .unwrap_or(false)
      });
      if node_like {
        json!({
          "type": "doc",
          "content": items,
        })
      } else {
        let array_value = Value::Array(items);
        let serialized = serde_json::to_string(&array_value).unwrap_or_default();
        build_plain_text_doc(&serialized)
      }
    }
    Value::String(text) => build_plain_text_doc(&text),
    Value::Bool(flag) => build_plain_text_doc(if flag { "true" } else { "false" }),
    Value::Number(number) => build_plain_text_doc(&number.to_string()),
    Value::Null => json!({
      "type": "doc",
      "content": [{"type": "paragraph"}],
    }),
  }
}

fn build_plain_text_doc(text: &str) -> Value {
  if !has_meaningful_text(text) {
    return json!({
      "type": "doc",
      "content": [{"type": "paragraph"}],
    });
  }
  json!({
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": text}],
      }
    ],
  })
}

fn normalize_links(links: Vec<NoteLinkRefInput>) -> Vec<NoteLinkRefInput> {
  let mut out = Vec::new();
  for item in links {
    match item.ref_type.as_str() {
      "paper" => {
        if let Some(ref_id) = item.ref_id {
          let normalized = ref_id.trim().to_string();
          if !normalized.is_empty() {
            out.push(NoteLinkRefInput {
              ref_type: String::from("paper"),
              ref_id: Some(normalized),
              label: item.label,
            });
          }
        }
      }
      "task" | "note" => {
        if let Some(ref_id) = item.ref_id {
          let normalized = ref_id.trim().to_string();
          if normalized.parse::<i64>().is_ok() {
            out.push(NoteLinkRefInput {
              ref_type: item.ref_type,
              ref_id: Some(normalized),
              label: item.label,
            });
          }
        }
      }
      "work_report" => {
        if let Some(ref_id) = item.ref_id {
          let normalized = ref_id.trim().to_string();
          if is_valid_date(&normalized) {
            out.push(NoteLinkRefInput {
              ref_type: String::from("work_report"),
              ref_id: Some(normalized),
              label: item.label,
            });
          }
        }
      }
      _ => {}
    }
  }
  out
}

fn extract_links_from_note_content(content: &str) -> Result<Vec<NoteLinkRefInput>, String> {
  let value: Value =
    serde_json::from_str(content).map_err(|_| String::from("note content is invalid JSON"))?;
  let mut links = Vec::new();
  walk_note_reference_node(&value, &mut links);
  Ok(normalize_links(links))
}

fn walk_note_reference_node(node: &Value, out: &mut Vec<NoteLinkRefInput>) {
  let Some(map) = node.as_object() else {
    return;
  };
  if map.get("type").and_then(Value::as_str).unwrap_or("") == "noteReference" {
    let Some(attrs) = map.get("attrs").and_then(Value::as_object) else {
      return;
    };
    let Some(ref_type) = attrs.get("refType").and_then(Value::as_str) else {
      return;
    };
    let Some(ref_id) = attrs.get("refId").and_then(Value::as_str) else {
      return;
    };
    let label = attrs
      .get("label")
      .and_then(Value::as_str)
      .map(ToString::to_string);
    out.push(NoteLinkRefInput {
      ref_type: ref_type.to_string(),
      ref_id: Some(ref_id.to_string()),
      label,
    });
  }
  if let Some(children) = map.get("content").and_then(Value::as_array) {
    for child in children {
      walk_note_reference_node(child, out);
    }
  }
}

fn is_valid_date(value: &str) -> bool {
  if value.len() != 10 {
    return false;
  }
  let bytes = value.as_bytes();
  for (index, byte) in bytes.iter().enumerate() {
    if index == 4 || index == 7 {
      if *byte != b'-' {
        return false;
      }
    } else if !byte.is_ascii_digit() {
      return false;
    }
  }
  true
}

#[cfg(test)]
mod tests {
  use super::{normalize_content, normalize_restored_note_content};
  use serde_json::{json, Value};

  #[test]
  fn normalize_restored_note_content_should_unwrap_double_encoded_doc() {
    let raw = r#""{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]}]}""#;
    let normalized = normalize_restored_note_content(raw)
      .unwrap_or_else(|error| panic!("normalize failed: {error}"));
    let parsed: Value =
      serde_json::from_str(&normalized).unwrap_or_else(|error| panic!("invalid json: {error}"));
    assert_eq!(parsed.get("type").and_then(Value::as_str), Some("doc"));
    let text = parsed
      .get("content")
      .and_then(Value::as_array)
      .and_then(|items| items.first())
      .and_then(|paragraph| paragraph.get("content"))
      .and_then(Value::as_array)
      .and_then(|items| items.first())
      .and_then(|text| text.get("text"))
      .and_then(Value::as_str)
      .unwrap_or("");
    assert_eq!(text, "hello");
  }

  #[test]
  fn normalize_restored_note_content_should_wrap_plain_text_as_doc() {
    let normalized = normalize_restored_note_content("legacy markdown line")
      .unwrap_or_else(|error| panic!("normalize failed: {error}"));
    let parsed: Value =
      serde_json::from_str(&normalized).unwrap_or_else(|error| panic!("invalid json: {error}"));
    assert_eq!(parsed.get("type").and_then(Value::as_str), Some("doc"));
    let text = parsed
      .get("content")
      .and_then(Value::as_array)
      .and_then(|items| items.first())
      .and_then(|paragraph| paragraph.get("content"))
      .and_then(Value::as_array)
      .and_then(|items| items.first())
      .and_then(|text| text.get("text"))
      .and_then(Value::as_str)
      .unwrap_or("");
    assert_eq!(text, "legacy markdown line");
  }

  #[test]
  fn normalize_restored_note_content_should_serialize_non_node_object_as_text_doc() {
    let normalized = normalize_restored_note_content(r#"{"title":"legacy","foo":1}"#)
      .unwrap_or_else(|error| panic!("normalize failed: {error}"));
    let parsed: Value =
      serde_json::from_str(&normalized).unwrap_or_else(|error| panic!("invalid json: {error}"));
    assert_eq!(parsed.get("type").and_then(Value::as_str), Some("doc"));
    let text = parsed
      .get("content")
      .and_then(Value::as_array)
      .and_then(|items| items.first())
      .and_then(|paragraph| paragraph.get("content"))
      .and_then(Value::as_array)
      .and_then(|items| items.first())
      .and_then(|text| text.get("text"))
      .and_then(Value::as_str)
      .unwrap_or("");
    assert!(text.contains("\"title\":\"legacy\""));
    assert!(text.contains("\"foo\":1"));
  }

  #[test]
  fn normalize_content_should_reject_zero_width_only_doc() {
    let raw = json!({
      "type": "doc",
      "content": [
        {
          "type": "paragraph",
          "content": [
            { "type": "text", "text": "\u{200B}\u{200C}\u{2060}" }
          ]
        }
      ]
    })
    .to_string();
    let error = normalize_content(&raw).expect_err("zero-width-only doc must be rejected");
    assert!(error.contains("empty"));
  }
}
