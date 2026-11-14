import { expect, test } from '@playwright/test';
import { ADMIN, DEV, addGame, deleteUpload, resetSite, signIn, uploadProbe } from './helpers';

/**
 * Phase 4: in-game ads through the SDK create impressions; the admin uploads a revenue CSV,
 * previews and publishes statements; the studio sees its statement, downloads the PDF and saves
 * payout details.
 */
test('ad impressions → revenue CSV → statement → payout details', async ({ page, request }) => {
  test.setTimeout(180_000);
  const prefix = 'e2e-revenue/1';
  await uploadProbe(request, prefix);
  try {
    await resetSite(page);

    // A studio with a game in Rise Launch (ads on).
    await page.goto(`${DEV}/`);
    await page.getByTestId('dev-login').click();
    await signIn(page, 'studio@example.test', 'studio_owner');
    await page.getByTestId('studio-name').fill('Probe Studio');
    await page.getByTestId('studio-terms').check();
    await page.getByTestId('studio-create').click();
    await expect(page.getByTestId('dev-dashboard')).toBeVisible();
    await addGame(page, { slug: 'probe-rise', title: 'Probe Rise', storagePrefix: prefix, status: 'rise' });

    // A player watches a rewarded ad (mock provider: 5 seconds).
    await page.goto('/game/probe-rise/');
    await page.getByTestId('play-button').click();
    const probe = page.frameLocator('[data-testid="game-iframe"]');
    await expect(probe.getByTestId('probe-env')).toHaveText('brainstorming');
    await probe.getByTestId('probe-rewarded').click();
    await expect(page.getByTestId('mock-ad')).toBeVisible();
    await expect(probe.getByTestId('probe-log')).toContainText('"rewarded":true', { timeout: 15_000 });
    // A second one straight away is refused: no chaining.
    await probe.getByTestId('probe-rewarded').click();
    await expect(probe.getByTestId('probe-log')).toContainText('"reason":"chained"');
    await page.goto('/');

    // The admin runs the month.
    await page.goto(`${ADMIN}/revenue/`);
    await page.getByTestId('login-button').click();
    await signIn(page, 'admin@example.test', 'finance_admin', '1980');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.getByLabel('Month').fill(new Date().toISOString().slice(0, 7));
    await page.getByTestId('revenue-csv').fill('country,gross,refunds,invalid_traffic\nALL,120.00,10.00,10.00');
    await page.getByTestId('revenue-preview').click();
    const statement = page.getByTestId('revenue-statement');
    await expect(statement).toHaveCount(1);
    // Net 100.00 × 70% = 70.00, above the $25 threshold.
    await expect(statement).toContainText('Probe Studio');
    await expect(statement).toContainText('$70.00');
    await page.getByTestId('revenue-finalise').click();
    await expect(page.getByText('Statements published to studios.')).toBeVisible();

    // The studio sees it, downloads the PDF and adds payout details.
    await page.goto(`${DEV}/payouts/`);
    await expect(page.getByTestId('statement-row')).toContainText('Due $70.00');
    const download = page.waitForEvent('download');
    await page.getByTestId('statement-row').getByRole('button', { name: 'PDF' }).click();
    expect((await download).suggestedFilename()).toMatch(/^statement-\d{4}-\d{2}-probe-studio\.pdf$/);

    await page.getByLabel('Method').selectOption('paypal');
    await page.getByLabel('Currency').selectOption('USD');
    await page.getByLabel('Account holder’s full name').fill('Probe Studio Owner');
    await page.getByLabel('Account e-mail').fill('payouts@example.test');
    await page.getByRole('button', { name: 'Save payout details' }).click();
    await expect(page.getByTestId('payouts-page')).toContainText('PayPal pa•••@example.test');
  } finally {
    await deleteUpload(request, 'e2e-revenue');
  }
});

test.describe('consent banner', () => {
  test.use({ timezoneId: 'Europe/Berlin' });
  test('EU visitors are asked first, can reject, and can change their mind', async ({ page }) => {
    await resetSite(page);
    await page.goto('/');
    const banner = page.getByTestId('consent-banner');
    await expect(banner).toBeVisible();
    await page.getByTestId('consent-reject').click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('consent-banner')).toHaveCount(0);
    await page.goto('/cookies/');
    await page.getByTestId('cookie-choices').click();
    await expect(page.getByTestId('consent-banner')).toBeVisible();
  });
});
