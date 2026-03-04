# DeepLab Frontend

Next.js App Router frontend for DeepLab daily paper workflows.

## Quick Start

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

`BACKEND_BASE_URL` defaults to `http://127.0.0.1:8000`.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run lint`

## Routes

- `/` Dashboard
- `/reports/[id]` Report detail + comment update
- `/ops/workflows` Workflow list + manual triggers
- `/ops/workflows/[id]` Workflow timeline + payload details
- `/ops/rules` Screening rule CRUD
- `/ops/tasks` Todo task management
- `/ops/reports` Report search and comment-status filter
- `/ops/settings` Runtime settings (API keys/models/OCR) persisted in DB

## Architecture

- Server Components for primary reads
- Server Actions for mutations
- Unified backend client in `lib/api/client.ts`
- Optional backend proxy route at `/api/backend/[...path]`
