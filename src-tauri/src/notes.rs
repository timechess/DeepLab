use crate::{
  db::{
    create_note, delete_note, get_note_detail_by_id, get_note_linked_context_by_id,
    list_note_history, search_note_paper_options, search_note_work_report_options,
    update_note_content_and_links,
  },
  state::AppState,
  types::{
    NoteDetailDto, NoteHistoryResponse, NoteLinkRefInput, NoteLinkedContextDto, NotePaperOptionDto,
    NoteUpsertInput, NoteWorkReportOptionDto,
  },
};
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
) -> Result<NoteDetailDto, String> {
  let title = normalize_title(&input.title)?;
  let content = normalize_content(&input.content)?;
  let expected_updated_at = normalize_expected_updated_at(input.expected_updated_at);
  let links = normalize_links(input.links);
  update_note_content_and_links(
    &state.pool,
    id,
    &title,
    &content,
    expected_updated_at.as_deref(),
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
      .map(|text| !text.trim().is_empty())
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
      .map(|src| !src.trim().is_empty())
      .unwrap_or(false);
  }

  if let Some(attrs) = map.get("attrs").and_then(Value::as_object) {
    let latex = attrs
      .get("latex")
      .or_else(|| attrs.get("value"))
      .or_else(|| attrs.get("text"))
      .and_then(Value::as_str)
      .map(|s| !s.trim().is_empty())
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
