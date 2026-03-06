use crate::{
  db::{
    find_today_running_workflow, find_today_work_report, find_today_workflow_row,
    get_runtime_setting_row, get_work_report_detail_by_id, get_workflow_payload,
    insert_workflow_running, list_work_report_history, load_behavior_snapshot,
    load_current_behavior_snapshot, save_work_report_result, save_workflow,
  },
  llm::call_llm,
  state::{
    now_rfc3339, today_key, AppState, DEFAULT_WORK_REPORT_PROMPT,
    DEFAULT_WORK_REPORT_SYSTEM_PROMPT, WORK_REPORT_WORKFLOW_NAME,
  },
  types::{
    BehaviorSnapshotComment, BehaviorSnapshotDto, BehaviorSnapshotNote, BehaviorSnapshotTask,
    StartWorkflowResponse, WorkReportDeltaStats, WorkReportDetailDto, WorkReportHistoryResponse,
    WorkReportOverviewResponse,
  },
};
use serde_json::{json, Value};
use similar::{Algorithm, TextDiff};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Clone)]
struct WorkReportDelta {
  stats: WorkReportDeltaStats,
  new_tasks: Vec<BehaviorSnapshotTask>,
  completed_tasks: Vec<BehaviorSnapshotTask>,
  new_comments: Vec<BehaviorSnapshotComment>,
  updated_comments: Vec<CommentChange>,
  new_notes: Vec<BehaviorSnapshotNote>,
  updated_notes: Vec<NoteChange>,
}

#[derive(Debug, Clone)]
struct CommentChange {
  paper_id: String,
  paper_title: String,
  paper_summary: String,
  old_comment: String,
  new_comment: String,
}

#[derive(Debug, Clone)]
struct NoteChange {
  note_id: i64,
  title: String,
  old_content: String,
  new_content: String,
}

#[tauri::command]
pub async fn get_today_work_report_overview(
  state: State<'_, AppState>,
) -> Result<WorkReportOverviewResponse, String> {
  let day_key = today_key();
  let current_snapshot = load_current_behavior_snapshot(&state.pool).await?;
  let previous_snapshot = load_behavior_snapshot(&state.pool).await?;
  let delta = compute_delta(previous_snapshot.as_ref(), &current_snapshot);

  if let Some((report_id, workflow_id, updated_at)) =
    find_today_work_report(&state.pool, &day_key).await?
  {
    return Ok(WorkReportOverviewResponse {
      day_key,
      status: String::from("ready"),
      can_trigger: false,
      block_reason: Some(String::from("当天已有工作日报")),
      workflow_id,
      report_id: Some(report_id),
      report_updated_at: Some(updated_at),
      stats: delta.stats,
    });
  }

  if let Some((workflow_id, stage, error)) =
    find_today_workflow_row(&state.pool, WORK_REPORT_WORKFLOW_NAME, &day_key).await?
  {
    let can_trigger = stage == "failed" && has_any_delta(&delta.stats);
    return Ok(WorkReportOverviewResponse {
      day_key,
      status: stage,
      can_trigger,
      block_reason: if can_trigger {
        None
      } else if error.is_some() {
        error
      } else {
        Some(String::from("工作流正在执行中"))
      },
      workflow_id: Some(workflow_id),
      report_id: None,
      report_updated_at: None,
      stats: delta.stats,
    });
  }

  let can_trigger = has_any_delta(&delta.stats);
  Ok(WorkReportOverviewResponse {
    day_key,
    status: String::from("none"),
    can_trigger,
    block_reason: if can_trigger {
      None
    } else {
      Some(String::from("当前无可汇总的行为增量"))
    },
    workflow_id: None,
    report_id: None,
    report_updated_at: None,
    stats: delta.stats,
  })
}

#[tauri::command]
pub async fn start_work_report_workflow(
  state: State<'_, AppState>,
) -> Result<StartWorkflowResponse, String> {
  let day_key = today_key();

  if let Some((_, workflow_id, _)) = find_today_work_report(&state.pool, &day_key).await? {
    if let Some(workflow_id) = workflow_id {
      return Ok(StartWorkflowResponse {
        workflow_id,
        reused: true,
      });
    }
    return Err(String::from("today work report already exists"));
  }

  if let Some(workflow_id) =
    find_today_running_workflow(&state.pool, WORK_REPORT_WORKFLOW_NAME, &day_key).await?
  {
    return Ok(StartWorkflowResponse {
      workflow_id,
      reused: true,
    });
  }

  let current_snapshot = load_current_behavior_snapshot(&state.pool).await?;
  let previous_snapshot = load_behavior_snapshot(&state.pool).await?;
  let delta = compute_delta(previous_snapshot.as_ref(), &current_snapshot);
  if !has_any_delta(&delta.stats) {
    return Err(String::from("no activity delta found"));
  }

  let workflow_id =
    insert_workflow_running(&state.pool, WORK_REPORT_WORKFLOW_NAME, &day_key).await?;

  let pool = state.pool.clone();
  let http = state.http.clone();
  tauri::async_runtime::spawn(async move {
    let run_result = run_work_report_workflow(&pool, &http, workflow_id, &day_key).await;
    if let Err(error) = run_result {
      let mut payload = get_workflow_payload(&pool, workflow_id)
        .await
        .unwrap_or_else(|_| json!({}));
      payload["finishedAt"] = Value::String(now_rfc3339());
      payload["error"] = Value::String(error.clone());
      let _ = save_workflow(&pool, workflow_id, "failed", Some(&error), &payload).await;
    }
  });

  Ok(StartWorkflowResponse {
    workflow_id,
    reused: false,
  })
}

#[tauri::command]
pub async fn get_work_report_history(
  state: State<'_, AppState>,
  page: Option<u32>,
) -> Result<WorkReportHistoryResponse, String> {
  let safe_page = page.unwrap_or(1).max(1);
  let page_size = 10_u32;
  let (total, items) = list_work_report_history(&state.pool, safe_page, page_size).await?;
  Ok(WorkReportHistoryResponse {
    page: safe_page,
    page_size,
    total,
    items,
  })
}

#[tauri::command]
pub async fn get_work_report_detail(
  state: State<'_, AppState>,
  report_id: i64,
) -> Result<WorkReportDetailDto, String> {
  get_work_report_detail_by_id(&state.pool, report_id).await
}

async fn run_work_report_workflow(
  pool: &sqlx::SqlitePool,
  http: &reqwest::Client,
  workflow_id: i64,
  day_key: &str,
) -> Result<(), String> {
  let mut payload = get_workflow_payload(pool, workflow_id).await?;
  payload["startedAt"] = Value::String(now_rfc3339());
  save_workflow(pool, workflow_id, "running", None, &payload).await?;

  let current_snapshot = load_current_behavior_snapshot(pool).await?;
  let previous_snapshot = load_behavior_snapshot(pool).await?;
  let delta = compute_delta(previous_snapshot.as_ref(), &current_snapshot);

  if !has_any_delta(&delta.stats) {
    return Err(String::from("no activity delta found"));
  }

  let start_date = previous_snapshot
    .as_ref()
    .and_then(|snapshot| snapshot.updated_at.as_ref())
    .and_then(|ts| ts.get(..10))
    .unwrap_or(day_key)
    .to_string();
  let source_date = previous_snapshot
    .as_ref()
    .and_then(|snapshot| snapshot.updated_at.clone())
    .unwrap_or_else(|| format!("{day_key}T00:00:00+08:00"));

  let activity_markdown = build_activity_markdown(&delta);
  payload["statistics"] = serde_json::to_value(&delta.stats).unwrap_or_else(|_| json!({}));
  payload["activityChars"] = json!(activity_markdown.chars().count());

  let runtime_setting = get_runtime_setting_row(pool).await?;
  let prompt_template = runtime_setting
    .work_report_prompt
    .clone()
    .filter(|v| !v.trim().is_empty())
    .unwrap_or_else(|| String::from(DEFAULT_WORK_REPORT_PROMPT));

  let user_prompt = prompt_template
    .replace("{{BUSINESS_DATE}}", day_key)
    .replace("{{SOURCE_DATE}}", &source_date)
    .replace("{{ACTIVITY_MARKDOWN}}", &activity_markdown);

  let report = call_llm(
    pool,
    http,
    &runtime_setting,
    DEFAULT_WORK_REPORT_SYSTEM_PROMPT,
    &user_prompt,
    None,
  )
  .await?;

  let report_id = save_work_report_result(
    pool,
    workflow_id,
    &report,
    &delta.stats,
    &start_date,
    day_key,
    &current_snapshot,
  )
  .await?;

  payload["reportId"] = json!(report_id);
  payload["finishedAt"] = Value::String(now_rfc3339());
  save_workflow(pool, workflow_id, "success", None, &payload).await
}

fn compute_delta(
  previous: Option<&BehaviorSnapshotDto>,
  current: &BehaviorSnapshotDto,
) -> WorkReportDelta {
  let mut previous_task_map = HashMap::<i64, &BehaviorSnapshotTask>::new();
  let mut previous_comment_map = HashMap::<String, &BehaviorSnapshotComment>::new();
  let mut previous_note_map = HashMap::<i64, &BehaviorSnapshotNote>::new();

  if let Some(prev) = previous {
    for task in &prev.tasks {
      previous_task_map.insert(task.id, task);
    }
    for comment in &prev.comments {
      previous_comment_map.insert(comment.paper_id.clone(), comment);
    }
    for note in &prev.notes {
      previous_note_map.insert(note.id, note);
    }
  }

  let mut new_tasks = Vec::new();
  let mut completed_tasks = Vec::new();
  let mut new_comments = Vec::new();
  let mut updated_comments = Vec::new();
  let mut new_notes = Vec::new();
  let mut updated_notes = Vec::new();

  for task in &current.tasks {
    if let Some(prev_task) = previous_task_map.get(&task.id) {
      if prev_task.completed_date.is_none() && task.completed_date.is_some() {
        completed_tasks.push(task.clone());
      }
    } else {
      new_tasks.push(task.clone());
      if task.completed_date.is_some() {
        completed_tasks.push(task.clone());
      }
    }
  }

  for comment in &current.comments {
    if let Some(prev_comment) = previous_comment_map.get(&comment.paper_id) {
      if prev_comment.comment.trim() != comment.comment.trim() {
        updated_comments.push(CommentChange {
          paper_id: comment.paper_id.clone(),
          paper_title: comment.paper_title.clone(),
          paper_summary: comment.paper_summary.clone(),
          old_comment: prev_comment.comment.clone(),
          new_comment: comment.comment.clone(),
        });
      }
    } else {
      new_comments.push(comment.clone());
    }
  }

  for note in &current.notes {
    if let Some(prev_note) = previous_note_map.get(&note.id) {
      if prev_note.content.trim() != note.content.trim() {
        updated_notes.push(NoteChange {
          note_id: note.id,
          title: note.title.clone(),
          old_content: prev_note.content.clone(),
          new_content: note.content.clone(),
        });
      }
    } else {
      new_notes.push(note.clone());
    }
  }

  let stats = WorkReportDeltaStats {
    new_tasks: new_tasks.len() as i64,
    completed_tasks: completed_tasks.len() as i64,
    new_comments: new_comments.len() as i64,
    updated_comments: updated_comments.len() as i64,
    new_notes: new_notes.len() as i64,
    updated_notes: updated_notes.len() as i64,
  };

  WorkReportDelta {
    stats,
    new_tasks,
    completed_tasks,
    new_comments,
    updated_comments,
    new_notes,
    updated_notes,
  }
}

fn has_any_delta(stats: &WorkReportDeltaStats) -> bool {
  stats.new_tasks > 0
    || stats.completed_tasks > 0
    || stats.new_comments > 0
    || stats.updated_comments > 0
    || stats.new_notes > 0
    || stats.updated_notes > 0
}

fn build_activity_markdown(delta: &WorkReportDelta) -> String {
  let mut sections = Vec::<String>::new();

  if !delta.new_tasks.is_empty() {
    let lines = delta
      .new_tasks
      .iter()
      .map(|task| format!("- #{} {} [{}]", task.id, task.title, task.priority))
      .collect::<Vec<_>>()
      .join("\n");
    sections.push(format!("## 新创建任务\n{lines}"));
  }

  if !delta.completed_tasks.is_empty() {
    let lines = delta
      .completed_tasks
      .iter()
      .map(|task| format!("- #{} {}", task.id, task.title))
      .collect::<Vec<_>>()
      .join("\n");
    sections.push(format!("## 新完成任务\n{lines}"));
  }

  if !delta.new_comments.is_empty() {
    let lines = delta
      .new_comments
      .iter()
      .map(|item| {
        format!(
          "- {} | {}\n\n摘要：{}\n\n{}",
          item.paper_id,
          item.paper_title,
          item.paper_summary,
          truncate_for_prompt(&item.comment, 1200)
        )
      })
      .collect::<Vec<_>>()
      .join("\n\n");
    sections.push(format!("## 新增评论\n{lines}"));
  }

  if !delta.updated_comments.is_empty() {
    let lines = delta
      .updated_comments
      .iter()
      .map(|item| {
        format!(
          "- {} | {}\n\n摘要：{}\n\n```diff\n{}\n```",
          item.paper_id,
          item.paper_title,
          item.paper_summary,
          unified_diff(
            "a/comment.md",
            "b/comment.md",
            &item.old_comment,
            &item.new_comment
          )
        )
      })
      .collect::<Vec<_>>()
      .join("\n\n");
    sections.push(format!("## 修改评论\n{lines}"));
  }

  if !delta.new_notes.is_empty() {
    let lines = delta
      .new_notes
      .iter()
      .map(|note| format!("- #{} {}\n\n{}", note.id, note.title, note.content))
      .collect::<Vec<_>>()
      .join("\n\n");
    sections.push(format!("## 新建笔记\n{lines}"));
  }

  if !delta.updated_notes.is_empty() {
    let lines = delta
      .updated_notes
      .iter()
      .map(|note| {
        format!(
          "- #{} {}\n\n```diff\n{}\n```",
          note.note_id,
          note.title,
          unified_diff(
            "a/note.md",
            "b/note.md",
            &note.old_content,
            &note.new_content
          )
        )
      })
      .collect::<Vec<_>>()
      .join("\n\n");
    sections.push(format!("## 修改笔记\n{lines}"));
  }

  if sections.is_empty() {
    return String::from("## 用户行为汇总\n- 无增量");
  }

  sections.join("\n\n")
}

fn unified_diff(old_label: &str, new_label: &str, old_value: &str, new_value: &str) -> String {
  let diff = TextDiff::configure()
    .algorithm(Algorithm::Myers)
    .diff_lines(old_value, new_value);
  let text = diff
    .unified_diff()
    .context_radius(3)
    .header(old_label, new_label)
    .to_string();
  if text.trim().is_empty() {
    String::from("(no diff)")
  } else {
    text
  }
}

fn truncate_for_prompt(text: &str, max_chars: usize) -> String {
  if text.chars().count() <= max_chars {
    return text.to_string();
  }
  let mut out = text.chars().take(max_chars).collect::<String>();
  out.push_str("\n... (truncated)");
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn compute_delta_should_include_all_rules() {
    let previous = BehaviorSnapshotDto {
      tasks: vec![BehaviorSnapshotTask {
        id: 1,
        title: String::from("a"),
        description: None,
        priority: String::from("medium"),
        completed_date: None,
      }],
      comments: vec![BehaviorSnapshotComment {
        paper_id: String::from("2501.00001"),
        comment: String::from("old"),
        paper_title: String::from("t1"),
        paper_summary: String::from("s1"),
      }],
      notes: vec![BehaviorSnapshotNote {
        id: 1,
        title: String::from("n1"),
        content: String::from("v1"),
      }],
      updated_at: Some(String::from("2026-03-06T08:00:00+08:00")),
    };

    let current = BehaviorSnapshotDto {
      tasks: vec![
        BehaviorSnapshotTask {
          id: 1,
          title: String::from("a"),
          description: None,
          priority: String::from("medium"),
          completed_date: Some(String::from("2026-03-07T08:00:00+08:00")),
        },
        BehaviorSnapshotTask {
          id: 2,
          title: String::from("b"),
          description: None,
          priority: String::from("high"),
          completed_date: None,
        },
      ],
      comments: vec![
        BehaviorSnapshotComment {
          paper_id: String::from("2501.00001"),
          comment: String::from("new"),
          paper_title: String::from("t1"),
          paper_summary: String::from("s1"),
        },
        BehaviorSnapshotComment {
          paper_id: String::from("2501.00002"),
          comment: String::from("c2"),
          paper_title: String::from("t2"),
          paper_summary: String::from("s2"),
        },
      ],
      notes: vec![
        BehaviorSnapshotNote {
          id: 1,
          title: String::from("n1"),
          content: String::from("v2"),
        },
        BehaviorSnapshotNote {
          id: 2,
          title: String::from("n2"),
          content: String::from("new note"),
        },
      ],
      updated_at: None,
    };

    let delta = compute_delta(Some(&previous), &current);
    assert_eq!(delta.stats.new_tasks, 1);
    assert_eq!(delta.stats.completed_tasks, 1);
    assert_eq!(delta.stats.new_comments, 1);
    assert_eq!(delta.stats.updated_comments, 1);
    assert_eq!(delta.stats.new_notes, 1);
    assert_eq!(delta.stats.updated_notes, 1);
  }

  #[test]
  fn compute_delta_first_snapshot_should_be_all_new() {
    let current = BehaviorSnapshotDto {
      tasks: vec![BehaviorSnapshotTask {
        id: 1,
        title: String::from("a"),
        description: None,
        priority: String::from("medium"),
        completed_date: None,
      }],
      comments: vec![],
      notes: vec![BehaviorSnapshotNote {
        id: 1,
        title: String::from("note"),
        content: String::from("body"),
      }],
      updated_at: None,
    };

    let delta = compute_delta(None, &current);
    assert_eq!(delta.stats.new_tasks, 1);
    assert_eq!(delta.stats.new_notes, 1);
    assert_eq!(delta.stats.updated_notes, 0);
  }

  #[test]
  fn compute_delta_no_change_should_be_empty() {
    let snapshot = BehaviorSnapshotDto {
      tasks: vec![],
      comments: vec![],
      notes: vec![],
      updated_at: Some(String::from("2026-03-06T08:00:00+08:00")),
    };

    let delta = compute_delta(Some(&snapshot), &snapshot);
    assert!(!has_any_delta(&delta.stats));
  }
}
