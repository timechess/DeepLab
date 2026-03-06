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
  let links = normalize_links(input.links);
  update_note_content_and_links(&state.pool, id, &title, &content, &links).await
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
  Ok(trimmed.to_string())
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
