# Frontend Pages

## `/`

- 显示“当日推荐”状态机：
  - `none`: 显示触发按钮
  - `running`: 显示进行中 + 跳转 workflow
  - `ready`: 显示 summary 与论文卡片
  - `failed`: 显示错误并支持重试

## `/workflow`

- 历史工作流表格（分页）
- 每页 10 条
- 点击行加载 `get_workflow_status` 详情并展示 payload

## `/rule`

- 顶部 textarea + “新增规则”按钮
- 表格显示现有规则
- 支持行内编辑并保存
- 支持删除

## `/setting`

- RuntimeSetting 编辑
- `provider` 为下拉：`openai compatible` / `google`
- 提示词区展示变量说明：
  - `{{CANDIDATES_PAPER}}`
  - `{{RULE_LIST}}`
  - `{{PAPER_ID}}`
  - `{{PAPER_TITLE}}`
  - `{{PAPER_OCR_TEXT}}`

## `/paper_report`

- 顶部输入 arXiv id/URL + `开始精读`
- 触发后显示运行状态（`running|ready|failed`）
- 报告历史分页表格（每页 10 条）
- 详情跳转使用静态路由 + query：
  - `/paper_report/detail?paperId=...`

## `/paper_report/detail`

- 客户端通过 query `paperId` 调 Tauri command 拉取详情
- 报告渲染使用 `streamdown` + 插件：
  - `@streamdown/cjk`
  - `@streamdown/code`
  - `@streamdown/math`
  - `@streamdown/mermaid`
- 数学兼容：
  - 保留 `$...$`、`$$...$$`
  - 将 `\(...\)`、`\[...\]` 归一化后再渲染
- 底部评论支持新增/覆盖/清空保存

## 导航

全局导航：

- 今日推荐
- 工作流管理
- 筛选规则
- 论文精读
- 系统设置
