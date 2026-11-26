import JSZip from 'jszip';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { type Page } from '@playwright/test';
import { ADMIN, DEV, expect, resetSite, signIn as signInDialog, test, unlockOwner } from './helpers';

const PROBE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sdk-probe');

async function probeZip(): Promise<Buffer> {
  const zip = new JSZip();
  // A wrapping folder, as most engines export it; the uploader strips it.
  for (const name of readdirSync(PROBE_DIR)) zip.file(`sdk-probe/${name}`, readFileSync(join(PROBE_DIR, name)));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function cover(width = 1920, height = 1080): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 12, g: 42, b: 110 } } }).png().toBuffer();
}

/** A 16-second 320x180 VP8 clip (Playwright's Chromium has no H.264). */
const PREVIEW_VIDEO = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'preview.webm');

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

  // 2. New game, step 1: details. Tags become chips at each comma; fewer than 3 is refused.
  await page.getByTestId('new-game').click();
  await page.getByTestId('wiz-title').fill('Probe Quest');
  await page.getByTestId('wiz-short').fill('A bare page that checks the SDK, used only by tests.');
  await page.getByTestId('wiz-category').selectOption('puzzle');
  await page.getByTestId('wiz-engine').selectOption('HTML5 / JavaScript');
  await page.getByTestId('wiz-tags').fill('logic, fixture,');
  await expect(page.getByTestId('wiz-tag')).toHaveCount(2);
  await page.getByTestId('wiz-create').click();
  await expect(page.getByTestId('wiz-error')).toHaveText('Add at least 3 tags.');
  await page.getByTestId('wiz-tags').fill('probe,');
  await expect(page.getByTestId('wiz-tag')).toHaveCount(3);
  await page.getByTestId('wiz-made-in-india').check({ force: true });
  await page.getByTestId('wiz-skill-logic').click();
  await expect(page.getByTestId('wiz-skill-logic')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('wiz-create').click();

  // Step 2: the game page. Controls come from dropdowns.
  await expect(page).toHaveURL(/step=page/);
  await page.getByTestId('wiz-description').fill('This fixture checks that the platform can **load and frame** a build and talk to the SDK.');
  await page.getByTestId('wiz-add-control').click();
  await page.getByTestId('wiz-control-action').fill('Press a button');
  await page.getByTestId('wiz-control-keyboard').selectOption('Mouse click');
  await page.getByTestId('wiz-control-touch').selectOption('Tap');
  await expect(page.getByTestId('save-state')).toHaveText('Draft saved', { timeout: 10_000 });

  // Step 3: all three covers and the landscape video are required.
  await page.getByTestId('wiz-next').click();
  for (const [kind, w, h] of [['cover_landscape', 1920, 1080], ['cover_portrait', 800, 1200], ['cover_square', 800, 800]] as const) {
    await page.getByTestId(`media-input-${kind}`).setInputFiles({ name: `${kind}.png`, mimeType: 'image/png', buffer: await cover(w, h) });
    await expect(page.getByTestId(`media-${kind}`).locator('img')).toBeVisible({ timeout: 20_000 });
  }
  await page.getByTestId('media-input-preview_landscape').setInputFiles(PREVIEW_VIDEO);
  await expect(page.getByTestId('media-preview_landscape').locator('video')).toBeVisible({ timeout: 20_000 });

  // Step 4: build, unzipped and checked in the browser, uploaded, pre-QA.
  await page.getByTestId('wiz-next').click();
  // Before a build: the checklist says why the row is not ticked.
  await expect(page.getByTestId('wiz-check-why').first()).toContainText('No build uploaded yet');
  // Dropping a valid zip uploads it. No checks run on the developer side: they start on the
  // server after submitting, and their reports go to the moderators.
  await page.getByTestId('zip-input').setInputFiles({ name: 'probe.zip', mimeType: 'application/zip', buffer: await probeZip() });
  await expect(page.getByTestId('build-status')).toHaveAttribute('data-qa', 'uploaded', { timeout: 120_000 });
  await expect(page.getByTestId('pre-qa-report')).toHaveCount(0);
  // The preview is a required step: play the build there, then Continue back to submitting.
  await expect(page.getByTestId('wiz-check').and(page.locator('[data-ok="false"]')).first()).toBeVisible();
  await page.getByTestId('wiz-open-preview').click();
  await expect(page.getByTestId('game-frame')).toHaveAttribute('data-phase', 'playing', { timeout: 60_000 });
  await page.locator('[data-testid="preview-continue"]:visible').first().click();
  await expect(page.getByTestId('wiz-open-preview')).toHaveCount(0, { timeout: 20_000 });

  // 4. Submit for review: only once the rights boxes are ticked.
  await expect(page.getByTestId('wiz-submit')).toBeDisabled();
  await page.getByTestId('wiz-owns-rights').check();
  await page.getByTestId('wiz-no-copies').check();
  await expect(page.getByTestId('wiz-check').and(page.locator('[data-ok="false"]'))).toHaveCount(0);
  await page.getByTestId('wiz-submit').click();
  await expect(page.getByTestId('game-status').first()).toHaveText('In review', { timeout: 120_000 });
  // The 72-hour review promise is shown with its deadline.
  await expect(page.getByTestId('review-promise')).toContainText("We'll review it by");

  // 5. Admin approves to Spark.
  await page.goto(`${ADMIN}/qa/`);
  await page.getByRole('button', { name: 'Log in' }).first().click();
  await signIn(page, 'admin@example.test', 'qa_admin', '1985');
  await unlockOwner(page, 'admin@example.test');
  await expect(page.getByTestId('qa-row')).toHaveCount(1);
  await expect(page.getByTestId('qa-due')).toContainText(/hours left/);
  await page.getByTestId('qa-review-link').click();
  // The automatic moderation ran first: an original game from a new studio is clear.
  await expect(page.getByTestId('auto-review')).toContainText('Rights declaration');
  await expect(page.getByTestId('auto-check').and(page.locator('[data-status="fail"]'))).toHaveCount(0);
  await expect(page.getByTestId('auto-risk')).toContainText('Risk');
  // The test-play report is here, for the moderator, and nothing was rejected automatically.
  await expect(page.getByTestId('test-play')).toBeVisible();
  const report = page.getByTestId('pre-qa-report');
  await expect(report.locator('[data-check="sdk"]')).toHaveAttribute('data-check-status', 'pass');
  await expect(report.locator('[data-check="gameplay-event"]')).toHaveAttribute('data-check-status', 'pass');
  await expect(report.locator('[data-check="absolute-paths"]')).toHaveAttribute('data-check-status', 'pass');
  // Every detail for the manual decision: store page, build, rights declaration, studio record.
  const details = page.getByTestId('review-details');
  await expect(details).toContainText('Probe Quest');
  await expect(details).toContainText('Press a button');
  await expect(page.getByTestId('review-declaration')).toContainText('Yes');
  await expect(page.getByTestId('review-studio')).toContainText('Probe Studio');
  await expect(page.getByTestId('review-media').locator('img')).toHaveCount(3);
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
  await expect(page.getByTestId('dev-game-row').getByTestId('game-status')).toHaveText('Basic Launch');
  await page.getByRole('link', { name: 'KPIs' }).click();
  await expect(page.getByTestId('kpi-page').locator('[data-kpi="plays"] dd').first()).not.toHaveText('0');

  // 8. No bait-and-switch: a live game's new title waits for review; players keep the old one.
  await page.goto(`${DEV}/`);
  await page.getByTestId('dev-game-row').getByRole('link', { name: 'Edit' }).first().click();
  await expect(page.getByTestId('live-changes-info')).toBeVisible();
  await page.getByTestId('wiz-title').fill('Totally Different Game');
  await expect(page.getByTestId('save-state')).toHaveText('Draft saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId('live-changes')).toContainText('Title');
  await expect(page.getByTestId('wiz-title')).toHaveValue('Totally Different Game');
  await page.goto('/game/probe-quest/');
  await expect(page.getByRole('heading', { level: 1, name: 'Probe Quest' })).toBeVisible();

  // Staff see the change beside the live value and approve it.
  await page.goto(`${ADMIN}/qa/`);
  if (await page.getByTestId('owner-code').isVisible().catch(() => false)) await unlockOwner(page, 'admin@example.test');
  const change = page.getByTestId('live-change');
  await expect(change).toHaveCount(1);
  await expect(change.getByTestId('live-change-new')).toHaveText('Totally Different Game');
  await change.getByTestId('live-change-approve').click();
  await expect(page.getByTestId('live-change')).toHaveCount(0);
  await page.goto('/game/probe-quest/');
  await expect(page.getByRole('heading', { level: 1, name: 'Totally Different Game' })).toBeVisible();
});
