import { addGame, deleteUpload, expect, resetSite, signIn, test, uploadProbe } from './helpers';

/**
 * Phase 3 (Discover & daily fun): the Early Access page lists Basic Launch games and lets a
 * player join the panel; the daily challenge shows today's game; Premium offers points swaps.
 */
test('early access, daily challenge and points for Premium days', async ({ page, request }) => {
  test.setTimeout(120_000);
  const prefix = 'e2e/discover-probe/1';
  await resetSite(page);
  await uploadProbe(request, prefix);
  await addGame(page, { slug: 'early-probe', title: 'Early Probe', storagePrefix: prefix, status: 'spark' });
  await addGame(page, { slug: 'daily-probe', title: 'Daily Probe', storagePrefix: prefix, status: 'rise' });

  // Early Access: Basic Launch games only, and a panel to join.
  await page.goto('/discover/');
  const early = page.getByTestId('early-access-games');
  await expect(early).toContainText('Early Probe');
  await expect(early).not.toContainText('Daily Probe');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await signIn(page, 'scout@example.test', 'scout_one');
  const toggle = page.getByTestId('early-access-toggle');
  await expect(toggle).not.toBeChecked();
  await toggle.check({ force: true });
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(page.getByTestId('early-access-toggle')).toBeChecked();

  // Daily challenge: today's game (only Full Launch games qualify) with a play link.
  await page.goto('/daily/');
  await expect(page.getByTestId('daily-game')).toContainText('Daily Probe');
  await expect(page.getByTestId('daily-play')).toHaveAttribute('href', /\/game\/daily-probe\/?$/);

  // Points swaps: a new player has no points yet, so the swaps say why they are unavailable.
  await page.goto('/premium/');
  const swap = page.getByTestId('points-swap');
  await expect(swap).toContainText('You have 0 Brain Points');
  await expect(page.getByTestId('points-swap-plus_1d')).toBeDisabled();
  await expect(page.getByTestId('points-plus_1d')).toContainText('Not enough Brain Points yet.');
  await deleteUpload(request, prefix);
});
