# DeepLab

基于 Agent 的 AI 科研辅助平台，提供从「每日论文发现」到「知识沉淀与工作复盘」的闭环能力。

## 产品简介

DeepLab 面向 AI 研究与工程团队，将论文处理流程与运营控制台整合在同一系统中：

- 自动抓取每日论文
- 可配置规则进行初筛
- 两阶段精读生成中文报告
- 报告内容沉淀到知识库
- 基于用户行为增量自动生成 AI 工作日报

## 功能简介

### 1) 每日论文工作流

- **论文收集**：从 `https://huggingface.co/api/daily_papers` 拉取最新论文元信息并入库。
- **论文初筛**：先按 upvotes 保留候选，再结合运营规则与 Agent 推理筛选重点论文。
- **论文精读**：对入选论文执行 OCR（Mistral）+ 两阶段阅读推理，产出结构化中文精读报告。

### 2) 报告中心与人工介入

- 支持按论文标题检索、按评论状态筛选。
- 支持通过 `arXiv ID / arXiv PDF URL / 可下载 PDF URL` 手动触发精读。
- 报告详情页支持评论回写与知识提炼触发。

### 3) 知识库

- 从精读报告抽取研究问题，并基于向量相似度进行问题复用/合并。
- 维护“问题-方案-局限”结构化知识。
- 提供双链笔记能力，可关联问题、论文、任务。

### 4) AI 工作日报

- 采集用户行为增量（报告评论、任务变化、笔记变更）。
- 生成标准化 Markdown 日报（昨日总结 / 今日规划 / 工作建议）。

### 5) 运营后台

- 工作流列表、状态筛选、阶段级输入输出载荷查看。
- 初筛规则管理、任务管理、日报管理。
- 运行时配置中心（Provider、模型、温度、Prompt 模板、Embedding 下载管理）。

## 技术架构

- **前端**：Next.js 15（App Router）+ React 19 + TypeScript
- **后端**：FastAPI + Tortoise ORM
- **数据库**：PostgreSQL 17
- **知识检索**：FastEmbed + FAISS
- **LLM / OCR**：
  - LLM Provider：`google-genai` 或 `openai-compatible`
  - OCR：Mistral OCR

## 目录结构

```text
.
├── deeplab/                # 后端核心代码（API、工作流、知识库）
├── frontend/               # Next.js 前端
├── docs/                   # 模块说明文档
├── persist/                # 本地持久化目录（数据库与 embedding 缓存）
├── compose.yaml            # 一键部署编排
└── Dockerfile.backend      # 后端镜像构建文件
```

## 部署指南

### 方案 A：Docker Compose（推荐）

适合本地体验和单机部署。

#### 1. 准备环境

- Docker + Docker Compose（v2）
- 可访问外网（拉取依赖镜像、模型服务）

#### 2. 配置环境变量

在项目根目录创建或更新 `.env`（至少设置数据库密码）：

```bash
POSTGRES_PASSWORD=please_change_me
```

说明：

- LLM/OCR 配置可在启动后通过前端页面 `/ops/settings` 在线写入数据库。
- 也可通过环境变量预置（例如 `API_KEY`、`BASE_URL`、`MISTRAL_API_KEY` 等）。

#### 3. 启动服务

```bash
docker compose up -d --build
```

默认访问地址：

- 前端：`http://localhost:3000`
- 后端 API：`http://localhost:8000`
- 后端 OpenAPI：`http://localhost:8000/docs`
- PostgreSQL：`localhost:5432`

#### 4. 首次初始化

1. 进入前端 `系统设置`（`/ops/settings`）。
2. 配置 LLM Provider 及对应 API Key/模型。
3. 配置 Mistral OCR 参数（`mistral_api_key` 等）。
4. 配置并下载 `knowledge_embedding_model`（知识提炼前必须完成）。
5. 在首页或 `工作流` 页面手动触发每日流程。

#### 5. 数据持久化

- `persist/pg-data`：PostgreSQL 数据
- `persist/fastembed`：Embedding 模型缓存

---

### 方案 B：本地开发部署（前后端分离）

适合二次开发与调试。

#### 1. 环境要求

- Python `3.12`
- [uv](https://docs.astral.sh/uv/)
- Node.js `20+` + npm
- PostgreSQL（建议 17）

#### 2. 启动 PostgreSQL（示例）

```bash
docker run -d \
  --name deeplab-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=deeplab \
  -e POSTGRES_DB=deeplab \
  -p 5432:5432 \
  -v "$(pwd)/persist/pg-data:/var/lib/postgresql/data" \
  postgres:17
```

#### 3. 启动后端

```bash
uv sync --frozen

export POSTGRES_HOST=127.0.0.1
export POSTGRES_PORT=5432
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=deeplab
export POSTGRES_DB=deeplab
export APP_HOST=0.0.0.0
export APP_PORT=8000
export APP_RELOAD=1
export FASTEMBED_CACHE_PATH="$(pwd)/persist/fastembed"

uv run python -m deeplab.main
```

#### 4. 启动前端

```bash
cd frontend
cp .env.example .env.local
# 编辑 .env.local，设置 BACKEND_BASE_URL=http://127.0.0.1:8000
npm install
npm run dev
```

## 生产部署建议

- 使用环境变量管理密钥，不要将真实密钥写入仓库。
- 后端建议 `APP_RELOAD=0`，并通过进程管理器或容器重启策略托管。
- 使用反向代理（Nginx/Caddy）统一域名并启用 HTTPS。
- 按需接入外部调度（cron）调用触发接口：
  - `POST /workflow_runs/daily/trigger`
  - `POST /workflow_runs/daily_work_reports/trigger`
- 定期备份 `persist/pg-data`。

## 常见问题

- **提示缺少 API Key / 模型配置**
  - 到 `/ops/settings` 补全对应 Provider 与 OCR 配置后重试。
- **知识提炼失败，提示 embedding 未下载**
  - 在 `/ops/settings` 先下载 `knowledge_embedding_model`。
- **重复触发返回同一工作流 ID**
  - 同一业务日会进行去重复用，属于预期行为。
