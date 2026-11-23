import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The config is evaluated again in every worker: fix the port and temp dir once, in the environment.
if (!process.env.E2E_PORT) {
  const probe =
    "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})";
  process.env.E2E_PORT = execFileSync(process.execPath, ['-e', probe]).toString().trim();
}
if (!process.env.E2E_TMP) process.env.E2E_TMP = mkdtempSync(join(tmpdir(), 'colloca-e2e-'));

const port = Number(process.env.E2E_PORT);
const repoRoot = resolve(import.meta.dirname, '..');

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  globalTeardown: './e2e/teardown.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Build the UI first (`npm run e2e`): the API serves frontend/dist as its static dir.
  webServer: {
    command: `uv run uvicorn colloca.main:app --host 127.0.0.1 --port ${port}`,
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}/api/languages`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      COLLOCA_DATA_DIR: join(process.env.E2E_TMP!, 'data'),
      SPACY_SIZE: 'sm',
      COLLOCA_STATIC_DIR: join(repoRoot, 'frontend', 'dist'),
    },
  },
});
