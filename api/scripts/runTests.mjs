import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = readdirSync(path.join(root, 'tests'))
  .filter((name) => name.endsWith('.test.ts') && !name.endsWith('.integration.test.ts'))
  .map((name) => path.join('tests', name));
const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:55433/greencode_test', JWT_SECRET: process.env.JWT_SECRET ?? 'integration-test-secret-with-at-least-32-bytes' },
});
process.exit(result.status ?? 1);
