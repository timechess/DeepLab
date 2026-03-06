use crate::{
  db::{get_runtime_setting_row, to_runtime_setting_dto, upsert_runtime_setting},
  state::AppState,
  types::{RuntimeSettingDto, RuntimeSettingUpsertInput},
};
use tauri::State;

#[tauri::command]
pub async fn get_runtime_setting(state: State<'_, AppState>) -> Result<RuntimeSettingDto, String> {
  let maybe_row = get_runtime_setting_row(&state.pool).await.ok();
  Ok(to_runtime_setting_dto(maybe_row))
}

#[tauri::command]
pub async fn update_runtime_setting(
  state: State<'_, AppState>,
  input: RuntimeSettingUpsertInput,
) -> Result<RuntimeSettingDto, String> {
  upsert_runtime_setting(&state.pool, &input).await?;
  let row = get_runtime_setting_row(&state.pool).await?;
  Ok(to_runtime_setting_dto(Some(row)))
}
