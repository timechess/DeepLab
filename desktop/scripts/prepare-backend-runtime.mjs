import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const bundleRoot = path.join(desktopRoot, '.bundle');
const backendSourceRoot = path.join(bundleRoot, 'backend-src');
const backendVenvRoot = path.join(bundleRoot, 'backend-venv');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? 'inherit',
      shell: false,
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout}`));
    });
  });
}

async function resolveUvCommand() {
  const explicit = process.env.DEEPLAB_UV_BIN;
  const candidates = explicit ? [explicit] : ['uv'];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await runCapture(candidate, ['--version'], { cwd: repoRoot });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    `No usable uv launcher found. Install uv or set DEEPLAB_UV_BIN. Tried: ${candidates.join(', ')}`,
  );
}

async function copyBackendSource() {
  await fs.ensureDir(bundleRoot);
  await fs.remove(backendSourceRoot);

  const sourceDirs = ['deeplab', 'scripts'];
  const sourceFiles = ['pyproject.toml', 'uv.lock', 'README.md'];

  for (const dirName of sourceDirs) {
    const from = path.join(repoRoot, dirName);
    const to = path.join(backendSourceRoot, dirName);
    await fs.copy(from, to, { dereference: true });
  }

  for (const fileName of sourceFiles) {
    const from = path.join(repoRoot, fileName);
    const to = path.join(backendSourceRoot, fileName);
    await fs.copy(from, to, { dereference: true });
  }
}

function resolveVenvPythonPath(venvRoot) {
  if (process.platform === 'win32') {
    return path.join(venvRoot, 'Scripts', 'python.exe');
  }
  return path.join(venvRoot, 'bin', 'python');
}

async function main() {
  const uvCommand = await resolveUvCommand();
  console.log(`[backend] using uv launcher: ${uvCommand}`);

  await copyBackendSource();
  console.log(`[backend] copied backend source -> ${backendSourceRoot}`);

  await fs.remove(backendVenvRoot);
  const syncEnv = {
    ...process.env,
    UV_PROJECT_ENVIRONMENT: backendVenvRoot,
  };
  if (process.env.DEEPLAB_UV_PYTHON?.trim()) {
    syncEnv.UV_PYTHON = process.env.DEEPLAB_UV_PYTHON.trim();
  }

  await run(
    uvCommand,
    ['sync', '--project', backendSourceRoot, '--no-dev', '--locked'],
    {
      cwd: backendSourceRoot,
      env: syncEnv,
    },
  );

  const venvPython = resolveVenvPythonPath(backendVenvRoot);
  if (!(await fs.pathExists(venvPython))) {
    throw new Error(`Embedded Python executable not found: ${venvPython}`);
  }

  console.log(`[backend] runtime prepared -> ${backendVenvRoot}`);
}

main().catch((error) => {
  console.error(`[backend] failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
