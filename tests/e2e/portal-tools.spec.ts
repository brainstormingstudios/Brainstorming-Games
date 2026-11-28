import { ADMIN, expect, resetSite, signIn, test, unlockOwner } from './helpers';

/** Management portal: ad spaces on a site preview, and pages written by admins. */
test('admins switch ad spaces off and publish pages', async ({ page }) => {
  await resetSite(page);
  await page.goto(`${ADMIN}/ads/`);
  await page.getByTestId('login-button').click();
  await signIn(page, 'admin@example.test', 'tools_admin', '1980');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await unlockOwner(page, 'admin@example.test');
  await expect(page.getByTestId('ads-manager')).toBeVisible();
  await page.getByTestId('slot-home-rail').click();
  await expect(page.getByTestId('slot-home-rail')).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'C:/Users/Hayaan/AppData/Local/Temp/claude/ef9f19510ed22f24/a4b99612-5996-4b59-8dde-b59725976b81/scratchpad/ads-manager.png', fullPage: true });
  await page.getByTestId('ads-save').click();
  await expect(page.getByTestId('ads-save')).toBeDisabled();

  await page.goto(`${ADMIN}/pages/`);
  await page.getByTestId('page-new').click();
  await page.getByLabel('Title').fill('Winter event');
  await page.getByLabel('Address').fill('winter');
  await page.getByLabel('Text').fill('# Snow games\n\nPlay **all week**.');
  await page.getByTestId('page-editor').getByRole('switch', { name: 'Published' }).check({ force: true });
  await page.getByTestId('page-save').click();
  await expect(page.getByTestId('page-editor')).toHaveCount(0);

  await page.goto('/page/?s=winter');
  await expect(page.getByTestId('site-page')).toContainText('Snow games');
});
