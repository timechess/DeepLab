use crate::{
  db::{
    create_task, delete_task, list_task_history, toggle_task_completed as db_toggle_task_completed,
    update_task,
  },
  state::AppState,
  types::{TaskDto, TaskInput, TaskListResponse},
};
use tauri::State;

#[tauri::command]
pub async fn create_task_item(
  state: State<'_, AppState>,
  input: TaskInput,
) -> Result<TaskDto, String> {
  let title = input.title.trim();
  if title.is_empty() {
    return Err(String::from("task title cannot be empty"));
  }
  let priority = normalize_priority(&input.priority)?;
  let description = normalize_description(input.description);
  create_task(&state.pool, title, description.as_deref(), priority).await
}

#[tauri::command]
pub async fn get_task_history(
  state: State<'_, AppState>,
  page: Option<u32>,
) -> Result<TaskListResponse, String> {
  let safe_page = page.unwrap_or(1).max(1);
  let page_size = 10_u32;
  let (total, pending_total, completed_total, items) =
    list_task_history(&state.pool, safe_page, page_size).await?;
  Ok(TaskListResponse {
    page: safe_page,
    page_size,
    total,
    pending_total,
    completed_total,
    items,
  })
}

#[tauri::command]
pub async fn update_task_item(
  state: State<'_, AppState>,
  id: i64,
  input: TaskInput,
) -> Result<TaskDto, String> {
  let title = input.title.trim();
  if title.is_empty() {
    return Err(String::from("task title cannot be empty"));
  }
  let priority = normalize_priority(&input.priority)?;
  let description = normalize_description(input.description);
  update_task(&state.pool, id, title, description.as_deref(), priority).await
}

#[tauri::command]
pub async fn toggle_task_completed(
  state: State<'_, AppState>,
  id: i64,
  completed: bool,
) -> Result<TaskDto, String> {
  db_toggle_task_completed(&state.pool, id, completed).await
}

#[tauri::command]
pub async fn delete_task_item(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  delete_task(&state.pool, id).await
}

fn normalize_priority(value: &str) -> Result<&'static str, String> {
  let normalized = value.trim().to_ascii_lowercase();
  match normalized.as_str() {
    "low" => Ok("low"),
    "medium" | "meidum" => Ok("medium"),
    "high" => Ok("high"),
    _ => Err(String::from("task priority must be low, medium, or high")),
  }
}

fn normalize_description(value: Option<String>) -> Option<String> {
  value.and_then(|raw| {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
      None
    } else {
      Some(trimmed.to_string())
    }
  })
}
