# 前端开发指南（Next.js）

本指南用于指导前端同学实现 DeepLab 的 Web 前端，重点覆盖：

1. 首页展示每日初筛结果与精读报告。
2. 报告按“已评论/未评论”分组展示。
3. 报告正文支持 Markdown 渲染。
4. 提供后端记录数据（工作流、阶段、规则、报告）的查看与操作界面。

## 1. 目标与范围

### 1.1 MVP 目标

1. 首页可查看最新一次每日 workflow 的初筛与精读结果。
2. 可查看报告详情，并支持更新 `comment`。
3. 后台运营页面可查看 workflow 运行记录与阶段细节。
4. 可在页面手动触发 workflow、初筛、精读。

### 1.2 非目标（当前阶段不做）

1. 用户登录鉴权（先默认内部工具）。
2. 多角色权限管理。
3. 报告编辑器（仅支持 comment 字段更新）。

## 2. 后端能力快照（当前可用接口）

### 2.1 工作流与任务触发

1. `POST /workflow_runs/daily/trigger`：手动触发每日 workflow，返回 `workflow_id`。
2. `GET /workflow_runs`：获取 workflow 列表（支持 `limit`）。
3. `GET /workflow_runs/{workflow_id}`：获取 workflow 详情及阶段信息。
4. `POST /fetch_papers`：手动触发论文收集。
5. `POST /filter_papers`：手动触发初筛。
6. `POST /read_papers`：手动触发精读。

### 2.2 初筛规则

1. `GET /screening_rules`
2. `POST /screening_rules`
3. `GET /screening_rules/{rule_id}`
4. `PUT /screening_rules/{rule_id}`
5. `DELETE /screening_rules/{rule_id}`

### 2.3 精读报告

1. `GET /reading_reports?limit=20&paper_id=...`
2. `GET /reading_reports/{report_id}`
3. `PATCH /reading_reports/{report_id}/comment`

### 2.4 运行时配置（系统设置）

1. `GET /runtime_settings`
2. `PUT /runtime_settings/{key}`
3. `DELETE /runtime_settings/{key}`

## 3. 前端信息架构

建议采用两大导航区：

1. `首页 Dashboard`
2. `运营后台 Ops`

### 3.1 首页（核心）

首页必须展示：

1. 最新 workflow 概览（运行时间、状态、阶段状态）。
2. 初筛结果区：
1. 入选论文列表（标题、id、入选理由摘要如后端可用）。
2. 初筛摘要（来自 `paper_filtering` 阶段输出）。
3. 精读报告区：
1. 未评论报告列表。
2. 已评论报告列表。
3. 报告项支持点击进入详情。

### 3.2 运营后台（后端记录查看）

建议页面：

1. `/ops/workflows`：workflow 列表页。
2. `/ops/workflows/[id]`：workflow 详情页，展示阶段输入/输出 payload、错误信息。
3. `/ops/rules`：初筛规则 CRUD 页面。
4. `/ops/reports`：报告管理页（搜索、按评论状态筛选、跳转详情）。
5. `/ops/settings`：模型与 OCR 配置页面（保存到数据库）。

## 4. Next.js 技术方案（App Router）

### 4.1 推荐技术栈

1. Next.js（App Router）
2. TypeScript
3. Tailwind CSS（可选）
4. `react-markdown` + `remark-gfm` + `rehype-sanitize`（Markdown 安全渲染）
5. `zod`（接口返回校验，可选但推荐）

### 4.2 目录建议

```text
app/
  (dashboard)/
    page.tsx                       # 首页
    reports/[id]/page.tsx          # 报告详情
  (ops)/
    ops/workflows/page.tsx         # workflow 列表
    ops/workflows/[id]/page.tsx    # workflow 详情
    ops/rules/page.tsx             # 初筛规则管理
    ops/reports/page.tsx           # 报告管理
  api/
    backend/[...path]/route.ts     # 统一后端代理（可选）
components/
  dashboard/
  reports/
  ops/
lib/
  api/
    client.ts                      # fetch 封装
    schemas.ts                     # zod schema
  markdown/
    renderer.tsx                   # Markdown 渲染组件
```

### 4.3 RSC 与 Client Component 边界

1. 列表页与详情页默认使用 Server Component 拉取数据。
2. 仅把交互组件做成 Client Component：
1. 评论编辑器
2. 手动触发按钮
3. 筛选器和本地搜索
3. 避免在 Client Component 内做首屏核心数据拉取，减少瀑布与 hydration 压力。

### 4.4 数据拉取策略

1. 同屏独立数据并行请求，避免串行 waterfall。
2. 触发类操作（POST/PATCH）走 Server Action 或 Route Handler。
3. workflow 详情页支持轮询（例如每 5 秒）直到状态到达 `succeeded/failed`。

## 5. 首页实现细则

### 5.1 首页数据组合逻辑

建议流程：

1. `GET /workflow_runs?limit=20` 获取最近 workflow。
2. 找到最新一条 `workflowName=daily_paper_reports` 且状态为 `succeeded` 或 `running` 的记录。
3. `GET /workflow_runs/{id}` 获取阶段详情：
1. 从 `paper_filtering` 阶段拿初筛输出。
2. 从 `paper_reading` 阶段拿 `reports` 列表（含 report_id）。
4. 若有 report_id 列表，再调用 `GET /reading_reports` 补全报告信息（或逐条 `GET /reading_reports/{id}`）。

### 5.2 已评论/未评论分组

分组规则：

1. `comment` 去掉空白后长度为 0 归为“未评论”。
2. 其余归为“已评论”。

示例逻辑（伪代码）：

```ts
const uncommented = reports.filter((r) => !r.comment?.trim());
const commented = reports.filter((r) => !!r.comment?.trim());
```

### 5.3 报告 Markdown 渲染

后端 `stage2Content` 是文本主体，前端按 Markdown 渲染：

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
  {report.stage2Content}
</ReactMarkdown>
```

安全要求：

1. 必须启用 `rehype-sanitize`。
2. 禁止直接 `dangerouslySetInnerHTML`。

## 6. 后台记录查看界面细则

### 6.1 workflow 列表页

展示字段：

1. `id`
2. `workflowName`
3. `triggerType`
4. `status`
5. `startedAt`
6. `finishedAt`
7. `errorMessage`（失败时）

交互：

1. 点击进入详情页。
2. 支持状态筛选（running/succeeded/failed）。
3. 支持手动触发 `POST /workflow_runs/daily/trigger`。

### 6.2 workflow 详情页

展示：

1. 基础信息（状态、时间、上下文）。
2. 阶段时间线（paper_collection → paper_filtering → paper_reading）。
3. 每个阶段的 `inputPayload/outputPayload/errorMessage`。

建议：

1. JSON payload 使用代码块折叠展示。
2. 失败阶段高亮。

### 6.3 初筛规则页

支持：

1. 规则列表
2. 新增
3. 编辑
4. 删除

### 6.4 报告管理页

支持：

1. 按 `paperId` 搜索。
2. 按评论状态筛选。
3. 快速跳转报告详情。

## 7. 建议的 API 客户端封装

统一封装一个 `backendFetch`：

1. 处理 `baseURL`
2. 统一超时和错误转换
3. 统一 Response 解析

建议通过 Next Route Handler 做后端代理（可选）：

1. 前端只请求 `/api/backend/...`
2. 避免浏览器暴露内网后端地址
3. 便于后续加鉴权与审计

## 8. 页面清单与验收标准

### 8.1 页面清单

1. `/` 首页 Dashboard
2. `/reports/[id]` 报告详情（Markdown + comment 编辑）
3. `/ops/workflows`
4. `/ops/workflows/[id]`
5. `/ops/rules`
6. `/ops/reports`
7. `/ops/settings`

### 8.2 验收标准

1. 首页可看到最新初筛结果与精读报告。
2. 报告被正确拆分到“已评论/未评论”两组。
3. `stage2Content` Markdown 渲染正确且安全。
4. comment 更新后 UI 立即刷新分组。
5. workflow 列表和详情可完整展示阶段数据和错误信息。

## 9. 开发顺序建议

1. 第一阶段：搭建项目骨架与 API 客户端。
2. 第二阶段：完成首页（含报告分组、详情跳转）。
3. 第三阶段：完成报告详情与 comment 更新。
4. 第四阶段：完成 Ops 页面（workflow、rules、reports）。
5. 第五阶段：补充加载态、错误态、空状态与轮询刷新。

## 10. 已知后端能力边界（前端同学需知）

1. 当前已能查看 workflow/stage 记录、规则、报告与评论。
2. 若后续需要“LLM 调用日志明细页”，建议后端补充：
1. `GET /llm_invocations`
2. `GET /llm_invocations/{id}`
3. 支持按 `workflowId/stage/task` 过滤。

以上接口不影响当前 MVP 首页与后台记录页交付，可作为下一迭代。
