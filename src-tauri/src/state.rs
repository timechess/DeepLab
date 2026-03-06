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
pub const PAPER_READING_WORKFLOW_NAME: &str = "paper_reading";
pub const WORK_REPORT_WORKFLOW_NAME: &str = "work_report";
pub const DAILY_PAPERS_URL: &str = "https://huggingface.co/api/daily_papers";
pub const HF_PAPER_API_BASE_URL: &str = "https://huggingface.co/api/papers";
pub const DEFAULT_MISTRAL_OCR_BASE_URL: &str = "https://api.mistral.ai/v1";
pub const DEFAULT_MISTRAL_OCR_MODEL: &str = "mistral-ocr-latest";
pub const DEFAULT_SYSTEM_PROMPT: &str = "你是一名负责“AI论文初筛”的资深研究工程师，目标是在有限时间内找出最值得后续精读的论文。\n请保持严格、可审计、可复现：结论必须基于输入信息，不允许虚构。";
pub const DEFAULT_PAPER_READING_SYSTEM_PROMPT: &str =
  "你是一名AI研究领域专家，现在你要针对给定的论文给出一份完整、可靠、具备实操价值的中文精读报告。\n报告面向研究者与工程实践者，要求兼顾准确性、可读性与批判性。";
pub const DEFAULT_WORK_REPORT_SYSTEM_PROMPT: &str =
  "你是严谨的科研工作日报 Agent。你将基于用户前一天的真实行为记录生成中文 Markdown 日报。\n禁止虚构输入中不存在的信息，内容要具体、可执行。";
pub const DEFAULT_PAPER_FILTER_PROMPT: &str =
  include_str!("../resource/prompts/default_paper_filter_prompt.md");
pub const DEFAULT_PAPER_READING_PROMPT: &str =
  include_str!("../resource/prompts/default_paper_reading_prompt.md");
pub const DEFAULT_WORK_REPORT_PROMPT: &str =
  "请基于以下“用户行为汇总”生成 {{BUSINESS_DATE}} 的工作日报。\n\n你必须严格输出且只输出以下三节（Markdown 标题）：\n## 昨日工作总结\n要求：针对输入中的真实行为给出精简分条列点（`-` 列表），强调已完成事项、关键进展、阻塞点。\n\n## 今日工作规划\n要求：结合“当前未完成任务 + 昨日进展”给出今日计划，分条列点，明确优先级和可执行动作。\n\n## 工作建议\n要求：给出面向当前研究与工程推进的建议，可包含研究创新点、验证路径、实验设计、风险控制等，同样分条列点。\n\n约束：\n1. 所有结论必须能在输入中找到依据，不得杜撰。\n2. 不要输出除上述三节外的其他大标题。\n3. 输出必须是 Markdown 正文，不要包裹代码围栏。\n\n【业务日期】\n{{BUSINESS_DATE}}\n\n【来源日期标记】\n{{SOURCE_DATE}}\n\n【用户行为汇总】\n{{ACTIVITY_MARKDOWN}}";

pub fn today_key() -> String {
  Local::now().format("%Y-%m-%d").to_string()
}

pub fn now_rfc3339() -> String {
  Local::now().to_rfc3339()
}

pub async fn init_state(app_handle: &AppHandle) -> Result<AppState, String> {
  let app_config_dir = app_handle
    .path()
    .app_config_dir()
    .map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&app_config_dir).map_err(|e| e.to_string())?;
  let db_path = app_config_dir.join("deeplab.sqlite");
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
  Ok(AppState {
    pool,
    http: Client::new(),
  })
}
