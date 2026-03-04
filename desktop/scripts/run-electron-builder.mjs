import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, '..');

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: desktopRoot,
      env,
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

function shouldDisableSigning(args) {
  return args.includes('--win') || args.includes('--mac');
}

async function main() {
  const args = process.argv.slice(2);
  const electronBuilderCli = path.join(
    desktopRoot,
    'node_modules',
    'electron-builder',
    'cli.js',
  );
  if (!fs.existsSync(electronBuilderCli)) {
    throw new Error(`electron-builder CLI not found: ${electronBuilderCli}. Run npm install in desktop/ first.`);
  }

  const env = { ...process.env };
  if (shouldDisableSigning(args)) {
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    env.CSC_LINK = '';
    env.CSC_KEY_PASSWORD = '';
    env.WIN_CSC_LINK = '';
    env.WIN_CSC_KEY_PASSWORD = '';
  }

  await run(process.execPath, [electronBuilderCli, ...args], env);
}

main().catch((error) => {
  console.error(`[electron-builder] failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
