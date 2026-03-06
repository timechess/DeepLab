use chrono::Local;
use reqwest::Client;
use sqlx::{
  sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions},
  ConnectOptions,
};
use std::str::FromStr;
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct AppState {
  pub pool: SqlitePool,
  pub http: Client,
}

pub const WORKFLOW_NAME: &str = "paper_recommendation";
pub const DAILY_PAPERS_URL: &str = "https://huggingface.co/api/daily_papers";
pub const DEFAULT_SYSTEM_PROMPT: &str = "你是一名负责“AI论文初筛”的资深研究工程师，目标是在有限时间内找出最值得后续精读的论文。\n请保持严格、可审计、可复现：结论必须基于输入信息，不允许虚构。";
pub const DEFAULT_PAPER_FILTER_PROMPT: &str =
  include_str!("../resource/prompts/default_paper_filter_prompt.md");
pub const DEFAULT_PAPER_READING_PROMPT: &str =
  "请对所选论文进行精读，输出方法细节、实验可信度、可复现实操建议。";
pub const DEFAULT_WORK_REPORT_PROMPT: &str =
  "请根据行为快照输出结构化工作报告，强调增量、质量与后续计划。";

pub fn today_key() -> String {
  Local::now().format("%Y-%m-%d").to_string()
}

pub fn now_rfc3339() -> String {
  Local::now().to_rfc3339()
}

pub async fn init_state(app_handle: &AppHandle) -> Result<AppState, String> {
  let app_data_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
  let db_path = app_data_dir.join("deeplab.sqlite");
  let db_url = format!("sqlite://{}", db_path.to_string_lossy());

  let options = SqliteConnectOptions::from_str(&db_url)
    .map_err(|e| e.to_string())?
    .create_if_missing(true)
    .disable_statement_logging();

  let pool = SqlitePoolOptions::new()
    .max_connections(5)
    .connect_with(options)
    .await
    .map_err(|e| e.to_string())?;

  sqlx::raw_sql(include_str!("../resource/init_db.sql"))
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
  sqlx::raw_sql(include_str!("../resource/migrations/002_add_rules.sql"))
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
  sqlx::raw_sql(include_str!(
    "../resource/migrations/003_add_paper_recommendations.sql"
  ))
  .execute(&pool)
  .await
  .map_err(|e| e.to_string())?;

  Ok(AppState {
    pool,
    http: Client::new(),
  })
}
