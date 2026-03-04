const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const BACKEND_PORT_BASE = 18000;
const FRONTEND_PORT_BASE = 3123;
const PORT_SCAN_LIMIT = 2000;
const SERVICE_STARTUP_TIMEOUT_MS = 60_000;
const SERVICE_POLL_INTERVAL_MS = 500;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000;

let backendProcess = null;
let frontendProcess = null;
let mainWindow = null;
let logStream = null;
let runtimePaths = null;
let frontendBaseUrl = '';
let isShuttingDown = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function nowIso() {
  return new Date().toISOString();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function writeLog(source, message) {
  const line = `[${nowIso()}] [${source}] ${message}\n`;
  process.stdout.write(line);
  if (logStream) {
    logStream.write(line);
  }
}

function attachStream(stream, source) {
  if (!stream) {
    return;
  }

  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '').trim();
      if (line) {
        writeLog(source, line);
      }
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
    }
  });

  stream.on('end', () => {
    const remaining = buffer.trim();
    if (remaining) {
      writeLog(source, remaining);
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bundleRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.join(__dirname, '.bundle');
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function setupRuntimePaths() {
  const userDataDir = app.getPath('userData');
  const appDataRoot = path.join(userDataDir, 'deeplab');
  const persistDir = path.join(appDataRoot, 'persist');
  const embedCacheDir = path.join(persistDir, 'fastembed');
  const tmpDir = path.join(appDataRoot, 'tmp');
  const logsDir = path.join(appDataRoot, 'logs');
  const dbPath = path.join(persistDir, 'deeplab.duckdb');

  await ensureDir(appDataRoot);
  await ensureDir(persistDir);
  await ensureDir(embedCacheDir);
  await ensureDir(tmpDir);
  await ensureDir(logsDir);

  const logFilePath = path.join(logsDir, `desktop-${Date.now()}.log`);
  logStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf8' });

  runtimePaths = {
    userDataDir,
    appDataRoot,
    persistDir,
    embedCacheDir,
    tmpDir,
    logsDir,
    dbPath,
    logFilePath,
  };

  writeLog('app', `Runtime root: ${appDataRoot}`);
  writeLog('app', `Log file: ${logFilePath}`);
  return runtimePaths;
}

function assertPathExists(targetPath, description) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${description} not found: ${targetPath}`);
  }
}

function resolveBundlePaths() {
  const root = bundleRoot();
  const backendRoot = path.join(root, 'backend-src');
  const backendVenvRoot = path.join(root, 'backend-venv');
  const frontendRoot = path.join(root, 'frontend-standalone');

  assertPathExists(backendRoot, 'Embedded backend source');
  assertPathExists(backendVenvRoot, 'Embedded backend runtime');
  assertPathExists(frontendRoot, 'Embedded frontend standalone bundle');

  return {
    root,
    backendRoot,
    backendVenvRoot,
    frontendRoot,
  };
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once('error', () => {
      resolve(false);
    });

    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(basePort, reserved = new Set()) {
  for (let port = basePort; port < basePort + PORT_SCAN_LIMIT; port += 1) {
    if (reserved.has(port)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port in range ${basePort}-${basePort + PORT_SCAN_LIMIT - 1}`);
}

async function waitForHttpReady(url, label, options = {}) {
  const timeoutMs = options.timeoutMs ?? SERVICE_STARTUP_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? SERVICE_POLL_INTERVAL_MS;
  const accept =
    options.accept ??
    ((response) => {
      return response.ok;
    });

  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';

  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, { cache: 'no-store' });
      if (accept(response)) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    // eslint-disable-next-line no-await-in-loop
    await delay(intervalMs);
  }

  throw new Error(`${label} did not become ready in ${timeoutMs}ms (${lastError})`);
}

function pythonPathFromVenv(venvRoot) {
  if (process.platform === 'win32') {
    return path.join(venvRoot, 'Scripts', 'python.exe');
  }
  return path.join(venvRoot, 'bin', 'python');
}

function childProcessBaseEnv() {
  if (!app.isPackaged) {
    // Development mode keeps current env for local debugging convenience.
    return { ...process.env };
  }

  const env = {};
  const passthroughKeys =
    process.platform === 'win32'
      ? ['SystemRoot', 'ComSpec', 'WINDIR', 'PATHEXT', 'Path', 'PATH', 'USERNAME', 'USERPROFILE']
      : ['PATH', 'HOME', 'LANG', 'LC_ALL', 'SHELL', 'USER'];

  for (const key of passthroughKeys) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

function trackProcessExit(child, name) {
  child.once('exit', (code, signal) => {
    writeLog(name, `Process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);

    if (isShuttingDown) {
      return;
    }

    const reason = `${name} process exited unexpectedly.`;
    const details = `code=${code ?? 'null'}, signal=${signal ?? 'null'}`;
    dialog.showErrorBox('DeepLab 服务异常退出', `${reason}\n${details}\n\n日志文件：${runtimePaths?.logFilePath ?? 'N/A'}`);
    void shutdownAndExit(1);
  });
}

async function startBackend(bundlePaths, backendPort) {
  const pythonPath = pythonPathFromVenv(bundlePaths.backendVenvRoot);
  assertPathExists(pythonPath, 'Embedded Python executable');

  const env = {
    ...childProcessBaseEnv(),
    APP_HOST: '127.0.0.1',
    APP_PORT: String(backendPort),
    APP_RELOAD: '0',
    TMP: runtimePaths.tmpDir,
    TEMP: runtimePaths.tmpDir,
    DEEPLAB_DB_PATH: runtimePaths.dbPath,
    FASTEMBED_CACHE_PATH: runtimePaths.embedCacheDir,
    DEEPLAB_EMBED_CACHE_DIR: runtimePaths.embedCacheDir,
    DEEPLAB_TMP_DIR: runtimePaths.tmpDir,
  };

  writeLog('backend', `Starting backend on port ${backendPort}`);
  backendProcess = spawn(pythonPath, ['-m', 'deeplab.main'], {
    cwd: bundlePaths.backendRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  attachStream(backendProcess.stdout, 'backend:stdout');
  attachStream(backendProcess.stderr, 'backend:stderr');
  trackProcessExit(backendProcess, 'backend');

  const healthzUrl = `http://127.0.0.1:${backendPort}/healthz`;
  await waitForHttpReady(healthzUrl, 'Backend health check', {
    accept: (response) => response.ok,
  });
  writeLog('backend', 'Health check passed');
}

async function prepareFrontendRuntimeRoot(frontendRoot) {
  const sourceBuildIdPath = path.join(frontendRoot, '.next', 'BUILD_ID');
  let buildId = 'unknown';
  try {
    buildId = (await fsp.readFile(sourceBuildIdPath, 'utf8')).trim() || 'unknown';
  } catch {
    // Keep fallback build id when BUILD_ID is not readable.
  }

  const safeBuildId = buildId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const runtimeBaseRoot = path.join(runtimePaths.appDataRoot, 'frontend-runtime');
  const runtimeRoot = path.join(runtimeBaseRoot, safeBuildId);
  const readyMarker = path.join(runtimeRoot, '.ready');

  if (fs.existsSync(readyMarker)) {
    return runtimeRoot;
  }

  await ensureDir(runtimeBaseRoot);
  await fsp.rm(runtimeRoot, { recursive: true, force: true });
  await fsp.cp(frontendRoot, runtimeRoot, { recursive: true, force: true });

  const runtimeNodeModules = path.join(runtimeRoot, 'runtime-node-modules');
  const nodeModules = path.join(runtimeRoot, 'node_modules');
  if (!fs.existsSync(nodeModules) && fs.existsSync(runtimeNodeModules)) {
    try {
      await fsp.symlink(
        runtimeNodeModules,
        nodeModules,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch {
      await fsp.cp(runtimeNodeModules, nodeModules, { recursive: true, force: true });
    }
  }

  await fsp.writeFile(readyMarker, `${nowIso()}\n`, 'utf8');
  return runtimeRoot;
}

async function startFrontend(bundlePaths, frontendPort, backendPort) {
  const frontendRuntimeRoot = await prepareFrontendRuntimeRoot(bundlePaths.frontendRoot);
  const serverEntrypoint = path.join(frontendRuntimeRoot, 'server.js');
  assertPathExists(serverEntrypoint, 'Next standalone entrypoint');
  const runtimeNodeModules = path.join(frontendRuntimeRoot, 'runtime-node-modules');
  const nodePathParts = [runtimeNodeModules];
  if (process.env.NODE_PATH) {
    nodePathParts.push(process.env.NODE_PATH);
  }

  const env = {
    ...childProcessBaseEnv(),
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    NODE_PATH: nodePathParts.join(path.delimiter),
    HOSTNAME: '127.0.0.1',
    PORT: String(frontendPort),
    TMP: runtimePaths.tmpDir,
    TEMP: runtimePaths.tmpDir,
    BACKEND_BASE_URL: `http://127.0.0.1:${backendPort}`,
  };

  writeLog('frontend', `Starting standalone server on port ${frontendPort}`);
  frontendProcess = spawn(process.execPath, [serverEntrypoint], {
    cwd: frontendRuntimeRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  attachStream(frontendProcess.stdout, 'frontend:stdout');
  attachStream(frontendProcess.stderr, 'frontend:stderr');
  trackProcessExit(frontendProcess, 'frontend');

  frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
  try {
    await waitForHttpReady(`${frontendBaseUrl}/_next/static/chunks/webpack.js`, 'Frontend readiness', {
      accept: (response) => response.status < 500,
    });
  } catch {
    await waitForHttpReady(`${frontendBaseUrl}/favicon.ico`, 'Frontend readiness fallback', {
      accept: (response) => response.status < 500,
    });
  }
  writeLog('frontend', 'Frontend is ready');
}

function configureExternalNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(frontendBaseUrl)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(frontendBaseUrl)) {
      return;
    }
    event.preventDefault();
    void shell.openExternal(url);
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    title: 'DeepLab',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  let hasShown = false;
  const showWindow = () => {
    if (hasShown || mainWindow?.isDestroyed()) {
      return;
    }
    hasShown = true;
    mainWindow.show();
  };

  const showTimer = setTimeout(showWindow, 3000);
  mainWindow.once('ready-to-show', showWindow);
  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    writeLog('frontend', `Window load failed (code=${code}) ${description} -> ${validatedURL}`);
    showWindow();
  });

  configureExternalNavigation(mainWindow);
  mainWindow.on('close', (event) => {
    if (isShuttingDown) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    writeLog('app', 'Main window hidden; services continue running in background');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(frontendBaseUrl);
  clearTimeout(showTimer);
  showWindow();
}

async function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

function startupErrorHtml(error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>DeepLab Startup Error</title>
    <style>
      body { font-family: "Segoe UI", sans-serif; margin: 0; padding: 32px; background: #f7f8fa; color: #1f2937; }
      h1 { margin-top: 0; font-size: 24px; }
      .card { background: #fff; border: 1px solid #dbe3f0; border-radius: 12px; padding: 20px; }
      .hint { margin-top: 14px; color: #4b5563; }
      pre { background: #111827; color: #e5e7eb; border-radius: 10px; padding: 14px; overflow: auto; white-space: pre-wrap; }
      code { font-family: Consolas, "Courier New", monospace; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>DeepLab failed to start</h1>
      <p>Desktop services could not be initialized. Check the runtime log and restart the app.</p>
      <p class="hint">Log file: <code>${escapeHtml(runtimePaths?.logFilePath ?? 'N/A')}</code></p>
      <pre>${escapeHtml(message)}</pre>
    </div>
  </body>
</html>`;
}

async function showStartupErrorWindow(error) {
  const errorWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 820,
    minHeight: 520,
    show: true,
    title: 'DeepLab Startup Error',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await errorWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(startupErrorHtml(error))}`,
  );
}

async function stopChildProcess(child, name) {
  if (!child || child.exitCode !== null) {
    return;
  }

  writeLog(name, 'Stopping process');
  child.kill();

  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(PROCESS_SHUTDOWN_TIMEOUT_MS),
  ]);

  if (child.exitCode === null) {
    writeLog(name, 'Process did not exit in time, forcing kill');
    child.kill('SIGKILL');
  }
}

async function stopServices() {
  await stopChildProcess(frontendProcess, 'frontend');
  await stopChildProcess(backendProcess, 'backend');

  frontendProcess = null;
  backendProcess = null;

  if (logStream) {
    await new Promise((resolve) => {
      logStream.end(resolve);
    });
    logStream = null;
  }
}

async function shutdownAndExit(exitCode) {
  if (isShuttingDown) {
    app.exit(exitCode);
    return;
  }

  isShuttingDown = true;
  try {
    await stopServices();
  } finally {
    app.exit(exitCode);
  }
}

async function bootstrap() {
  await setupRuntimePaths();

  const bundlePaths = resolveBundlePaths();
  writeLog('app', `Bundle root: ${bundlePaths.root}`);

  const backendPort = await findAvailablePort(BACKEND_PORT_BASE);
  const frontendPort = await findAvailablePort(FRONTEND_PORT_BASE, new Set([backendPort]));

  await startBackend(bundlePaths, backendPort);
  await startFrontend(bundlePaths, frontendPort, backendPort);
  writeLog('app', 'Creating main window');
  await createMainWindow();
  writeLog('app', 'Main window created');
}

app.on('before-quit', (event) => {
  if (isShuttingDown) {
    return;
  }
  event.preventDefault();
  void shutdownAndExit(0);
});

app.on('window-all-closed', () => {
  // Keep backend/frontend services alive in background.
});

app.on('second-instance', () => {
  void showMainWindow();
});

app.on('activate', () => {
  void showMainWindow();
});

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    writeLog('app', `Startup failed: ${failure.stack || failure.message}`);
    await stopServices();
    await showStartupErrorWindow(failure);
  }
});
