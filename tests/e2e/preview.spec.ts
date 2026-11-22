import JSZip from 'jszip';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, expect, resetSite, signIn, test } from './helpers';

/**
 * A real game build (Project Homecoming) whose index.html loads bg-sdk.js from its own folder
 * but does not ship the file: the uploader adds the official SDK, pre-QA sees the SDK, and the
 * preview page shows the requirements panel, the live SDK checks and the test settings.
 */
test('uploading a real build adds the SDK, and the preview shows the requirements panel', async ({ page }) => {
  test.setTimeout(300_000);
  await resetSite(page);
  const dir = join(process.cwd(), 'games', 'project-homecoming');
  const zip = new JSZip();
  for (const name of readdirSync(dir).filter((n) => n !== 'bg-sdk.js')) zip.file(`project-homecoming/${name}`, readFileSync(join(dir, name)));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  await page.goto(`${DEV}/`);
  await page.getByTestId('dev-login').click();
  await signIn(page, 'homecoming@example.test', 'homecoming_dev', '1990');
  await page.getByTestId('studio-name').fill('Homecoming Test Studio');
  await page.getByTestId('studio-terms').check();
  await page.getByTestId('studio-create').click();
  await page.getByTestId('new-game').click();
  await page.getByTestId('wiz-title').fill('Homecoming Upload Test');
  await page.getByTestId('wiz-short').fill('A real build, uploaded by a test.');
  await page.getByTestId('wiz-category').selectOption('puzzle');
  await page.getByTestId('wiz-tags').fill('space, story, three,');
  await page.getByTestId('wiz-create').click();
  await expect(page).toHaveURL(/step=page/);
  await page.goto(page.url().replace('step=page', 'step=build'));

  await page.getByTestId('zip-input').setInputFiles({ name: 'homecoming.zip', mimeType: 'application/zip', buffer });
  // The build row of the checklist ticks as soon as the build is uploaded (no checks run here).
  await expect(page.getByTestId('build-status')).toHaveAttribute('data-qa', 'uploaded', { timeout: 200_000 });
  await expect(page.getByTestId('wiz-check').nth(4)).toHaveAttribute('data-ok', 'true');

  // The private preview, opened from the game page.
  await page.goto(page.url().replace(/\/games\/edit\/?\?/, '/games/view/?').replace(/&step=\w+/, ''));
  const href = await page.getByTestId('preview-link').getAttribute('href');
  await page.goto(href!);
  await expect(page.getByTestId('preview-panel')).toBeVisible();
  await expect(page.getByTestId('req-basic')).toBeVisible();
  await expect(page.getByTestId('req-size')).toHaveAttribute('data-status', 'pass');
  await expect(page.getByTestId('preview-total-size')).not.toHaveText('0 B');
  await expect(page.getByTestId('preview-qa-state')).toContainText('not been sent');
  await page.getByTestId('preview-qr-toggle').click();
  await expect(page.getByTestId('preview-qr')).toBeVisible();
  // The SDK connects live in the preview: the first Rise row ticks.
  await page.getByRole('button', { name: /Full Launch: SDK requirements/ }).click();
  await expect(page.getByTestId('sdk-check').first()).toHaveAttribute('data-status', 'pass', { timeout: 30_000 });
  await page.getByRole('tab', { name: /Log/ }).click();
  await expect(page.getByTestId('sdk-log')).toContainText('hello');
  await page.getByTestId('preview-relaunch').click();
  await page.getByRole('tab', { name: /Log/ }).click();
  await expect(page.getByTestId('sdk-log')).toContainText('hello', { timeout: 30_000 });
  await expect(page.getByTestId('preview-test-ads')).toBeChecked();
  await page.getByRole('tab', { name: /Requirements/ }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '.local/look/preview-page.png' });
});
