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

## Build & Check

- [ ] `cargo check`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm exec tsc --noEmit`
