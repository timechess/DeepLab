import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const bundleRoot = path.join(desktopRoot, '.bundle');
const outputRoot = path.join(bundleRoot, 'frontend-standalone');
const runtimeNodeModulesDirName = 'runtime-node-modules';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
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

function resolveNpmCommand() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath],
    };
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: [],
  };
}

async function main() {
  await fs.ensureDir(bundleRoot);

  console.log('[frontend] building Next.js standalone output');
  const npmCommand = resolveNpmCommand();
  await run(npmCommand.command, [...npmCommand.args, 'run', 'build'], {
    cwd: frontendRoot,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });

  const standaloneSource = path.join(frontendRoot, '.next', 'standalone');
  const staticSource = path.join(frontendRoot, '.next', 'static');
  const publicSource = path.join(frontendRoot, 'public');

  if (!(await fs.pathExists(standaloneSource))) {
    throw new Error(`Next standalone output not found: ${standaloneSource}`);
  }
  if (!(await fs.pathExists(staticSource))) {
    throw new Error(`Next static output not found: ${staticSource}`);
  }

  await fs.remove(outputRoot);
  await fs.copy(standaloneSource, outputRoot, { dereference: true });
  await fs.copy(staticSource, path.join(outputRoot, '.next', 'static'), {
    dereference: true,
  });

  const standaloneNodeModules = path.join(outputRoot, 'node_modules');
  const runtimeNodeModules = path.join(outputRoot, runtimeNodeModulesDirName);
  if (await fs.pathExists(standaloneNodeModules)) {
    await fs.remove(runtimeNodeModules);
    await fs.move(standaloneNodeModules, runtimeNodeModules);
  }

  if (await fs.pathExists(publicSource)) {
    await fs.copy(publicSource, path.join(outputRoot, 'public'), { dereference: true });
  }

  console.log(`[frontend] packaged standalone bundle -> ${outputRoot}`);
}

main().catch((error) => {
  console.error(`[frontend] failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
