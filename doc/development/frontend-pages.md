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

## 导航

全局导航：

- 今日推荐
- 工作流管理
- 筛选规则
- 系统设置
