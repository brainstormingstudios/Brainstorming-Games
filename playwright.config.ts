import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const SITE = 'http://localhost:3000';
const CI = Boolean(process.env.CI);

/**
 * Locally, use an installed Chrome or Edge so no browser download is needed. CI installs
 * Playwright's own Chromium (`npx playwright install chromium`). Override with PW_CHANNEL.
 */
function localChannel(): string | undefined {
  if (process.env.PW_CHANNEL) return process.env.PW_CHANNEL === 'bundled' ? undefined : process.env.PW_CHANNEL;
  if (CI) return undefined;
  const chrome = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ];
  if (chrome.some((p) => existsSync(p))) return 'chrome';
  if (existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')) return 'msedge';
  return undefined;
}

const channel = localChannel();

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /\.spec\.ts$/,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  outputDir: './.local/test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['html', { outputFolder: '.local/playwright-report', open: 'never' }]] : [['list']],
  use: {
    baseURL: SITE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1366, height: 800 } } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel },
      // The mobile project re-runs the player-facing smoke tests on a phone layout.
      testMatch: /catalogue\.spec\.ts/,
    },
  ],
  // The suite runs against the real static exports of all three sites, served the way
  // Cloudflare Pages serves them, plus the local play origin and database. Build first:
  // `npm run build`. Every test empties the local database (a backup is kept in .local).
  webServer: [
    {
      command: 'node scripts/serve-static.mjs --site play',
      url: `${SITE}/offline/`,
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    {
      command: 'node scripts/serve-static.mjs --site developers',
      url: 'http://localhost:3001/login/',
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    {
      command: 'node scripts/serve-static.mjs --site manage',
      url: 'http://localhost:3002/login/',
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    {
      command: 'node scripts/dev-services.mjs --port 4100 --no-seed',
      url: 'http://localhost:4100/__mock/health',
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
  ],
});
