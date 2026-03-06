mod db;
mod llm;
mod paper_reading;
mod rules;
mod settings;
mod state;
mod types;
mod paper_recommendation;

use paper_reading::{
  get_paper_report_detail, get_paper_report_history, start_paper_reading_workflow,
  update_paper_report_comment,
};
use rules::{create_rule_item, delete_rule_item, get_rules, update_rule_item};
use settings::{get_runtime_setting, update_runtime_setting};
use state::init_state;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use paper_recommendation::{
  get_today_paper_recommendation, get_workflow_history, get_workflow_status,
  start_paper_recommendation_workflow,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = vec![
    Migration {
      version: 1,
      description: "init_deeplab_schema",
      sql: include_str!("../resource/init_db.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "add_rules_table",
      sql: include_str!("../resource/migrations/002_add_rules.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 3,
      description: "add_paper_recommendations",
      sql: include_str!("../resource/migrations/003_add_paper_recommendations.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 4,
      description: "add_paper_reading_fields",
      sql: include_str!("../resource/migrations/004_add_paper_reading_fields.sql"),
      kind: MigrationKind::Up,
    },
  ];

  let builder = tauri::Builder::default()
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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
