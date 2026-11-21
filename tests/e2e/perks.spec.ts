import { ADMIN, DEV, expect, resetSite, signIn, test, unlockOwner } from './helpers';

/**
 * Phase 4 (developer perks): the starter kit downloads, and staff can set up next month's jam
 * with a sponsor and prizes that players see on the jam page.
 */
test('starter kit download and a sponsored monthly jam with prizes', async ({ page, request }) => {
  test.setTimeout(120_000);
  await resetSite(page);

  // The starter kit is a real zip on the developer portal.
  const kit = await request.get(`${DEV}/downloads/starter-kit.zip`);
  expect(kit.ok()).toBeTruthy();
  expect((await kit.body()).subarray(0, 2).toString()).toBe('PK');

  // Staff create next month's jam with a sponsor and a first prize, and publish it.
  await page.goto(`${ADMIN}/jams/`);
  await page.getByRole('button', { name: 'Log in' }).first().click();
  await signIn(page, 'admin@example.test', 'jam_admin', '1985');
  await unlockOwner(page, 'admin@example.test');
  await page.getByTestId('jam-new-monthly').click();
  await expect(page.getByTestId('jam-title')).toHaveValue(/^Brainstorming Jam: /);
  const slug = await page.getByTestId('jam-slug').inputValue();
  await page.getByTestId('jam-sponsor').fill('Acme Games');
  await page.getByLabel('Sponsor link (https)').fill('https://acme.example');
  await page.getByTestId('jam-prize').first().fill('₹10,000 and a Push Boost');
  await page.getByTestId('jam-status').selectOption('published');
  await page.getByTestId('jam-save').click();
  await expect(page.getByTestId('jam-row')).toHaveCount(1);

  // Players see the prizes and the sponsor.
  await page.goto(`/jams/view/?slug=${slug}`);
  const prizes = page.getByTestId('jam-prizes');
  await expect(prizes).toContainText('₹10,000 and a Push Boost');
  await expect(page.getByTestId('jam-sponsor-link')).toHaveAttribute('href', 'https://acme.example');
});
