use crate::{
  db::{
    fetch_today_recommendation, finalize_papers_and_recommendation, find_existing_paper_ids,
    find_today_running_workflow, find_today_success_workflow, find_today_workflow_row,
    get_runtime_setting_row, get_workflow_payload, get_workflow_status_row,
    insert_workflow_running, list_workflow_history, load_paper_cards_by_ids, load_rule_list,
    mark_workflow_failed, save_workflow,
  },
  llm::{call_llm, parse_llm_json, validate_recommendation_result},
  state::{
    now_rfc3339, today_key, AppState, DAILY_PAPERS_URL, DEFAULT_PAPER_FILTER_PROMPT,
    DEFAULT_SYSTEM_PROMPT, WORKFLOW_NAME,
  },
  types::{
    CandidatePaper, HfDailyItem, PaperDecision, PaperRecommendationResult, PersistPaper,
    StartWorkflowResponse, TodayRecommendationResponse, WorkflowHistoryResponse,
    WorkflowStatusResponse,
  },
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::State;

#[tauri::command]
pub async fn start_paper_recommendation_workflow(
  state: State<'_, AppState>,
) -> Result<StartWorkflowResponse, String> {
  let day_key = today_key();

  if let Some(workflow_id) = find_today_success_workflow(&state.pool, &day_key).await? {
    return Ok(StartWorkflowResponse {
      workflow_id,
      reused: true,
    });
  }

  if let Some(workflow_id) =
    find_today_running_workflow(&state.pool, WORKFLOW_NAME, &day_key).await?
  {
    return Ok(StartWorkflowResponse {
      workflow_id,
      reused: true,
    });
  }

  let workflow_id = insert_workflow_running(&state.pool, WORKFLOW_NAME, &day_key).await?;
  let pool = state.pool.clone();
  let http = state.http.clone();
  let task_day_key = day_key.clone();

  tauri::async_runtime::spawn(async move {
    let run_result =
      run_paper_recommendation_workflow(&pool, &http, workflow_id, &task_day_key).await;
    if let Err(error) = run_result {
      let _ = mark_workflow_failed(&pool, workflow_id, &error).await;
    }
  });

  Ok(StartWorkflowResponse {
    workflow_id,
    reused: false,
  })
}

#[tauri::command]
pub async fn get_today_paper_recommendation(
  state: State<'_, AppState>,
) -> Result<TodayRecommendationResponse, String> {
  let day_key = today_key();

  if let Some((summary, selected_ids_json, decisions_json, workflow_id)) =
    fetch_today_recommendation(&state.pool, &day_key).await?
  {
    let selected_ids: Vec<String> = serde_json::from_str(&selected_ids_json).unwrap_or_default();
    let decisions: Vec<PaperDecision> = serde_json::from_str(&decisions_json).unwrap_or_default();
    let papers = load_paper_cards_by_ids(&state.pool, &selected_ids, &decisions).await?;

    return Ok(TodayRecommendationResponse {
      day_key,
      status: String::from("ready"),
      summary: Some(summary),
      papers: Some(papers),
      workflow_id,
      error: None,
    });
  }

  if let Some((workflow_id, stage, error)) =
    find_today_workflow_row(&state.pool, WORKFLOW_NAME, &day_key).await?
  {
    let status = match stage.as_str() {
      "running" => "running",
      "failed" => "failed",
      _ => "none",
    };

    return Ok(TodayRecommendationResponse {
      day_key,
      status: String::from(status),
      summary: None,
      papers: None,
      workflow_id: Some(workflow_id),
      error,
    });
  }

  Ok(TodayRecommendationResponse {
    day_key,
    status: String::from("none"),
    summary: None,
    papers: None,
    workflow_id: None,
    error: None,
  })
}

#[tauri::command]
pub async fn get_workflow_status(
  state: State<'_, AppState>,
  workflow_id: i64,
) -> Result<WorkflowStatusResponse, String> {
  let (id, name, stage, error, payload) = get_workflow_status_row(&state.pool, workflow_id).await?;
  Ok(WorkflowStatusResponse {
    id,
    name,
    stage,
    error,
    payload,
  })
}

#[tauri::command]
pub async fn get_workflow_history(
  state: State<'_, AppState>,
  page: Option<u32>,
) -> Result<WorkflowHistoryResponse, String> {
  let safe_page = page.unwrap_or(1).max(1);
  let page_size = 10_u32;
  let (total, items) = list_workflow_history(&state.pool, safe_page, page_size).await?;
  Ok(WorkflowHistoryResponse {
    page: safe_page,
    page_size,
    total,
    items,
  })
}

async fn run_paper_recommendation_workflow(
  pool: &SqlitePool,
  http: &reqwest::Client,
  workflow_id: i64,
  day_key: &str,
) -> Result<(), String> {
  let mut payload = get_workflow_payload(pool, workflow_id).await?;
  payload["startedAt"] = Value::String(now_rfc3339());
  save_workflow(pool, workflow_id, "running", None, &payload).await?;

  let fetched_items: Vec<HfDailyItem> = http
    .get(DAILY_PAPERS_URL)
    .send()
    .await
    .map_err(|e| e.to_string())?
    .error_for_status()
    .map_err(|e| e.to_string())?
    .json()
    .await
    .map_err(|e| e.to_string())?;

  let mut fetched_papers = Vec::<PersistPaper>::new();
  let mut fetched_ids = Vec::<String>::new();
  for item in fetched_items {
    let paper = item.paper;
    let authors: Vec<String> = paper.authors.into_iter().map(|a| a.name).collect();
    let organization = paper.organization.map(|org| org.name);
    let title = paper.title.unwrap_or_else(|| paper.id.clone());
    let summary = paper.summary.unwrap_or_default();
    let ai_summary = paper.ai_summary.unwrap_or_default();
    fetched_ids.push(paper.id.clone());
    fetched_papers.push(PersistPaper {
      id: paper.id,
      title,
      authors,
      organization,
      summary,
      ai_summary,
      ai_keywords: paper.ai_keywords,
      upvotes: paper.upvotes,
      github_repo: paper.github_repo,
      github_stars: paper.github_stars,
      published_at: paper.published_at,
    });
  }

  let existing_ids = find_existing_paper_ids(pool, &fetched_ids).await?;
  let candidates: Vec<CandidatePaper> = fetched_papers
    .iter()
    .filter(|paper| !existing_ids.contains(&paper.id))
    .map(|paper| CandidatePaper {
      id: paper.id.clone(),
      title: paper.title.clone(),
      summary: paper.summary.clone(),
      ai_summary: paper.ai_summary.clone(),
      ai_keywords: paper.ai_keywords.clone(),
      authors: paper.authors.clone(),
      organization: paper.organization.clone(),
      upvotes: paper.upvotes,
      github_repo: paper.github_repo.clone(),
      github_stars: paper.github_stars,
    })
    .collect();

  let candidate_ids: Vec<String> = candidates.iter().map(|paper| paper.id.clone()).collect();
  payload["candidateCount"] = json!(candidates.len());
  payload["newPaperIds"] = json!(candidate_ids.clone());

  if candidates.is_empty() {
    let empty_result = PaperRecommendationResult {
      summary: String::from("今天没有新增候选论文。"),
      selected_ids: Vec::new(),
      decisions: Vec::new(),
    };
    finalize_papers_and_recommendation(
      pool,
      &fetched_papers,
      day_key,
      workflow_id,
      &candidate_ids,
      &empty_result,
    )
    .await?;
    payload["selectedIds"] = json!(empty_result.selected_ids.clone());
    payload["llmResult"] = json!(empty_result);
    payload["finishedAt"] = Value::String(now_rfc3339());
    save_workflow(pool, workflow_id, "success", None, &payload).await?;
    return Ok(());
  }

  let runtime_setting = get_runtime_setting_row(pool).await?;
  let rule_list = load_rule_list(pool).await?;
  let prompt_template = runtime_setting
    .paper_filter_prompt
    .clone()
    .unwrap_or_else(|| String::from(DEFAULT_PAPER_FILTER_PROMPT));

  let candidate_text = build_candidates_text(&candidates);
  let user_prompt = prompt_template
    .replace("{{CANDIDATES_PAPER}}", &candidate_text)
    .replace("{{RULE_LIST}}", &rule_list);

  let mut retries = 0_u8;
  let recommendation = loop {
    let completion = call_llm(
      pool,
      http,
      &runtime_setting,
      DEFAULT_SYSTEM_PROMPT,
      &user_prompt,
      if retries == 0 {
        None
      } else {
        Some(String::from(
          "上一次输出不符合JSON结构要求，请严格返回JSON对象。",
        ))
      },
    )
    .await?;

    let parsed = parse_llm_json(&completion).and_then(|parsed| {
      validate_recommendation_result(&parsed, &candidate_ids)?;
      Ok(parsed)
    });

    match parsed {
      Ok(result) => break result,
      Err(error) => {
        if retries >= 1 {
          return Err(error);
        }
        retries += 1;
      }
    }
  };

  finalize_papers_and_recommendation(
    pool,
    &fetched_papers,
    day_key,
    workflow_id,
    &candidate_ids,
    &recommendation,
  )
  .await?;

  payload["retries"] = json!(retries);
  payload["selectedIds"] = json!(recommendation.selected_ids.clone());
  payload["llmResult"] = json!(recommendation);
  payload["finishedAt"] = Value::String(now_rfc3339());
  save_workflow(pool, workflow_id, "success", None, &payload).await?;

  Ok(())
}

fn build_candidates_text(candidates: &[CandidatePaper]) -> String {
  candidates
    .iter()
    .map(|paper| {
      format!(
        "id: {}\ntitle: {}\nsummary: {}\nai_summary: {}\nai_keywords: {}\nupvotes: {}\ngithubStars: {}\nauthors: {}\norganization: {}\narxiv: https://arxiv.org/abs/{}\ngithub: {}",
        paper.id,
        paper.title,
        paper.summary,
        paper.ai_summary,
        paper.ai_keywords.join(", "),
        paper.upvotes.unwrap_or(0),
        paper.github_stars.unwrap_or(0),
        paper.authors.join(", "),
        paper.organization.clone().unwrap_or_default(),
        paper.id,
        paper.github_repo.clone().unwrap_or_default(),
      )
    })
    .collect::<Vec<String>>()
    .join("\n\n----------------\n\n")
}
