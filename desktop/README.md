# DeepLab Desktop (Electron)

Cross-platform desktop packaging host for DeepLab.

## What It Does

- Starts embedded FastAPI backend (`python -m deeplab.main`)
- Starts embedded Next.js standalone server (`server.js`)
- Waits for `/healthz` before showing the main window
- Keeps all runtime data under Electron `userData`
- Stops all child processes when the window is closed

## Runtime Paths

Desktop runtime uses `<userData>/deeplab` as root:

- `<userData>/deeplab/persist/deeplab.duckdb`
- `<userData>/deeplab/persist/fastembed`
- `<userData>/deeplab/tmp`
- `<userData>/deeplab/logs`

Typical Windows path:

- `C:\Users\<username>\AppData\Roaming\DeepLab\deeplab`

## Build Prerequisites

- Node.js 20+
- uv
- Python 3.12+ (recommended, optional when uv auto-manages Python)
- npm

## Build Commands (Local)

```bash
cd desktop
npm install
npm run desktop:dist:win
```

Additional targets:

```bash
npm run desktop:dist:mac
npm run desktop:dist:linux
```

Generated installer:

- `desktop/dist/*`

## Icons

- Place icon files under `desktop/build/icons/`
- Required files and sizes are documented in `desktop/build/icons/README.md`
- Build config already points to:
  - Windows: `build/icons/icon.ico`
  - macOS: `build/icons/icon.icns`
  - Linux: `build/icons/` (PNG set)

## GitHub Actions Release

- Workflow: `.github/workflows/desktop-prerelease.yml`
- Trigger mode: manual (`workflow_dispatch`)
- Release type: GitHub pre-release
- Platform matrix: Windows / macOS / Linux
- Signing: disabled for all platforms

## Notes

- All artifacts are unsigned (internal testing build).
- Packaged app uses built-in runtime configuration and does not depend on custom env vars.
- Development mode still keeps environment variable passthrough for local debugging.
- Backend runtime environment is prepared by `uv sync --locked --no-dev`.
- Auto-update is not enabled in this phase.
- Historical data migration from existing `persist/` is intentionally not included.
