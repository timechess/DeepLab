# Architecture Overview

## 目标

实现“抓取候选论文 -> 规则化 LLM 初筛 -> 当日推荐展示”的桌面应用内闭环，且前端保持 SSG 页面 + 客户端调用 Tauri commands。

## 模块拆分（Rust）

`src-tauri/src/`:

- `state.rs`: 全局状态、SQLite 初始化、默认提示词常量
- `types.rs`: DTO/输入输出类型
- `db.rs`: 数据库访问层（workflow/rule/runtime settings/papers/log）
- `llm.rs`: provider 适配、重试、响应解析与校验
- `workflow.rs`: 论文推荐工作流编排 + workflow 相关命令
- `settings.rs`: RuntimeSetting 读取/更新命令
- `rules.rs`: Rule CRUD 命令
- `lib.rs`: 命令注册与插件装配

## 前端页面

`src/app/`:

- `/`：今日推荐首页
- `/workflow`：历史工作流管理（分页10条 + 详情）
- `/rule`：筛选规则管理（新增/编辑/删除）
- `/setting`：RuntimeSetting 配置

## 数据层新增

- `paper_recommendations` 表（按 `day_key` 唯一）

## 运行边界

- 工作流计算逻辑在 Rust 端执行
- API key 仅存在本地数据库与 Rust 请求层
- Next 页面不依赖 SSR route handler
