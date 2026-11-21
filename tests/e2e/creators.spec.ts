import { ADMIN, addGame, deleteUpload, expect, resetSite, signIn, test, unlockOwner, uploadProbe } from './helpers';

/**
 * Phase 1 (Share & Earn): a player applies to the creator program, staff approve them in the
 * management portal, the creator's link is shown in their dashboard, and a visitor who arrives
 * through that link and plays a game is counted for the creator.
 */
test('creator program: apply, approve, link, visitor counted', async ({ page, browser, request }) => {
  test.setTimeout(150_000);
  const prefix = 'e2e/creator-probe/1';
  await resetSite(page);
  await uploadProbe(request, prefix);
  await addGame(page, { slug: 'creator-probe', title: 'Creator Probe', storagePrefix: prefix, status: 'rise', usesSdk: true });

  // 1. A player applies.
  await page.goto('/creators/');
  await page.getByTestId('creator-login').click();
  await signIn(page, 'reels@example.test', 'reels_maker');
  await page.getByTestId('creator-handle').fill('ReelsMaker');
  await page.getByTestId('creator-channel').fill('https://youtube.com/@reelsmaker');
  await page.getByTestId('creator-about').fill('Gaming Shorts for Indian players, about 20k subscribers.');
  await expect(page.getByTestId('creator-submit')).toBeDisabled();
  await page.getByTestId('creator-agree').check();
  await page.getByTestId('creator-submit').click();
  await expect(page.getByTestId('creator-applied')).toBeVisible();

  // 2. Staff approve it.
  const admin = await browser.newPage();
  await admin.goto(`${ADMIN}/creators/`);
  await admin.getByRole('button', { name: 'Log in' }).first().click();
  await signIn(admin, 'admin@example.test', 'creator_admin', '1985');
  await unlockOwner(admin, 'admin@example.test');
  const row = admin.getByTestId('admin-creator-row').filter({ hasText: '@reelsmaker' });
  await expect(row).toBeVisible();
  await row.getByTestId('admin-creator-approve').click();
  await expect(admin.getByTestId('admin-creator-row')).toHaveCount(0);
  await admin.close();

  // 3. The creator sees their links.
  await page.goto('/creators/dashboard/');
  await expect(page.getByTestId('creator-home-link')).toContainText('?cr=reelsmaker');
  await expect(page.getByTestId('creator-game-link')).toContainText('/game/creator-probe/?cr=reelsmaker');

  // 4. A visitor arrives through the link and plays: the creator's numbers count it.
  const visitor = await browser.newPage();
  await visitor.goto('/game/creator-probe/?cr=reelsmaker');
  await visitor.getByTestId('play-button').click();
  await expect(visitor.frameLocator('[data-testid="game-iframe"]').getByTestId('probe-env')).toHaveText('brainstorming', { timeout: 20_000 });
  await visitor.waitForTimeout(2500);
  await visitor.close();

  await page.reload();
  await expect(page.getByTestId('creator-stat-plays')).toHaveText('1', { timeout: 15_000 });
  await deleteUpload(request, prefix);
});
