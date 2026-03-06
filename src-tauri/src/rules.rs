use crate::{
  db::{create_rule, delete_rule, list_rules, update_rule},
  state::AppState,
  types::{RuleDto, RuleInput},
};
use tauri::State;

#[tauri::command]
pub async fn get_rules(state: State<'_, AppState>) -> Result<Vec<RuleDto>, String> {
  list_rules(&state.pool).await
}

#[tauri::command]
pub async fn create_rule_item(
  state: State<'_, AppState>,
  input: RuleInput,
) -> Result<RuleDto, String> {
  let content = input.content.trim();
  if content.is_empty() {
    return Err(String::from("rule content cannot be empty"));
  }
  create_rule(&state.pool, content).await
}

#[tauri::command]
pub async fn update_rule_item(
  state: State<'_, AppState>,
  id: i64,
  input: RuleInput,
) -> Result<RuleDto, String> {
  let content = input.content.trim();
  if content.is_empty() {
    return Err(String::from("rule content cannot be empty"));
  }
  update_rule(&state.pool, id, content).await
}

#[tauri::command]
pub async fn delete_rule_item(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  delete_rule(&state.pool, id).await
}
