import { expect, resetSite, signIn, test } from './helpers';

/** Paid features are for India only for now; the management portal is invisible on public sites. */
test('a visitor outside India sees no way to pay; the player site never points to the manager', async ({ page }) => {
  await resetSite(page);
  // Mock mode reads the visitor's country from localStorage (the live site asks the server).
  await page.evaluate(() => window.localStorage.setItem('bg.country', 'US'));
  await page.goto('/premium/');
  await expect(page.getByTestId('india-only')).toBeVisible();
  await expect(page.getByTestId('buy-plus')).toBeDisabled();

  // In India the plans can be bought.
  await page.evaluate(() => window.localStorage.setItem('bg.country', 'IN'));
  await page.reload();
  await expect(page.getByTestId('india-only')).toHaveCount(0);
  await expect(page.getByTestId('buy-plus')).toBeEnabled();

  // Even an admin sees no link to the management portal on the player site, and its address is
  // nowhere in the page.
  await page.getByTestId('login-button').click();
  await signIn(page, 'admin@example.test', 'market_admin', '1985');
  await page.getByTestId('account-button').click();
  await expect(page.getByTestId('logout-button')).toBeVisible();
  await expect(page.getByTestId('admin-link')).toHaveCount(0);
  expect(await page.content()).not.toContain('localhost:3002');
});
