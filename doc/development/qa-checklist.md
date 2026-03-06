# QA Checklist (Current Features)

## Workflow

- [ ] 首页无当日结果时可触发流程
- [ ] 后台执行期间 UI 不阻塞
- [ ] 结果成功后可在首页展示 summary + 卡片
- [ ] `/workflow` 可分页查看历史记录（10条/页）
- [ ] 点击历史行可查看 payload 详情

## Rule

- [ ] `/rule` 能新增规则
- [ ] `/rule` 能编辑规则
- [ ] `/rule` 能删除规则
- [ ] 空规则内容提交会被阻止

## Settings

- [ ] `provider` 下拉可切换
- [ ] 提示词区域有变量提示
- [ ] 保存后刷新仍能读取

## Theme

- [ ] 全站背景非白色（蓝黑）
- [ ] 标题与正文颜色在各页一致
- [ ] 表单控件无白底突兀问题

## Paper Reading

- [ ] `/paper_report` 可输入 arXiv id/URL 并触发后台精读工作流
- [ ] 触发后可看到 workflow 进行状态，完成后列表自动刷新
- [ ] 报告列表分页正确（每页 10 条）
- [ ] `/paper_report/detail?paperId=...` 可展示元信息、报告正文和失败态信息
- [ ] 前端保持 SSG（`output: export`），详情页不依赖动态路由参数
- [ ] 报告正文公式可渲染（`$...$`、`$$...$$`、`\\(...\\)`、`\\[...\\]`）
- [ ] 公式渲染后不重复显示原始字符串
- [ ] 评论可新增、覆盖、清空并持久化

## Build & Check

- [ ] `cargo check`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm exec tsc --noEmit`
