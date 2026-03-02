# DeepLab

## Docker 快速启动

项目已包含前后端与 PostgreSQL 的容器编排。

```bash
docker compose up --build
```

服务默认端口：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000`
- PostgreSQL：`localhost:5432`

## 首次配置（无需后端环境变量）

用户首次启动后，在前端进入：

- `运营后台 -> 系统设置`（`/ops/settings`）

填写并保存以下配置（将持久化到数据库）：

- `google_api_key`
- `google_base_url`（可选）
- `google_model`
- `mistral_api_key`
- `mistral_base_url`
- `mistral_ocr_model`

保存后即可触发论文收集、初筛与精读工作流。
