import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, '..');

const targets = [
  path.join(desktopRoot, '.bundle'),
  path.join(desktopRoot, 'dist'),
];

for (const target of targets) {
  await fs.remove(target);
  console.log(`[clean] removed ${target}`);
}
