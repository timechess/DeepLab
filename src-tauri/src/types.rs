use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartWorkflowResponse {
  pub workflow_id: i64,
  pub reused: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayRecommendationResponse {
  pub day_key: String,
  pub status: String,
  pub summary: Option<String>,
  pub papers: Option<Vec<PaperCardDto>>,
  pub workflow_id: Option<i64>,
  pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStatusResponse {
  pub id: i64,
  pub name: String,
  pub stage: String,
  pub error: Option<String>,
  pub payload: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowListItem {
  pub id: i64,
  pub name: String,
  pub stage: String,
  pub day_key: Option<String>,
  pub error: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowHistoryResponse {
  pub page: u32,
  pub page_size: u32,
  pub total: i64,
  pub items: Vec<WorkflowListItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperReadingTriggerInput {
  pub paper_id_or_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPaperReadingResponse {
  pub workflow_id: i64,
  pub paper_id: String,
  pub reused: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperReportListItemDto {
  pub paper_id: String,
  pub title: String,
  pub status: String,
  pub updated_at: String,
  pub has_comment: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperReportListResponse {
  pub page: u32,
  pub page_size: u32,
  pub total: i64,
  pub items: Vec<PaperReportListItemDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperReportDetailDto {
  pub paper_id: String,
  pub title: String,
  pub authors: Vec<String>,
  pub organization: Option<String>,
  pub summary: String,
  pub arxiv_url: String,
  pub github_repo: Option<String>,
  pub report: Option<String>,
  pub comment: Option<String>,
  pub status: String,
  pub error: Option<String>,
  pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperReportCommentInput {
  pub comment: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleDto {
  pub id: i64,
  pub content: String,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleInput {
  pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
  pub id: i64,
  pub title: String,
  pub description: Option<String>,
  pub priority: String,
  pub completed_date: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
  pub title: String,
  pub description: Option<String>,
  pub priority: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListResponse {
  pub page: u32,
  pub page_size: u32,
  pub total: i64,
  pub pending_total: i64,
  pub completed_total: i64,
  pub items: Vec<TaskDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteListItemDto {
  pub id: i64,
  pub title: String,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryResponse {
  pub page: u32,
  pub page_size: u32,
  pub total: i64,
  pub items: Vec<NoteListItemDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDetailDto {
  pub id: i64,
  pub title: String,
  pub content: String,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePaperLinkDto {
  pub paper_id: String,
  pub title: String,
  pub arxiv_url: String,
  pub has_report: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTaskLinkDto {
  pub task_id: i64,
  pub title: String,
  pub description: Option<String>,
  pub priority: String,
  pub completed_date: Option<String>,
  pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRefNoteDto {
  pub note_id: i64,
  pub title: String,
  pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinkedContextDto {
  pub papers: Vec<NotePaperLinkDto>,
  pub tasks: Vec<NoteTaskLinkDto>,
  pub notes: Vec<NoteRefNoteDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePaperOptionDto {
  pub paper_id: String,
  pub title: String,
  pub has_report: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinkRefInput {
  pub ref_type: String,
  pub ref_id: Option<String>,
  pub label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteUpsertInput {
  pub title: String,
  pub content: String,
  #[serde(default)]
  pub links: Vec<NoteLinkRefInput>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaperDecision {
  pub id: String,
  pub selected: bool,
  pub score: f64,
  pub rank: Option<u32>,
  pub reason: String,
  #[serde(default)]
  pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaperRecommendationResult {
  pub summary: String,
  pub selected_ids: Vec<String>,
  pub decisions: Vec<PaperDecision>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaperCardDto {
  pub id: String,
  pub title: String,
  pub summary: String,
  pub authors: Vec<String>,
  pub keywords: Vec<String>,
  pub arxiv_url: String,
  pub github_repo: Option<String>,
  pub upvotes: Option<i64>,
  pub github_stars: Option<i64>,
  pub organization: Option<String>,
  pub score: Option<f64>,
  pub rank: Option<u32>,
  pub reason: Option<String>,
  pub tags: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CandidatePaper {
  pub id: String,
  pub title: String,
  pub summary: String,
  pub ai_summary: String,
  pub ai_keywords: Vec<String>,
  pub authors: Vec<String>,
  pub organization: Option<String>,
  pub upvotes: Option<i64>,
  pub github_repo: Option<String>,
  pub github_stars: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct PersistPaper {
  pub id: String,
  pub title: String,
  pub authors: Vec<String>,
  pub organization: Option<String>,
  pub summary: String,
  pub ai_summary: String,
  pub ai_keywords: Vec<String>,
  pub upvotes: Option<i64>,
  pub github_repo: Option<String>,
  pub github_stars: Option<i64>,
  pub published_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RuntimeSettingRow {
  pub provider: String,
  pub base_url: String,
  pub api_key: String,
  pub model_name: String,
  pub ocr_provider: String,
  pub ocr_base_url: Option<String>,
  pub ocr_api_key: Option<String>,
  pub ocr_model: Option<String>,
  pub temperature: Option<f64>,
  pub thinking_level: Option<String>,
  pub paper_filter_prompt: Option<String>,
  pub paper_reading_prompt: Option<String>,
  pub work_report_prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HfDailyItem {
  pub paper: HfPaper,
}

#[derive(Debug, Deserialize)]
pub struct HfPaperApiResponse {
  pub id: String,
  pub title: Option<String>,
  pub summary: Option<String>,
  #[serde(default)]
  pub authors: Vec<HfAuthor>,
  pub organization: Option<HfOrganization>,
  pub ai_summary: Option<String>,
  #[serde(default)]
  pub ai_keywords: Vec<String>,
  pub upvotes: Option<i64>,
  #[serde(rename = "githubRepo")]
  pub github_repo: Option<String>,
  #[serde(rename = "githubStars")]
  pub github_stars: Option<i64>,
  #[serde(rename = "publishedAt")]
  pub published_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HfPaper {
  pub id: String,
  pub title: Option<String>,
  pub summary: Option<String>,
  #[serde(default)]
  pub authors: Vec<HfAuthor>,
  pub organization: Option<HfOrganization>,
  pub ai_summary: Option<String>,
  #[serde(default)]
  pub ai_keywords: Vec<String>,
  pub upvotes: Option<i64>,
  #[serde(rename = "githubRepo")]
  pub github_repo: Option<String>,
  #[serde(rename = "githubStars")]
  pub github_stars: Option<i64>,
  #[serde(rename = "publishedAt")]
  pub published_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HfAuthor {
  pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct HfOrganization {
  pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct LlmResponse {
  pub choices: Vec<LlmChoice>,
  pub usage: Option<LlmUsage>,
}

#[derive(Debug, Deserialize)]
pub struct LlmChoice {
  pub message: LlmMessage,
}

#[derive(Debug, Deserialize)]
pub struct LlmMessage {
  pub content: Value,
}

#[derive(Debug, Deserialize)]
pub struct LlmUsage {
  pub prompt_tokens: Option<i64>,
  pub completion_tokens: Option<i64>,
  pub total_tokens: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettingDto {
  pub provider: String,
  pub base_url: String,
  pub api_key: String,
  pub model_name: String,
  pub ocr_provider: String,
  pub ocr_base_url: String,
  pub ocr_api_key: String,
  pub ocr_model: String,
  pub thinking_level: String,
  pub temperature: f64,
  pub paper_filter_prompt: String,
  pub paper_reading_prompt: String,
  pub work_report_prompt: String,
  pub defaults_applied: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettingUpsertInput {
  pub provider: String,
  pub base_url: String,
  pub api_key: String,
  pub model_name: String,
  pub ocr_provider: String,
  pub ocr_base_url: String,
  pub ocr_api_key: String,
  pub ocr_model: String,
  pub thinking_level: String,
  pub temperature: f64,
  pub paper_filter_prompt: String,
  pub paper_reading_prompt: String,
  pub work_report_prompt: String,
}
