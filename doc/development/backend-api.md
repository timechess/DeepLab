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
