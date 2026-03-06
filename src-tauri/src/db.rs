use crate::{
  state::{
    now_rfc3339, DEFAULT_MISTRAL_OCR_BASE_URL, DEFAULT_MISTRAL_OCR_MODEL,
    DEFAULT_PAPER_FILTER_PROMPT, DEFAULT_PAPER_READING_PROMPT, DEFAULT_WORK_REPORT_PROMPT,
  },
  types::{
    BehaviorSnapshotComment, BehaviorSnapshotDto, BehaviorSnapshotNote, BehaviorSnapshotTask,
    NoteDetailDto, NoteLinkRefInput, NoteLinkedContextDto, NoteListItemDto, NotePaperLinkDto,
    NotePaperOptionDto, NoteRefNoteDto, NoteTaskLinkDto, NoteWorkReportLinkDto,
    NoteWorkReportOptionDto, PaperCardDto, PaperDecision, PaperRecommendationResult,
    PaperReportDetailDto, PaperReportListItemDto, PersistPaper, RuleDto, RuntimeSettingDto,
    RuntimeSettingRow, RuntimeSettingUpsertInput, TaskDto, WorkReportDeltaStats,
    WorkReportDetailDto, WorkReportListItemDto, WorkflowListItem,
  },
};
use serde_json::{json, Value};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::{HashMap, HashSet};

pub async fn insert_workflow_running(
  pool: &SqlitePool,
  workflow_name: &str,
  day_key: &str,
) -> Result<i64, String> {
  let payload = json!({"dayKey": day_key, "triggeredAt": now_rfc3339(), "retries": 0});
  insert_workflow_running_with_payload(pool, workflow_name, &payload).await
}

pub async fn insert_workflow_running_with_payload(
  pool: &SqlitePool,
  workflow_name: &str,
  payload: &Value,
) -> Result<i64, String> {
  let result =
    sqlx::query("INSERT INTO workflows (name, stage, payload) VALUES (?1, 'running', ?2)")
      .bind(workflow_name)
      .bind(payload.to_string())
      .execute(pool)
      .await
      .map_err(|e| e.to_string())?;
  Ok(result.last_insert_rowid())
}

pub async fn find_today_success_workflow(
  pool: &SqlitePool,
  day_key: &str,
) -> Result<Option<i64>, String> {
  let row = sqlx::query("SELECT workflow_id FROM paper_recommendations WHERE day_key = ?1")
    .bind(day_key)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
  if let Some(row) = row {
    Ok(
      row
        .try_get::<Option<i64>, _>("workflow_id")
        .map_err(|e| e.to_string())?,
    )
  } else {
    Ok(None)
  }
}

pub async fn find_today_running_workflow(
  pool: &SqlitePool,
  workflow_name: &str,
  day_key: &str,
) -> Result<Option<i64>, String> {
  let row = sqlx::query("SELECT id FROM workflows WHERE name = ?1 AND stage = 'running' AND json_extract(payload, '$.dayKey') = ?2 ORDER BY id DESC LIMIT 1")
    .bind(workflow_name)
    .bind(day_key)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
  row
    .map(|r| r.try_get("id").map_err(|e| e.to_string()))
    .transpose()
}

pub async fn get_workflow_payload(pool: &SqlitePool, workflow_id: i64) -> Result<Value, String> {
  let row = sqlx::query("SELECT payload FROM workflows WHERE id = ?1")
    .bind(workflow_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| String::from("workflow not found"))?;

  let payload_str: Option<String> = row.try_get("payload").map_err(|e| e.to_string())?;
  Ok(
    payload_str
      .as_deref()
      .and_then(|s| serde_json::from_str::<Value>(s).ok())
      .unwrap_or_else(|| json!({})),
  )
}

pub async fn save_workflow(
  pool: &SqlitePool,
  workflow_id: i64,
  stage: &str,
  error: Option<&str>,
  payload: &Value,
) -> Result<(), String> {
  sqlx::query("UPDATE workflows SET stage = ?1, error = ?2, payload = ?3, updatedAt = CURRENT_TIMESTAMP WHERE id = ?4")
    .bind(stage)
    .bind(error)
    .bind(payload.to_string())
    .bind(workflow_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  Ok(())
}

pub async fn mark_workflow_failed(
  pool: &SqlitePool,
  workflow_id: i64,
  error: &str,
) -> Result<(), String> {
  let mut payload = get_workflow_payload(pool, workflow_id).await?;
  payload["finishedAt"] = Value::String(now_rfc3339());
  payload["error"] = Value::String(String::from(error));
  save_workflow(pool, workflow_id, "failed", Some(error), &payload).await
}

pub async fn get_workflow_status_row(
  pool: &SqlitePool,
  workflow_id: i64,
) -> Result<(i64, String, String, Option<String>, Value), String> {
  let row = sqlx::query("SELECT id, name, stage, error, payload FROM workflows WHERE id = ?1")
    .bind(workflow_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| String::from("workflow not found"))?;

  let payload_str: Option<String> = row.try_get("payload").map_err(|e| e.to_string())?;
  let payload = payload_str
    .as_deref()
    .and_then(|v| serde_json::from_str::<Value>(v).ok())
    .unwrap_or_else(|| json!({}));

  Ok((
    row.try_get("id").map_err(|e| e.to_string())?,
    row.try_get("name").map_err(|e| e.to_string())?,
    row.try_get("stage").map_err(|e| e.to_string())?,
    row.try_get("error").map_err(|e| e.to_string())?,
    payload,
  ))
}

pub async fn list_workflow_history(
  pool: &SqlitePool,
  page: u32,
  page_size: u32,
) -> Result<(i64, Vec<WorkflowListItem>), String> {
  let row = sqlx::query("SELECT COUNT(1) AS total FROM workflows")
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
  let total: i64 = row.try_get("total").map_err(|e| e.to_string())?;

  let offset = i64::from(page.saturating_sub(1)) * i64::from(page_size);
  let rows = sqlx::query(
    "SELECT
      id, name, stage, error, createdAt, updatedAt,
      json_extract(payload, '$.dayKey') AS day_key
    FROM workflows
    ORDER BY id DESC
    LIMIT ?1 OFFSET ?2",
  )
  .bind(i64::from(page_size))
  .bind(offset)
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;

  let mut items = Vec::with_capacity(rows.len());
  for row in rows {
    items.push(WorkflowListItem {
      id: row.try_get("id").map_err(|e| e.to_string())?,
      name: row.try_get("name").map_err(|e| e.to_string())?,
      stage: row.try_get("stage").map_err(|e| e.to_string())?,
      day_key: row.try_get("day_key").map_err(|e| e.to_string())?,
      error: row.try_get("error").map_err(|e| e.to_string())?,
      created_at: row.try_get("createdAt").map_err(|e| e.to_string())?,
      updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
    });
  }

  Ok((total, items))
}

pub async fn find_today_workflow_row(
  pool: &SqlitePool,
  workflow_name: &str,
  day_key: &str,
) -> Result<Option<(i64, String, Option<String>)>, String> {
  let row = sqlx::query("SELECT id, stage, error FROM workflows WHERE name = ?1 AND json_extract(payload, '$.dayKey') = ?2 ORDER BY id DESC LIMIT 1")
    .bind(workflow_name)
    .bind(day_key)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

  row
    .map(|r| {
      Ok((
        r.try_get("id").map_err(|e| e.to_string())?,
        r.try_get("stage").map_err(|e| e.to_string())?,
        r.try_get("error").map_err(|e| e.to_string())?,
      ))
    })
    .transpose()
}

pub async fn fetch_today_recommendation(
  pool: &SqlitePool,
  day_key: &str,
) -> Result<Option<(String, String, String, Option<i64>)>, String> {
  let row = sqlx::query(
    "SELECT summary, selected_ids_json, decisions_json, workflow_id FROM paper_recommendations WHERE day_key = ?1",
  )
  .bind(day_key)
  .fetch_optional(pool)
  .await
  .map_err(|e| e.to_string())?;

  row
    .map(|r| {
      Ok((
        r.try_get("summary").map_err(|e| e.to_string())?,
        r.try_get("selected_ids_json").map_err(|e| e.to_string())?,
        r.try_get("decisions_json").map_err(|e| e.to_string())?,
        r.try_get("workflow_id").map_err(|e| e.to_string())?,
      ))
    })
    .transpose()
}

pub async fn find_existing_paper_ids(
  pool: &SqlitePool,
  ids: &[String],
) -> Result<HashSet<String>, String> {
  if ids.is_empty() {
    return Ok(HashSet::new());
  }

  let mut qb: QueryBuilder<'_, Sqlite> = QueryBuilder::new("SELECT id FROM papers WHERE id IN (");
  {
    let mut separated = qb.separated(", ");
    for id in ids {
      separated.push_bind(id);
    }
  }
  qb.push(")");

  let rows = qb
    .build()
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

  let mut existing = HashSet::with_capacity(rows.len());
  for row in rows {
    let id: String = row.try_get("id").map_err(|e| e.to_string())?;
    existing.insert(id);
  }
  Ok(existing)
}

pub async fn finalize_papers_and_recommendation(
  pool: &SqlitePool,
  papers: &[PersistPaper],
  day_key: &str,
  workflow_id: i64,
  candidate_ids: &[String],
  result: &PaperRecommendationResult,
) -> Result<(), String> {
  let selected_ids_json = serde_json::to_string(&result.selected_ids).map_err(|e| e.to_string())?;
  let decisions_json = serde_json::to_string(&result.decisions).map_err(|e| e.to_string())?;
  let candidate_ids_json = serde_json::to_string(candidate_ids).map_err(|e| e.to_string())?;
  let now = now_rfc3339();

  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

  for paper in papers {
    sqlx::query(
      "INSERT INTO papers (
        id, title, authors, organization, summary, ai_summary, ai_keywords, upvotes, githubRepo, githubStars, publishedAt
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        organization = excluded.organization,
        summary = excluded.summary,
        ai_summary = excluded.ai_summary,
        ai_keywords = excluded.ai_keywords,
        upvotes = excluded.upvotes,
        githubRepo = excluded.githubRepo,
        githubStars = excluded.githubStars,
        publishedAt = excluded.publishedAt,
        updatedAt = CURRENT_TIMESTAMP",
    )
    .bind(&paper.id)
    .bind(&paper.title)
    .bind(serde_json::to_string(&paper.authors).map_err(|e| e.to_string())?)
    .bind(&paper.organization)
    .bind(&paper.summary)
    .bind(&paper.ai_summary)
    .bind(serde_json::to_string(&paper.ai_keywords).map_err(|e| e.to_string())?)
    .bind(paper.upvotes)
    .bind(&paper.github_repo)
    .bind(paper.github_stars)
    .bind(&paper.published_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
  }

  sqlx::query(
    "INSERT INTO paper_recommendations (
      day_key, summary, selected_ids_json, decisions_json, candidate_ids_json, workflow_id, triggered_at, finished_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(day_key) DO UPDATE SET
      summary = excluded.summary,
      selected_ids_json = excluded.selected_ids_json,
      decisions_json = excluded.decisions_json,
      candidate_ids_json = excluded.candidate_ids_json,
      workflow_id = excluded.workflow_id,
      finished_at = excluded.finished_at,
      updatedAt = CURRENT_TIMESTAMP",
  )
  .bind(day_key)
  .bind(&result.summary)
  .bind(selected_ids_json)
  .bind(decisions_json)
  .bind(candidate_ids_json)
  .bind(workflow_id)
  .bind(&now)
  .bind(&now)
  .execute(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;

  tx.commit().await.map_err(|e| e.to_string())
}

pub async fn load_paper_cards_by_ids(
  pool: &SqlitePool,
  ids: &[String],
  decisions: &[PaperDecision],
) -> Result<Vec<PaperCardDto>, String> {
  if ids.is_empty() {
    return Ok(Vec::new());
  }

  let mut qb: QueryBuilder<'_, Sqlite> = QueryBuilder::new(
    "SELECT id, title, summary, authors, ai_keywords, githubRepo, upvotes, githubStars, organization FROM papers WHERE id IN (",
  );
  {
    let mut separated = qb.separated(", ");
    for id in ids {
      separated.push_bind(id);
    }
  }
  qb.push(")");

  let rows = qb
    .build()
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

  let decision_map: HashMap<String, PaperDecision> = decisions
    .iter()
    .cloned()
    .map(|decision| (decision.id.clone(), decision))
    .collect();

  let mut card_map: HashMap<String, PaperCardDto> = HashMap::new();
  for row in rows {
    let id: String = row.try_get("id").map_err(|e| e.to_string())?;
    let authors_json: String = row.try_get("authors").map_err(|e| e.to_string())?;
    let keywords_json: Option<String> = row.try_get("ai_keywords").map_err(|e| e.to_string())?;
    let decision = decision_map.get(&id);

    card_map.insert(
      id.clone(),
      PaperCardDto {
        id: id.clone(),
        title: row.try_get("title").map_err(|e| e.to_string())?,
        summary: row
          .try_get::<Option<String>, _>("summary")
          .map_err(|e| e.to_string())?
          .unwrap_or_default(),
        authors: serde_json::from_str(&authors_json).unwrap_or_default(),
        keywords: keywords_json
          .as_deref()
          .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
          .unwrap_or_default(),
        arxiv_url: format!("https://arxiv.org/abs/{id}"),
        github_repo: row.try_get("githubRepo").map_err(|e| e.to_string())?,
        upvotes: row.try_get("upvotes").map_err(|e| e.to_string())?,
        github_stars: row.try_get("githubStars").map_err(|e| e.to_string())?,
        organization: row.try_get("organization").map_err(|e| e.to_string())?,
        score: decision.map(|d| d.score),
        rank: decision.and_then(|d| d.rank),
        reason: decision.map(|d| d.reason.clone()),
        tags: decision.map(|d| d.tags.clone()).unwrap_or_default(),
      },
    );
  }

  let mut ordered_cards = Vec::new();
  for id in ids {
    if let Some(card) = card_map.get(id) {
      ordered_cards.push(card.clone());
    }
  }
  Ok(ordered_cards)
}

pub async fn find_running_paper_reading_workflow(
  pool: &SqlitePool,
  workflow_name: &str,
  paper_id: &str,
) -> Result<Option<i64>, String> {
  let row = sqlx::query("SELECT id FROM workflows WHERE name = ?1 AND stage = 'running' AND json_extract(payload, '$.paperId') = ?2 ORDER BY id DESC LIMIT 1")
    .bind(workflow_name)
    .bind(paper_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
  row
    .map(|r| r.try_get("id").map_err(|e| e.to_string()))
    .transpose()
}

pub async fn find_ready_paper_report_workflow(
  pool: &SqlitePool,
  paper_id: &str,
) -> Result<Option<i64>, String> {
  let row = sqlx::query(
    "SELECT COALESCE(workflow_id, 0) AS workflow_id
    FROM paper_reports
    WHERE paper_id = ?1
      AND status = 'ready'
      AND report IS NOT NULL
      AND trim(report) <> ''
    LIMIT 1",
  )
  .bind(paper_id)
  .fetch_optional(pool)
  .await
  .map_err(|e| e.to_string())?;

  row
    .map(|r| r.try_get("workflow_id").map_err(|e| e.to_string()))
    .transpose()
}

pub async fn save_paper_report_result(
  pool: &SqlitePool,
  paper: &PersistPaper,
  paper_id: &str,
  workflow_id: i64,
  source: &str,
  ocr_model: &str,
  report: &str,
) -> Result<(), String> {
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

  sqlx::query(
    "INSERT INTO papers (
      id, title, authors, organization, summary, ai_summary, ai_keywords, upvotes, githubRepo, githubStars, publishedAt
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      authors = excluded.authors,
      organization = excluded.organization,
      summary = excluded.summary,
      ai_summary = excluded.ai_summary,
      ai_keywords = excluded.ai_keywords,
      upvotes = excluded.upvotes,
      githubRepo = excluded.githubRepo,
      githubStars = excluded.githubStars,
      publishedAt = excluded.publishedAt,
      updatedAt = CURRENT_TIMESTAMP",
  )
  .bind(&paper.id)
  .bind(&paper.title)
  .bind(serde_json::to_string(&paper.authors).map_err(|e| e.to_string())?)
  .bind(&paper.organization)
  .bind(&paper.summary)
  .bind(&paper.ai_summary)
  .bind(serde_json::to_string(&paper.ai_keywords).map_err(|e| e.to_string())?)
  .bind(paper.upvotes)
  .bind(&paper.github_repo)
  .bind(paper.github_stars)
  .bind(&paper.published_at)
  .execute(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;

  sqlx::query(
    "INSERT INTO paper_reports (
      paper_id, comment, report, workflow_id, source, ocr_model, status, error
    ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, 'ready', NULL)
    ON CONFLICT(paper_id) DO UPDATE SET
      report = excluded.report,
      workflow_id = excluded.workflow_id,
      source = excluded.source,
      ocr_model = excluded.ocr_model,
      status = 'ready',
      error = NULL,
      updatedAt = CURRENT_TIMESTAMP",
  )
  .bind(paper_id)
  .bind(report)
  .bind(workflow_id)
  .bind(source)
  .bind(ocr_model)
  .execute(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())
}

pub async fn list_paper_report_history(
  pool: &SqlitePool,
  page: u32,
  page_size: u32,
) -> Result<(i64, Vec<PaperReportListItemDto>), String> {
  let row = sqlx::query("SELECT COUNT(1) AS total FROM paper_reports")
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
  let total: i64 = row.try_get("total").map_err(|e| e.to_string())?;
  let offset = i64::from(page.saturating_sub(1)) * i64::from(page_size);

  let rows = sqlx::query(
    "SELECT pr.paper_id, p.title, pr.status, pr.updatedAt, pr.comment
    FROM paper_reports pr
    INNER JOIN papers p ON p.id = pr.paper_id
    ORDER BY pr.updatedAt DESC
    LIMIT ?1 OFFSET ?2",
  )
  .bind(i64::from(page_size))
  .bind(offset)
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;

  let mut items = Vec::with_capacity(rows.len());
  for row in rows {
    let comment: Option<String> = row.try_get("comment").map_err(|e| e.to_string())?;
    items.push(PaperReportListItemDto {
      paper_id: row.try_get("paper_id").map_err(|e| e.to_string())?,
      title: row.try_get("title").map_err(|e| e.to_string())?,
      status: row.try_get("status").map_err(|e| e.to_string())?,
      updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
      has_comment: comment
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty()),
    });
  }
  Ok((total, items))
}

pub async fn get_paper_report_detail_by_paper_id(
  pool: &SqlitePool,
  paper_id: &str,
) -> Result<PaperReportDetailDto, String> {
  let row = sqlx::query(
    "SELECT
      p.id, p.title, p.authors, p.organization, p.summary, p.githubRepo,
      pr.report, pr.comment, pr.status, pr.error, pr.updatedAt
    FROM papers p
    INNER JOIN paper_reports pr ON pr.paper_id = p.id
    WHERE p.id = ?1",
  )
  .bind(paper_id)
  .fetch_optional(pool)
  .await
  .map_err(|e| e.to_string())?
  .ok_or_else(|| String::from("paper report not found"))?;

  let authors_json: String = row.try_get("authors").map_err(|e| e.to_string())?;
  Ok(PaperReportDetailDto {
    paper_id: row.try_get("id").map_err(|e| e.to_string())?,
    title: row.try_get("title").map_err(|e| e.to_string())?,
    authors: serde_json::from_str(&authors_json).unwrap_or_default(),
    organization: row.try_get("organization").map_err(|e| e.to_string())?,
    summary: row
      .try_get::<Option<String>, _>("summary")
      .map_err(|e| e.to_string())?
      .unwrap_or_default(),
    arxiv_url: format!("https://arxiv.org/abs/{paper_id}"),
    github_repo: row.try_get("githubRepo").map_err(|e| e.to_string())?,
    report: row.try_get("report").map_err(|e| e.to_string())?,
    comment: row.try_get("comment").map_err(|e| e.to_string())?,
    status: row.try_get("status").map_err(|e| e.to_string())?,
    error: row.try_get("error").map_err(|e| e.to_string())?,
    updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
  })
}

pub async fn update_paper_report_comment_by_paper_id(
  pool: &SqlitePool,
  paper_id: &str,
  comment: &str,
) -> Result<(), String> {
  let result = sqlx::query(
    "UPDATE paper_reports SET comment = ?1, updatedAt = CURRENT_TIMESTAMP WHERE paper_id = ?2",
  )
  .bind(comment)
  .bind(paper_id)
  .execute(pool)
  .await
  .map_err(|e| e.to_string())?;
  if result.rows_affected() == 0 {
    return Err(String::from("paper report not found"));
  }
  Ok(())
}

pub async fn load_current_behavior_snapshot(
  pool: &SqlitePool,
) -> Result<BehaviorSnapshotDto, String> {
  let task_rows = sqlx::query(
    "SELECT id, title, description, priority, completedDate FROM tasks ORDER BY id ASC",
  )
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;
  let comment_rows = sqlx::query(
    "SELECT pr.paper_id, pr.comment, p.title, p.summary
    FROM paper_reports pr
    LEFT JOIN papers p ON p.id = pr.paper_id
    WHERE comment IS NOT NULL AND trim(comment) <> ''
    ORDER BY pr.paper_id ASC",
  )
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;
  let note_rows = sqlx::query("SELECT id, title, content FROM notes ORDER BY id ASC")
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

  let tasks = task_rows
    .into_iter()
    .map(|row| -> Result<BehaviorSnapshotTask, String> {
      Ok(BehaviorSnapshotTask {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        title: row.try_get("title").map_err(|e| e.to_string())?,
        description: row.try_get("description").map_err(|e| e.to_string())?,
        priority: normalize_task_priority(row.try_get("priority").map_err(|e| e.to_string())?),
        completed_date: row.try_get("completedDate").map_err(|e| e.to_string())?,
      })
    })
    .collect::<Result<Vec<_>, _>>()?;

  let comments = comment_rows
    .into_iter()
    .map(|row| -> Result<BehaviorSnapshotComment, String> {
      Ok(BehaviorSnapshotComment {
        paper_id: row.try_get("paper_id").map_err(|e| e.to_string())?,
        comment: row.try_get("comment").map_err(|e| e.to_string())?,
        paper_title: row
          .try_get::<Option<String>, _>("title")
          .map_err(|e| e.to_string())?
          .unwrap_or_default(),
        paper_summary: row
          .try_get::<Option<String>, _>("summary")
          .map_err(|e| e.to_string())?
          .unwrap_or_default(),
      })
    })
    .collect::<Result<Vec<_>, _>>()?;

  let notes = note_rows
    .into_iter()
    .map(|row| -> Result<BehaviorSnapshotNote, String> {
      let raw_content: String = row.try_get("content").map_err(|e| e.to_string())?;
      Ok(BehaviorSnapshotNote {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        title: row.try_get("title").map_err(|e| e.to_string())?,
        content: normalize_note_content_to_markdown(&raw_content),
      })
    })
    .collect::<Result<Vec<_>, _>>()?;

  Ok(BehaviorSnapshotDto {
    tasks,
    comments,
    notes,
    updated_at: None,
  })
}

pub async fn load_behavior_snapshot(
  pool: &SqlitePool,
) -> Result<Option<BehaviorSnapshotDto>, String> {
  let row =
    sqlx::query("SELECT tasks, comments, notes, updatedAt FROM behavior_snapshots WHERE id = 1")
      .fetch_optional(pool)
      .await
      .map_err(|e| e.to_string())?;

  if let Some(row) = row {
    let tasks_json: String = row.try_get("tasks").map_err(|e| e.to_string())?;
    let comments_json: String = row.try_get("comments").map_err(|e| e.to_string())?;
    let notes_json: String = row.try_get("notes").map_err(|e| e.to_string())?;
    let tasks = serde_json::from_str::<Vec<BehaviorSnapshotTask>>(&tasks_json).unwrap_or_default();
    let comments =
      serde_json::from_str::<Vec<BehaviorSnapshotComment>>(&comments_json).unwrap_or_default();
    let notes = serde_json::from_str::<Vec<BehaviorSnapshotNote>>(&notes_json)
      .unwrap_or_default()
      .into_iter()
      .map(|note| BehaviorSnapshotNote {
        content: normalize_note_content_to_markdown(&note.content),
        ..note
      })
      .collect();

    return Ok(Some(BehaviorSnapshotDto {
      tasks,
      comments,
      notes,
      updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
    }));
  }

  Ok(None)
}

pub async fn find_today_work_report(
  pool: &SqlitePool,
  day_key: &str,
) -> Result<Option<(i64, Option<i64>, String)>, String> {
  let row = sqlx::query(
    "SELECT id, workflow_id, updatedAt
    FROM work_reports
    WHERE endDate = ?1
    ORDER BY id DESC
    LIMIT 1",
  )
  .bind(day_key)
  .fetch_optional(pool)
  .await
  .map_err(|e| e.to_string())?;

  row
    .map(|r| {
      Ok((
        r.try_get("id").map_err(|e| e.to_string())?,
        r.try_get("workflow_id").map_err(|e| e.to_string())?,
        r.try_get("updatedAt").map_err(|e| e.to_string())?,
      ))
    })
    .transpose()
}

pub async fn save_work_report_result(
  pool: &SqlitePool,
  workflow_id: i64,
  report: &str,
  stats: &WorkReportDeltaStats,
  start_date: &str,
  end_date: &str,
  snapshot: &BehaviorSnapshotDto,
) -> Result<i64, String> {
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  let stats_json = serde_json::to_string(stats).map_err(|e| e.to_string())?;
  let tasks_json = serde_json::to_string(&snapshot.tasks).map_err(|e| e.to_string())?;
  let comments_json = serde_json::to_string(&snapshot.comments).map_err(|e| e.to_string())?;
  let notes_json = serde_json::to_string(&snapshot.notes).map_err(|e| e.to_string())?;

  let result = sqlx::query(
    "INSERT INTO work_reports (statistics, report, startDate, endDate, workflow_id)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(endDate) DO UPDATE SET
      statistics = excluded.statistics,
      report = excluded.report,
      startDate = excluded.startDate,
      workflow_id = excluded.workflow_id,
      updatedAt = CURRENT_TIMESTAMP",
  )
  .bind(stats_json)
  .bind(report)
  .bind(start_date)
  .bind(end_date)
  .bind(workflow_id)
  .execute(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;

  sqlx::query(
    "INSERT INTO behavior_snapshots (id, tasks, comments, notes)
    VALUES (1, ?1, ?2, ?3)
    ON CONFLICT(id) DO UPDATE SET
      tasks = excluded.tasks,
      comments = excluded.comments,
      notes = excluded.notes,
      updatedAt = CURRENT_TIMESTAMP",
  )
  .bind(tasks_json)
  .bind(comments_json)
  .bind(notes_json)
  .execute(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;

  tx.commit().await.map_err(|e| e.to_string())?;

  let report_id = if result.last_insert_rowid() > 0 {
    result.last_insert_rowid()
  } else {
    let row =
      sqlx::query("SELECT id FROM work_reports WHERE endDate = ?1 ORDER BY id DESC LIMIT 1")
        .bind(end_date)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    row.try_get("id").map_err(|e| e.to_string())?
  };
  Ok(report_id)
}

pub async fn list_work_report_history(
  pool: &SqlitePool,
  page: u32,
  page_size: u32,
) -> Result<(i64, Vec<WorkReportListItemDto>), String> {
  let row = sqlx::query("SELECT COUNT(1) AS total FROM work_reports")
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
  let total: i64 = row.try_get("total").map_err(|e| e.to_string())?;
  let offset = i64::from(page.saturating_sub(1)) * i64::from(page_size);

  let rows = sqlx::query(
    "SELECT
      wr.id, wr.startDate, wr.endDate, wr.updatedAt, w.stage
    FROM work_reports wr
    LEFT JOIN workflows w ON w.id = wr.workflow_id
    ORDER BY wr.endDate DESC, wr.id DESC
    LIMIT ?1 OFFSET ?2",
  )
  .bind(i64::from(page_size))
  .bind(offset)
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;

  let mut items = Vec::with_capacity(rows.len());
  for row in rows {
    let stage: Option<String> = row.try_get("stage").map_err(|e| e.to_string())?;
    items.push(WorkReportListItemDto {
      id: row.try_get("id").map_err(|e| e.to_string())?,
      status: stage.unwrap_or_else(|| String::from("success")),
      start_date: row.try_get("startDate").map_err(|e| e.to_string())?,
      end_date: row.try_get("endDate").map_err(|e| e.to_string())?,
      updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
    });
  }
  Ok((total, items))
}

pub async fn get_work_report_detail_by_id(
  pool: &SqlitePool,
  id: i64,
) -> Result<WorkReportDetailDto, String> {
  let row = sqlx::query(
    "SELECT id, statistics, report, startDate, endDate, workflow_id, createdAt, updatedAt
    FROM work_reports
    WHERE id = ?1",
  )
  .bind(id)
  .fetch_optional(pool)
  .await
  .map_err(|e| e.to_string())?
  .ok_or_else(|| String::from("work report not found"))?;

  let stats_json: String = row.try_get("statistics").map_err(|e| e.to_string())?;
  let statistics =
    serde_json::from_str::<WorkReportDeltaStats>(&stats_json).unwrap_or(WorkReportDeltaStats {
      new_tasks: 0,
      completed_tasks: 0,
      new_comments: 0,
      updated_comments: 0,
      new_notes: 0,
      updated_notes: 0,
    });

  Ok(WorkReportDetailDto {
    id: row.try_get("id").map_err(|e| e.to_string())?,
    report: row.try_get("report").map_err(|e| e.to_string())?,
    statistics,
    start_date: row.try_get("startDate").map_err(|e| e.to_string())?,
    end_date: row.try_get("endDate").map_err(|e| e.to_string())?,
    workflow_id: row.try_get("workflow_id").map_err(|e| e.to_string())?,
    created_at: row.try_get("createdAt").map_err(|e| e.to_string())?,
    updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
  })
}

fn normalize_note_content_to_markdown(raw: &str) -> String {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return String::new();
  }
  let value = match serde_json::from_str::<Value>(trimmed) {
    Ok(value) => value,
    Err(_) => return trimmed.to_string(),
  };
  let markdown = tiptap_node_to_markdown(&value);
  if markdown.trim().is_empty() {
    trimmed.to_string()
  } else {
    markdown.trim().to_string()
  }
}

fn tiptap_node_to_markdown(node: &Value) -> String {
  let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();
  let attrs = node.get("attrs");
  let children = node
    .get("content")
    .and_then(Value::as_array)
    .map(|items| {
      items
        .iter()
        .map(tiptap_node_to_markdown)
        .collect::<Vec<String>>()
    })
    .unwrap_or_default();

  match node_type {
    "doc" => children.join("\n\n"),
    "paragraph" => children.join(""),
    "text" => node
      .get("text")
      .and_then(Value::as_str)
      .unwrap_or_default()
      .to_string(),
    "heading" => {
      let level = attrs
        .and_then(|value| value.get("level"))
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, 6);
      format!("{} {}", "#".repeat(level as usize), children.join(""))
    }
    "bulletList" => children
      .iter()
      .map(|item| prefix_markdown_lines(item, "- "))
      .collect::<Vec<String>>()
      .join("\n"),
    "orderedList" => children
      .iter()
      .enumerate()
      .map(|(index, item)| prefix_markdown_lines(item, &format!("{}. ", index + 1)))
      .collect::<Vec<String>>()
      .join("\n"),
    "listItem" => children.join("\n"),
    "blockquote" => prefix_markdown_lines(&children.join("\n"), "> "),
    "codeBlock" => format!("```\n{}\n```", children.join("")),
    "hardBreak" => String::from("\n"),
    "horizontalRule" => String::from("---"),
    "taskList" => children.join("\n"),
    "taskItem" => {
      let checked = attrs
        .and_then(|value| value.get("checked"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
      let marker = if checked { "- [x] " } else { "- [ ] " };
      prefix_markdown_lines(&children.join(""), marker)
    }
    "mathInline" | "inlineMath" => {
      let text = node.get("text").and_then(Value::as_str).unwrap_or_else(|| {
        node
          .get("value")
          .and_then(Value::as_str)
          .unwrap_or_default()
      });
      format!("${text}$")
    }
    "mathDisplay" | "displayMath" => {
      let text = node.get("text").and_then(Value::as_str).unwrap_or_else(|| {
        node
          .get("value")
          .and_then(Value::as_str)
          .unwrap_or_default()
      });
      format!("$$\n{text}\n$$")
    }
    _ => {
      if children.is_empty() {
        node
          .get("text")
          .and_then(Value::as_str)
          .unwrap_or_default()
          .to_string()
      } else {
        children.join("")
      }
    }
  }
}

fn prefix_markdown_lines(content: &str, prefix: &str) -> String {
  content
    .lines()
    .map(|line| format!("{prefix}{line}"))
    .collect::<Vec<String>>()
    .join("\n")
}

pub async fn get_runtime_setting_row(pool: &SqlitePool) -> Result<RuntimeSettingRow, String> {
  let row = sqlx::query(
    "SELECT provider, base_url, api_key, model_name, ocr_provider, ocr_base_url, ocr_api_key, ocr_model, temperature, thinking_level, paper_filter_prompt, paper_reading_prompt, work_report_prompt FROM runtime_settings WHERE id = 1",
  )
  .fetch_optional(pool)
  .await
  .map_err(|e| e.to_string())?
  .ok_or_else(|| String::from("runtime_settings(id=1) is missing"))?;

  Ok(RuntimeSettingRow {
    provider: row.try_get("provider").map_err(|e| e.to_string())?,
    base_url: row.try_get("base_url").map_err(|e| e.to_string())?,
    api_key: row.try_get("api_key").map_err(|e| e.to_string())?,
    model_name: row.try_get("model_name").map_err(|e| e.to_string())?,
    ocr_provider: row.try_get("ocr_provider").map_err(|e| e.to_string())?,
    ocr_base_url: row.try_get("ocr_base_url").map_err(|e| e.to_string())?,
    ocr_api_key: row.try_get("ocr_api_key").map_err(|e| e.to_string())?,
    ocr_model: row.try_get("ocr_model").map_err(|e| e.to_string())?,
    temperature: row.try_get("temperature").map_err(|e| e.to_string())?,
    thinking_level: row.try_get("thinking_level").map_err(|e| e.to_string())?,
    paper_filter_prompt: row
      .try_get("paper_filter_prompt")
      .map_err(|e| e.to_string())?,
    paper_reading_prompt: row
      .try_get("paper_reading_prompt")
      .map_err(|e| e.to_string())?,
    work_report_prompt: row
      .try_get("work_report_prompt")
      .map_err(|e| e.to_string())?,
  })
}

pub async fn upsert_runtime_setting(
  pool: &SqlitePool,
  input: &RuntimeSettingUpsertInput,
) -> Result<(), String> {
  sqlx::query(
    "INSERT INTO runtime_settings (
      id, provider, base_url, api_key, model_name,
      ocr_provider, ocr_base_url, ocr_api_key, ocr_model,
      thinking_level, temperature,
      paper_filter_prompt, paper_reading_prompt, work_report_prompt
    ) VALUES (
      1, ?1, ?2, ?3, ?4,
      ?5, ?6, ?7, ?8,
      ?9, ?10,
      ?11, ?12, ?13
    )
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      base_url = excluded.base_url,
      api_key = excluded.api_key,
      model_name = excluded.model_name,
      ocr_provider = excluded.ocr_provider,
      ocr_base_url = excluded.ocr_base_url,
      ocr_api_key = excluded.ocr_api_key,
      ocr_model = excluded.ocr_model,
      thinking_level = excluded.thinking_level,
      temperature = excluded.temperature,
      paper_filter_prompt = excluded.paper_filter_prompt,
      paper_reading_prompt = excluded.paper_reading_prompt,
      work_report_prompt = excluded.work_report_prompt,
      updatedAt = CURRENT_TIMESTAMP",
  )
  .bind(&input.provider)
  .bind(&input.base_url)
  .bind(&input.api_key)
  .bind(&input.model_name)
  .bind(&input.ocr_provider)
  .bind(&input.ocr_base_url)
  .bind(&input.ocr_api_key)
  .bind(&input.ocr_model)
  .bind(&input.thinking_level)
  .bind(input.temperature)
  .bind(&input.paper_filter_prompt)
  .bind(&input.paper_reading_prompt)
  .bind(&input.work_report_prompt)
  .execute(pool)
  .await
  .map_err(|e| e.to_string())?;

  Ok(())
}

pub fn to_runtime_setting_dto(row: Option<RuntimeSettingRow>) -> RuntimeSettingDto {
  let mut defaults_applied = Vec::<String>::new();
  let row = row.unwrap_or_else(|| {
    defaults_applied.extend([
      String::from("provider"),
      String::from("base_url"),
      String::from("api_key"),
      String::from("model_name"),
      String::from("ocr_provider"),
      String::from("ocr_base_url"),
      String::from("ocr_api_key"),
      String::from("ocr_model"),
      String::from("thinking_level"),
      String::from("temperature"),
      String::from("paper_filter_prompt"),
      String::from("paper_reading_prompt"),
      String::from("work_report_prompt"),
    ]);
    RuntimeSettingRow {
      provider: String::from("openai compatible"),
      base_url: String::new(),
      api_key: String::new(),
      model_name: String::new(),
      ocr_provider: String::from("mistral_ai"),
      ocr_base_url: None,
      ocr_api_key: None,
      ocr_model: None,
      temperature: Some(0.2),
      thinking_level: Some(String::from("medium")),
      paper_filter_prompt: None,
      paper_reading_prompt: None,
      work_report_prompt: None,
    }
  });

  let paper_filter_prompt = if row
    .paper_filter_prompt
    .as_deref()
    .unwrap_or("")
    .trim()
    .is_empty()
  {
    defaults_applied.push(String::from("paper_filter_prompt"));
    String::from(DEFAULT_PAPER_FILTER_PROMPT)
  } else {
    row.paper_filter_prompt.clone().unwrap_or_default()
  };

  let paper_reading_prompt = if row
    .paper_reading_prompt
    .as_deref()
    .unwrap_or("")
    .trim()
    .is_empty()
  {
    defaults_applied.push(String::from("paper_reading_prompt"));
    String::from(DEFAULT_PAPER_READING_PROMPT)
  } else {
    row.paper_reading_prompt.clone().unwrap_or_default()
  };

  let work_report_prompt = if row
    .work_report_prompt
    .as_deref()
    .unwrap_or("")
    .trim()
    .is_empty()
  {
    defaults_applied.push(String::from("work_report_prompt"));
    String::from(DEFAULT_WORK_REPORT_PROMPT)
  } else {
    row.work_report_prompt.clone().unwrap_or_default()
  };
  let ocr_base_url = if row.ocr_base_url.as_deref().unwrap_or("").trim().is_empty() {
    if !defaults_applied.iter().any(|item| item == "ocr_base_url") {
      defaults_applied.push(String::from("ocr_base_url"));
    }
    String::from(DEFAULT_MISTRAL_OCR_BASE_URL)
  } else {
    row.ocr_base_url.clone().unwrap_or_default()
  };
  let ocr_model = if row.ocr_model.as_deref().unwrap_or("").trim().is_empty() {
    if !defaults_applied.iter().any(|item| item == "ocr_model") {
      defaults_applied.push(String::from("ocr_model"));
    }
    String::from(DEFAULT_MISTRAL_OCR_MODEL)
  } else {
    row.ocr_model.clone().unwrap_or_default()
  };

  RuntimeSettingDto {
    provider: row.provider,
    base_url: row.base_url,
    api_key: row.api_key,
    model_name: row.model_name,
    ocr_provider: row.ocr_provider,
    ocr_base_url,
    ocr_api_key: row.ocr_api_key.unwrap_or_default(),
    ocr_model,
    thinking_level: row.thinking_level.unwrap_or_else(|| String::from("medium")),
    temperature: row.temperature.unwrap_or(0.2),
    paper_filter_prompt,
    paper_reading_prompt,
    work_report_prompt,
    defaults_applied,
  }
}

pub async fn load_rule_list(pool: &SqlitePool) -> Result<String, String> {
  let rows = sqlx::query("SELECT content FROM rules ORDER BY id ASC")
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

  if rows.is_empty() {
    return Ok(String::from("（无自定义规则）"));
  }

  let rules = rows
    .iter()
    .map(|row| row.try_get::<String, _>("content").unwrap_or_default())
    .collect::<Vec<String>>();

  Ok(rules.join("\n"))
}

pub async fn write_llm_log(
  pool: &SqlitePool,
  base_url: &str,
  model: &str,
  prompt: &str,
  output: &str,
  input_token: Option<i64>,
  output_token: Option<i64>,
  temperature: Option<f64>,
  thinking_level: Option<&str>,
) -> Result<(), String> {
  sqlx::query(
    "INSERT INTO llm_invocation_logs (base_url, model, prompt, output, inputToken, outputToken, temperature, thinking_level)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
  )
  .bind(base_url)
  .bind(model)
  .bind(prompt)
  .bind(output)
  .bind(input_token)
  .bind(output_token)
  .bind(temperature)
  .bind(thinking_level)
  .execute(pool)
  .await
  .map_err(|e| e.to_string())?;
  Ok(())
}

pub async fn list_task_history(
  pool: &SqlitePool,
  page: u32,
  page_size: u32,
) -> Result<(i64, i64, i64, Vec<TaskDto>), String> {
  let row = sqlx::query(
    "SELECT
      COUNT(1) AS total,
      COALESCE(SUM(CASE WHEN completedDate IS NULL THEN 1 ELSE 0 END), 0) AS pending_total,
      COALESCE(SUM(CASE WHEN completedDate IS NOT NULL THEN 1 ELSE 0 END), 0) AS completed_total
    FROM tasks",
  )
  .fetch_one(pool)
  .await
  .map_err(|e| e.to_string())?;
  let total: i64 = row.try_get("total").map_err(|e| e.to_string())?;
  let pending_total: i64 = row.try_get("pending_total").map_err(|e| e.to_string())?;
  let completed_total: i64 = row.try_get("completed_total").map_err(|e| e.to_string())?;
  let offset = i64::from(page.saturating_sub(1)) * i64::from(page_size);

  let rows = sqlx::query(
    "SELECT id, title, description, priority, completedDate, createdAt, updatedAt
    FROM tasks
    ORDER BY
      CASE WHEN completedDate IS NULL THEN 0 ELSE 1 END ASC,
      updatedAt DESC,
      id DESC
    LIMIT ?1 OFFSET ?2",
  )
  .bind(i64::from(page_size))
  .bind(offset)
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;

  let mut items = Vec::with_capacity(rows.len());
  for row in rows {
    items.push(TaskDto {
      id: row.try_get("id").map_err(|e| e.to_string())?,
      title: row.try_get("title").map_err(|e| e.to_string())?,
      description: row.try_get("description").map_err(|e| e.to_string())?,
      priority: normalize_task_priority(row.try_get("priority").map_err(|e| e.to_string())?),
      completed_date: row.try_get("completedDate").map_err(|e| e.to_string())?,
      created_at: row.try_get("createdAt").map_err(|e| e.to_string())?,
      updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
    });
  }
  Ok((total, pending_total, completed_total, items))
}

pub async fn create_task(
  pool: &SqlitePool,
  title: &str,
  description: Option<&str>,
  priority: &str,
) -> Result<TaskDto, String> {
  let result = sqlx::query("INSERT INTO tasks (title, description, priority) VALUES (?1, ?2, ?3)")
    .bind(title)
    .bind(description)
    .bind(priority)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  let id = result.last_insert_rowid();
  get_task_by_id(pool, id).await
}

pub async fn update_task(
  pool: &SqlitePool,
  id: i64,
  title: &str,
  description: Option<&str>,
  priority: &str,
) -> Result<TaskDto, String> {
  let result = sqlx::query(
    "UPDATE tasks
    SET title = ?1, description = ?2, priority = ?3, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?4",
  )
  .bind(title)
  .bind(description)
  .bind(priority)
  .bind(id)
  .execute(pool)
  .await
  .map_err(|e| e.to_string())?;
  if result.rows_affected() == 0 {
    return Err(String::from("task not found"));
  }
  get_task_by_id(pool, id).await
}

pub async fn toggle_task_completed(
  pool: &SqlitePool,
  id: i64,
  completed: bool,
) -> Result<TaskDto, String> {
  let result = sqlx::query(
    "UPDATE tasks
    SET
      completedDate = CASE WHEN ?1 THEN CURRENT_TIMESTAMP ELSE NULL END,
      updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?2",
  )
  .bind(completed)
  .bind(id)
  .execute(pool)
  .await
  .map_err(|e| e.to_string())?;
  if result.rows_affected() == 0 {
    return Err(String::from("task not found"));
  }
  get_task_by_id(pool, id).await
}

pub async fn delete_task(pool: &SqlitePool, id: i64) -> Result<(), String> {
  sqlx::query("DELETE FROM tasks WHERE id = ?1")
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  Ok(())
}

async fn get_task_by_id(pool: &SqlitePool, id: i64) -> Result<TaskDto, String> {
  let row = sqlx::query(
    "SELECT id, title, description, priority, completedDate, createdAt, updatedAt
    FROM tasks
    WHERE id = ?1",
  )
  .bind(id)
  .fetch_optional(pool)
  .await
  .map_err(|e| e.to_string())?
  .ok_or_else(|| String::from("task not found"))?;

  Ok(TaskDto {
    id: row.try_get("id").map_err(|e| e.to_string())?,
    title: row.try_get("title").map_err(|e| e.to_string())?,
    description: row.try_get("description").map_err(|e| e.to_string())?,
    priority: normalize_task_priority(row.try_get("priority").map_err(|e| e.to_string())?),
    completed_date: row.try_get("completedDate").map_err(|e| e.to_string())?,
    created_at: row.try_get("createdAt").map_err(|e| e.to_string())?,
    updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
  })
}

fn normalize_task_priority(value: String) -> String {
  let normalized = value.trim().to_ascii_lowercase();
  match normalized.as_str() {
    "low" => String::from("low"),
    "medium" | "meidum" => String::from("medium"),
    "high" => String::from("high"),
    _ => String::from("medium"),
  }
}

pub async fn list_rules(pool: &SqlitePool) -> Result<Vec<RuleDto>, String> {
  let rows = sqlx::query("SELECT id, content, createdAt, updatedAt FROM rules ORDER BY id DESC")
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

  let mut items = Vec::with_capacity(rows.len());
  for row in rows {
    items.push(RuleDto {
      id: row.try_get("id").map_err(|e| e.to_string())?,
      content: row.try_get("content").map_err(|e| e.to_string())?,
      created_at: row.try_get("createdAt").map_err(|e| e.to_string())?,
      updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
    });
  }
  Ok(items)
}

pub async fn create_rule(pool: &SqlitePool, content: &str) -> Result<RuleDto, String> {
  let result = sqlx::query("INSERT INTO rules (content) VALUES (?1)")
    .bind(content)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  let id = result.last_insert_rowid();
  get_rule_by_id(pool, id).await
}

pub async fn update_rule(pool: &SqlitePool, id: i64, content: &str) -> Result<RuleDto, String> {
  let result =
    sqlx::query("UPDATE rules SET content = ?1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?2")
      .bind(content)
      .bind(id)
      .execute(pool)
      .await
      .map_err(|e| e.to_string())?;
  if result.rows_affected() == 0 {
    return Err(String::from("rule not found"));
  }
  get_rule_by_id(pool, id).await
}

pub async fn delete_rule(pool: &SqlitePool, id: i64) -> Result<(), String> {
  sqlx::query("DELETE FROM rules WHERE id = ?1")
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  Ok(())
}

async fn get_rule_by_id(pool: &SqlitePool, id: i64) -> Result<RuleDto, String> {
  let row = sqlx::query("SELECT id, content, createdAt, updatedAt FROM rules WHERE id = ?1")
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| String::from("rule not found"))?;
  Ok(RuleDto {
    id: row.try_get("id").map_err(|e| e.to_string())?,
    content: row.try_get("content").map_err(|e| e.to_string())?,
    created_at: row.try_get("createdAt").map_err(|e| e.to_string())?,
    updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
  })
}

pub async fn list_note_history(
  pool: &SqlitePool,
  page: u32,
  page_size: u32,
  query: Option<&str>,
) -> Result<(i64, Vec<NoteListItemDto>), String> {
  let keyword = query.map(|value| format!("%{}%", value.trim()));
  let (count_sql, list_sql) = if keyword.is_some() {
    (
      "SELECT COUNT(1) AS total FROM notes WHERE title LIKE ?1",
      "SELECT id, title, createdAt, updatedAt
      FROM notes
      WHERE title LIKE ?1
      ORDER BY updatedAt DESC, id DESC
      LIMIT ?2 OFFSET ?3",
    )
  } else {
    (
      "SELECT COUNT(1) AS total FROM notes",
      "SELECT id, title, createdAt, updatedAt
      FROM notes
      ORDER BY updatedAt DESC, id DESC
      LIMIT ?1 OFFSET ?2",
    )
  };

  let total_row = if let Some(keyword) = &keyword {
    sqlx::query(count_sql)
      .bind(keyword)
      .fetch_one(pool)
      .await
      .map_err(|e| e.to_string())?
  } else {
    sqlx::query(count_sql)
      .fetch_one(pool)
      .await
      .map_err(|e| e.to_string())?
  };
  let total: i64 = total_row.try_get("total").map_err(|e| e.to_string())?;
  let offset = i64::from(page.saturating_sub(1)) * i64::from(page_size);

  let rows = if let Some(keyword) = &keyword {
    sqlx::query(list_sql)
      .bind(keyword)
      .bind(i64::from(page_size))
      .bind(offset)
      .fetch_all(pool)
      .await
      .map_err(|e| e.to_string())?
  } else {
    sqlx::query(list_sql)
      .bind(i64::from(page_size))
      .bind(offset)
      .fetch_all(pool)
      .await
      .map_err(|e| e.to_string())?
  };

  let mut items = Vec::with_capacity(rows.len());
  for row in rows {
    items.push(NoteListItemDto {
      id: row.try_get("id").map_err(|e| e.to_string())?,
      title: row.try_get("title").map_err(|e| e.to_string())?,
      created_at: row.try_get("createdAt").map_err(|e| e.to_string())?,
      updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
    });
  }
  Ok((total, items))
}

pub async fn create_note(pool: &SqlitePool) -> Result<NoteDetailDto, String> {
  let title = next_untitled_note_title(pool).await?;
  let initial_content = String::from(r#"{"type":"doc","content":[{"type":"paragraph"}]}"#);
  let result = sqlx::query("INSERT INTO notes (title, content) VALUES (?1, ?2)")
    .bind(&title)
    .bind(initial_content)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  let id = result.last_insert_rowid();
  get_note_detail_by_id(pool, id).await
}

pub async fn delete_note(pool: &SqlitePool, id: i64) -> Result<(), String> {
  sqlx::query("DELETE FROM notes WHERE id = ?1")
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  Ok(())
}

pub async fn get_note_detail_by_id(pool: &SqlitePool, id: i64) -> Result<NoteDetailDto, String> {
  let row = sqlx::query("SELECT id, title, content, createdAt, updatedAt FROM notes WHERE id = ?1")
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| String::from("note not found"))?;

  Ok(NoteDetailDto {
    id: row.try_get("id").map_err(|e| e.to_string())?,
    title: row.try_get("title").map_err(|e| e.to_string())?,
    content: row.try_get("content").map_err(|e| e.to_string())?,
    created_at: row.try_get("createdAt").map_err(|e| e.to_string())?,
    updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
  })
}

pub async fn update_note_content_and_links(
  pool: &SqlitePool,
  id: i64,
  title: &str,
  content: &str,
  links: &[NoteLinkRefInput],
) -> Result<NoteDetailDto, String> {
  ensure_note_links_schema(pool).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  let result = sqlx::query(
    "UPDATE notes
    SET title = ?1, content = ?2, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?3",
  )
  .bind(title)
  .bind(content)
  .bind(id)
  .execute(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;
  if result.rows_affected() == 0 {
    return Err(String::from("note not found"));
  }

  sqlx::query("DELETE FROM note_links WHERE note_id = ?1")
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

  let mut seen: HashSet<(String, String)> = HashSet::new();
  for link in links {
    let Some(raw_target) = link.ref_id.as_deref() else {
      continue;
    };
    let target = raw_target.trim();
    if target.is_empty() {
      continue;
    }
    let key = (link.ref_type.clone(), target.to_string());
    if seen.contains(&key) {
      continue;
    }
    seen.insert(key);

    match link.ref_type.as_str() {
      "paper" => {
        sqlx::query(
          "INSERT INTO note_links (note_id, link_type, target_paper_id) VALUES (?1, 'linked_paper', ?2)",
        )
        .bind(id)
        .bind(target)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
      }
      "task" => {
        let target_task_id: i64 = target
          .parse()
          .map_err(|_| String::from("invalid task link target"))?;
        sqlx::query(
          "INSERT INTO note_links (note_id, link_type, target_task_id) VALUES (?1, 'linked_task', ?2)",
        )
        .bind(id)
        .bind(target_task_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
      }
      "note" => {
        let target_note_id: i64 = target
          .parse()
          .map_err(|_| String::from("invalid note link target"))?;
        if target_note_id == id {
          continue;
        }
        sqlx::query(
          "INSERT INTO note_links (note_id, link_type, target_note_id) VALUES (?1, 'linked_note', ?2)",
        )
        .bind(id)
        .bind(target_note_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
      }
      "work_report" => {
        sqlx::query(
          "INSERT INTO note_links (note_id, link_type, target_work_report_date) VALUES (?1, 'linked_work_report', ?2)",
        )
        .bind(id)
        .bind(target)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
      }
      _ => {}
    }
  }

  tx.commit().await.map_err(|e| e.to_string())?;
  get_note_detail_by_id(pool, id).await
}

pub async fn get_note_linked_context_by_id(
  pool: &SqlitePool,
  id: i64,
) -> Result<NoteLinkedContextDto, String> {
  ensure_note_links_schema(pool).await?;
  let paper_rows = sqlx::query(
    "SELECT p.id AS paper_id, p.title, EXISTS (SELECT 1 FROM paper_reports pr WHERE pr.paper_id = p.id) AS has_report
    FROM note_links nl
    INNER JOIN papers p ON p.id = nl.target_paper_id
    WHERE nl.note_id = ?1 AND nl.link_type = 'linked_paper'
    ORDER BY p.id DESC",
  )
  .bind(id)
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;

  let task_rows = sqlx::query(
    "SELECT t.id AS task_id, t.title, t.description, t.priority, t.completedDate, t.updatedAt
    FROM note_links nl
    INNER JOIN tasks t ON t.id = nl.target_task_id
    WHERE nl.note_id = ?1 AND nl.link_type = 'linked_task'
    ORDER BY t.updatedAt DESC, t.id DESC",
  )
  .bind(id)
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;

  let note_rows = sqlx::query(
    "SELECT n.id AS note_id, n.title, n.updatedAt
    FROM note_links nl
    INNER JOIN notes n ON n.id = nl.target_note_id
    WHERE nl.note_id = ?1 AND nl.link_type = 'linked_note'
    ORDER BY n.updatedAt DESC, n.id DESC",
  )
  .bind(id)
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;
  let work_report_rows = sqlx::query(
    "SELECT wr.id AS report_id, wr.endDate AS report_date, wr.startDate, wr.updatedAt
    FROM note_links nl
    INNER JOIN work_reports wr ON wr.endDate = nl.target_work_report_date
    WHERE nl.note_id = ?1 AND nl.link_type = 'linked_work_report'
    ORDER BY wr.endDate DESC, wr.id DESC",
  )
  .bind(id)
  .fetch_all(pool)
  .await
  .map_err(|e| e.to_string())?;

  let papers = paper_rows
    .iter()
    .map(|row| -> Result<NotePaperLinkDto, String> {
      let paper_id: String = row.try_get("paper_id").map_err(|e| e.to_string())?;
      Ok(NotePaperLinkDto {
        arxiv_url: format!("https://arxiv.org/abs/{paper_id}"),
        paper_id,
        title: row.try_get("title").map_err(|e| e.to_string())?,
        has_report: row
          .try_get::<i64, _>("has_report")
          .map_err(|e| e.to_string())?
          > 0,
      })
    })
    .collect::<Result<Vec<_>, _>>()?;
  let tasks = task_rows
    .iter()
    .map(|row| -> Result<NoteTaskLinkDto, String> {
      Ok(NoteTaskLinkDto {
        task_id: row.try_get("task_id").map_err(|e| e.to_string())?,
        title: row.try_get("title").map_err(|e| e.to_string())?,
        description: row.try_get("description").map_err(|e| e.to_string())?,
        priority: normalize_task_priority(row.try_get("priority").map_err(|e| e.to_string())?),
        completed_date: row.try_get("completedDate").map_err(|e| e.to_string())?,
        updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
      })
    })
    .collect::<Result<Vec<_>, _>>()?;
  let notes = note_rows
    .iter()
    .map(|row| -> Result<NoteRefNoteDto, String> {
      Ok(NoteRefNoteDto {
        note_id: row.try_get("note_id").map_err(|e| e.to_string())?,
        title: row.try_get("title").map_err(|e| e.to_string())?,
        updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
      })
    })
    .collect::<Result<Vec<_>, _>>()?;
  let work_reports = work_report_rows
    .iter()
    .map(|row| -> Result<NoteWorkReportLinkDto, String> {
      Ok(NoteWorkReportLinkDto {
        report_id: row.try_get("report_id").map_err(|e| e.to_string())?,
        report_date: row.try_get("report_date").map_err(|e| e.to_string())?,
        start_date: row.try_get("startDate").map_err(|e| e.to_string())?,
        updated_at: row.try_get("updatedAt").map_err(|e| e.to_string())?,
      })
    })
    .collect::<Result<Vec<_>, _>>()?;

  Ok(NoteLinkedContextDto {
    papers,
    tasks,
    notes,
    work_reports,
  })
}

pub async fn search_note_paper_options(
  pool: &SqlitePool,
  query: Option<&str>,
  limit: u32,
) -> Result<Vec<NotePaperOptionDto>, String> {
  let keyword = query
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(|value| format!("%{value}%"));
  let rows = if let Some(keyword) = keyword {
    sqlx::query(
      "SELECT p.id AS paper_id, p.title,
      EXISTS (SELECT 1 FROM paper_reports pr WHERE pr.paper_id = p.id) AS has_report
      FROM papers p
      WHERE p.id LIKE ?1 OR p.title LIKE ?1
      ORDER BY p.updatedAt DESC, p.id DESC
      LIMIT ?2",
    )
    .bind(keyword)
    .bind(i64::from(limit))
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
  } else {
    sqlx::query(
      "SELECT p.id AS paper_id, p.title,
      EXISTS (SELECT 1 FROM paper_reports pr WHERE pr.paper_id = p.id) AS has_report
      FROM papers p
      ORDER BY p.updatedAt DESC, p.id DESC
      LIMIT ?1",
    )
    .bind(i64::from(limit))
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
  };
  rows
    .iter()
    .map(|row| -> Result<NotePaperOptionDto, String> {
      Ok(NotePaperOptionDto {
        paper_id: row.try_get("paper_id").map_err(|e| e.to_string())?,
        title: row.try_get("title").map_err(|e| e.to_string())?,
        has_report: row
          .try_get::<i64, _>("has_report")
          .map_err(|e| e.to_string())?
          > 0,
      })
    })
    .collect()
}

pub async fn search_note_work_report_options(
  pool: &SqlitePool,
  query: Option<&str>,
  limit: u32,
) -> Result<Vec<NoteWorkReportOptionDto>, String> {
  let keyword = query
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(|value| format!("%{value}%"));
  let rows = if let Some(keyword) = keyword {
    sqlx::query(
      "SELECT id AS report_id, endDate AS report_date, startDate
      FROM work_reports
      WHERE endDate LIKE ?1
      ORDER BY endDate DESC
      LIMIT ?2",
    )
    .bind(keyword)
    .bind(i64::from(limit))
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
  } else {
    sqlx::query(
      "SELECT id AS report_id, endDate AS report_date, startDate
      FROM work_reports
      ORDER BY endDate DESC
      LIMIT ?1",
    )
    .bind(i64::from(limit))
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
  };

  rows
    .iter()
    .map(|row| -> Result<NoteWorkReportOptionDto, String> {
      Ok(NoteWorkReportOptionDto {
        report_id: row.try_get("report_id").map_err(|e| e.to_string())?,
        report_date: row.try_get("report_date").map_err(|e| e.to_string())?,
        start_date: row.try_get("startDate").map_err(|e| e.to_string())?,
      })
    })
    .collect()
}

async fn next_untitled_note_title(pool: &SqlitePool) -> Result<String, String> {
  let rows =
    sqlx::query("SELECT title FROM notes WHERE title = '未命名笔记' OR title LIKE '未命名笔记 %'")
      .fetch_all(pool)
      .await
      .map_err(|e| e.to_string())?;
  let mut used = HashSet::new();
  for row in rows {
    let title: String = row.try_get("title").map_err(|e| e.to_string())?;
    if title == "未命名笔记" {
      used.insert(1_i64);
      continue;
    }
    if let Some(suffix) = title.strip_prefix("未命名笔记 ") {
      if let Ok(index) = suffix.trim().parse::<i64>() {
        if index >= 2 {
          used.insert(index);
        }
      }
    }
  }
  if !used.contains(&1) {
    return Ok(String::from("未命名笔记"));
  }
  let mut current = 2_i64;
  while used.contains(&current) {
    current += 1;
  }
  Ok(format!("未命名笔记 {current}"))
}

async fn ensure_note_links_schema(pool: &SqlitePool) -> Result<(), String> {
  sqlx::query(
    "CREATE TABLE IF NOT EXISTS note_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL,
      link_type TEXT NOT NULL CHECK (link_type IN ('linked_paper', 'linked_task', 'linked_note', 'linked_work_report')),
      target_paper_id TEXT,
      target_task_id INTEGER,
      target_note_id INTEGER,
      target_work_report_date TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
      FOREIGN KEY (target_paper_id) REFERENCES papers (id) ON DELETE CASCADE,
      FOREIGN KEY (target_task_id) REFERENCES tasks (id) ON DELETE CASCADE,
      FOREIGN KEY (target_note_id) REFERENCES notes (id) ON DELETE CASCADE,
      FOREIGN KEY (target_work_report_date) REFERENCES work_reports (endDate) ON DELETE CASCADE,
      CHECK (
        (CASE WHEN target_paper_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN target_task_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN target_note_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN target_work_report_date IS NOT NULL THEN 1 ELSE 0 END) = 1
      )
    )",
  )
  .execute(pool)
  .await
  .map_err(|e| e.to_string())?;

  sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_paper ON note_links (note_id, link_type, target_paper_id) WHERE target_paper_id IS NOT NULL")
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_task ON note_links (note_id, link_type, target_task_id) WHERE target_task_id IS NOT NULL")
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_note ON note_links (note_id, link_type, target_note_id) WHERE target_note_id IS NOT NULL")
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_work_report ON note_links (note_id, link_type, target_work_report_date) WHERE target_work_report_date IS NOT NULL")
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  sqlx::query("CREATE INDEX IF NOT EXISTS idx_note_links_note_id ON note_links (note_id)")
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
  Ok(())
}
