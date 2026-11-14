import JSZip from 'jszip';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, DEV, resetSite, signIn as signInDialog } from './helpers';

const PROBE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sdk-probe');

async function probeZip(): Promise<Buffer> {
  const zip = new JSZip();
  // A wrapping folder, as most engines export it; the uploader strips it.
  for (const name of readdirSync(PROBE_DIR)) zip.file(`sdk-probe/${name}`, readFileSync(join(PROBE_DIR, name)));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function cover(): Promise<Buffer> {
  return sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 12, g: 42, b: 110 } } }).png().toBuffer();
}

async function signIn(page: Page, email: string, username: string, birthYear = '1990') {
  await signInDialog(page, email, username, birthYear);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

/**
 * Phase 2 acceptance: a new studio signs up, uploads the sdk-probe zip, sees the pre-QA report,
 * submits; an admin approves it to Spark; it is played from the "Fresh games" rail; KPIs update.
 */
test('developer upload → pre-QA → submit → approve → Spark → play → KPIs', async ({ page }) => {
  test.setTimeout(240_000);
  await resetSite(page);

  // 1. Studio signup.
  await page.goto(`${DEV}/`);
  await page.getByTestId('dev-login').click();
  await signIn(page, 'dev@example.test', 'probe_dev');
  await page.getByTestId('studio-name').fill('Probe Studio');
  await page.getByTestId('studio-terms').check();
  await page.getByTestId('studio-create').click();
  await expect(page.getByTestId('dev-dashboard')).toBeVisible();

  // 2. New game: details, content, cover.
  await page.getByTestId('new-game').click();
  await page.getByTestId('wiz-title').fill('Probe Quest');
  await page.getByTestId('wiz-short').fill('A bare page that checks the SDK, used only by tests.');
  await page.getByTestId('wiz-category').selectOption('puzzle');
  await page.getByTestId('wiz-tags').fill('logic, fixture');
  await page.getByTestId('wiz-create').click();
  await expect(page).toHaveURL(/step=content/);
  await page.getByTestId('wiz-description').fill('This fixture checks that the platform can **load and frame** a build and talk to the SDK.');
  await page.getByTestId('wiz-how').fill('Press the buttons and read the log.');
  for (let i = 0; i < 3; i++) await page.getByTestId('wiz-add-faq').click();
  const faq = page.getByTestId('wiz-faq');
  for (let i = 0; i < 3; i++) {
    await faq.getByPlaceholder('Question').nth(i).fill(`Question ${i + 1}?`);
    await faq.getByPlaceholder('Answer').nth(i).fill(`Answer ${i + 1}.`);
  }
  await expect(page.getByTestId('save-state')).toHaveText('Draft saved', { timeout: 10_000 });
  await page.getByTestId('wiz-next').click();
  await page.getByTestId('media-input-cover_landscape').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: await cover() });
  await expect(page.getByTestId('media-cover_landscape').locator('img')).toBeVisible({ timeout: 20_000 });

  // 3. Build: unzip in the browser, validate, upload, pre-QA.
  await page.getByTestId('wiz-next').click();
  await page.getByTestId('zip-input').setInputFiles({ name: 'probe.zip', mimeType: 'application/zip', buffer: await probeZip() });
  await expect(page.getByTestId('zip-report')).toContainText('Brainstorming SDK found');
  await page.getByTestId('build-submit').click();
  const report = page.getByTestId('pre-qa-report');
  await expect(report).toBeVisible({ timeout: 120_000 });
  await expect(report.locator('[data-check="sdk"]')).toHaveAttribute('data-check-status', 'pass');
  await expect(report.locator('[data-check="gameplay-event"]')).toHaveAttribute('data-check-status', 'pass');
  await expect(report.locator('[data-check="absolute-paths"]')).toHaveAttribute('data-check-status', 'pass');

  // 4. Submit for review.
  await page.getByTestId('wiz-next').click();
  await page.getByTestId('wiz-to-manage').click();
  await page.getByTestId('submit-review').click();
  await expect(page.getByTestId('game-status').first()).toHaveText('In review');

  // 5. Admin approves to Spark.
  await page.goto(`${ADMIN}/qa/`);
  await page.getByRole('button', { name: 'Log in' }).first().click();
  await signIn(page, 'admin@example.test', 'qa_admin', '1985');
  await expect(page.getByTestId('qa-row')).toHaveCount(1);
  await page.getByTestId('qa-review-link').click();
  await page.getByTestId('qa-approve').click();
  await expect(page.getByTestId('qa-queue')).toBeVisible();
  await expect(page.getByTestId('qa-row')).toHaveCount(0);

  // 6. The game is in the Fresh games rail; play it. The probe sees the platform.
  await page.goto('/');
  const fresh = page.getByTestId('rail-fresh');
  await expect(fresh.getByText('Probe Quest')).toBeVisible();
  await fresh.getByTestId('game-tile').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Probe Quest' })).toBeVisible();
  await page.getByTestId('play-button').click();
  const probe = page.frameLocator('[data-testid="game-iframe"]');
  await expect(probe.getByTestId('probe-env')).toHaveText('brainstorming', { timeout: 20_000 });
  // During Spark every ad call is refused.
  await probe.getByTestId('probe-midgame').click();
  await expect(probe.getByTestId('probe-log')).toContainText('"reason":"spark"');
  await probe.getByTestId('probe-celebrate').click();
  await expect(page.getByTestId('celebration')).toBeVisible();
  await page.waitForTimeout(1500);

  // 7. Back as the developer: the KPI page counts the play.
  await page.goto(`${DEV}/`);
  await expect(page.getByTestId('dev-game-row').getByTestId('game-status')).toHaveText('Spark Launch');
  await page.getByRole('link', { name: 'KPIs' }).click();
  await expect(page.getByTestId('kpi-page').locator('[data-kpi="plays"] dd').first()).not.toHaveText('0');
});
