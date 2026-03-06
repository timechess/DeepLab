# Backend Commands & Contracts

## Workflow Commands

- `start_paper_recommendation_workflow()`
  - 返回: `{ workflowId, reused }`
  - 作用: 启动或复用当日工作流

- `get_today_paper_recommendation()`
  - 返回: `{ dayKey, status, summary?, papers?, workflowId?, error? }`
  - `status`: `none | running | ready | failed`

- `get_workflow_status(workflowId)`
  - 返回: `{ id, name, stage, error?, payload }`

- `get_workflow_history(page?)`
  - 返回: `{ page, pageSize, total, items[] }`
  - 固定分页: `pageSize = 10`

## Paper Reading Commands

- `start_paper_reading_workflow({ paperIdOrUrl })`
  - 返回: `{ workflowId, paperId, reused }`
  - 复用策略:
    - 若该 `paperId` 已存在 `ready` 报告，则直接复用，不重复生成
    - 若该 `paperId` 已有 `running` 精读工作流，则复用该工作流

- `get_paper_report_history(page?)`
  - 返回: `{ page, pageSize, total, items[] }`
  - 固定分页: `pageSize = 10`

- `get_paper_report_detail(paperId)`
  - 返回: `{ paperId, title, authors, organization, summary, arxivUrl, githubRepo, report, comment, status, error, updatedAt }`

- `update_paper_report_comment(paperId, { comment })`
  - 返回: `void`
  - 支持空字符串（清空评论）

## Runtime Settings Commands

- `get_runtime_setting()`
  - 返回 RuntimeSetting DTO，空值自动回填默认提示词

- `update_runtime_setting(input)`
  - upsert `runtime_settings(id=1)`

## Rule Commands

- `get_rules()` -> `RuleDto[]`
- `create_rule_item({ content })` -> `RuleDto`
- `update_rule_item(id, { content })` -> `RuleDto`
- `delete_rule_item(id)` -> `void`

## Note Commands

- `get_note_history(page?, query?)`
  - 返回: `{ page, pageSize, total, items[] }`
  - 固定分页: `pageSize = 10`

- `create_note_item()`
  - 返回: `{ id, title, content, createdAt, updatedAt }`
  - 标题按“未命名笔记 / 未命名笔记 N”自动分配

- `delete_note_item(id)` -> `void`

- `get_note_detail(id)`
  - 返回: `{ id, title, content, createdAt, updatedAt }`

- `update_note_content(id, { title, content, links })`
  - `links[]`: `{ refType: 'paper'|'task'|'note', refId, label? }`
  - 保存时重建该笔记在 `note_links` 中的结构化双链关系

- `get_note_linked_context(id)`
  - 返回: `{ papers[], tasks[], notes[] }`

## Workflow Payload 关键字段

- `dayKey`
- `triggeredAt`
- `startedAt`
- `finishedAt`
- `candidateCount`
- `newPaperIds`
- `selectedIds`
- `llmResult`
- `retries`
- `error`（失败时）

## Paper Reading Payload 关键字段

- `paperId`
- `triggeredAt`
- `startedAt`
- `finishedAt`
- `source`
- `pdfUrl`
- `ocrChars`
- `retries`
- `error`（失败时）
