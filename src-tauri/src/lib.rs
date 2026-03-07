mod db;
mod llm;
mod notes;
mod paper_reading;
mod paper_recommendation;
mod rules;
mod settings;
mod state;
mod tasks;
mod types;
mod work_report;

use notes::{
  create_note_item, delete_note_item, get_note_detail, get_note_history, get_note_linked_context,
  search_note_papers, search_note_work_reports, update_note_content,
};
use paper_reading::{
  get_paper_report_detail, get_paper_report_history, start_paper_reading_workflow,
  update_paper_report_comment,
};
use paper_recommendation::{
  get_today_paper_recommendation, get_workflow_history, get_workflow_status,
  start_paper_recommendation_workflow,
};
use rules::{create_rule_item, delete_rule_item, get_rules, update_rule_item};
use settings::{get_runtime_setting, update_runtime_setting};
use state::init_state;
use tasks::{
  create_task_item, delete_task_item, get_task_history, toggle_task_completed, update_task_item,
};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use work_report::{
  get_today_work_report_overview, get_work_report_detail, get_work_report_history,
  start_work_report_workflow,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = vec![Migration {
    version: 1,
    description: "init_deeplab_schema",
    sql: include_str!("../resource/init_db.sql"),
    kind: MigrationKind::Up,
  }];

  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
      let _ = app
        .get_webview_window("main")
        .expect("no main window")
        .set_focus();
    }))
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:deeplab.sqlite", migrations)
        .build(),
    )
    .setup(|app| {
      let state = tauri::async_runtime::block_on(init_state(&app.handle().clone()))
        .map_err(std::io::Error::other)?;
      app.manage(state);
      Ok(())
    });

  builder
    .invoke_handler(tauri::generate_handler![
      start_paper_recommendation_workflow,
      get_today_paper_recommendation,
      get_workflow_status,
      get_workflow_history,
      start_paper_reading_workflow,
      get_paper_report_history,
      get_paper_report_detail,
      update_paper_report_comment,
      get_runtime_setting,
      update_runtime_setting,
      get_rules,
      create_rule_item,
      update_rule_item,
      delete_rule_item,
      get_task_history,
      create_task_item,
      update_task_item,
      toggle_task_completed,
      delete_task_item,
      get_note_history,
      create_note_item,
      delete_note_item,
      get_note_detail,
      update_note_content,
      get_note_linked_context,
      search_note_papers,
      search_note_work_reports,
      get_today_work_report_overview,
      start_work_report_workflow,
      get_work_report_history,
      get_work_report_detail,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
