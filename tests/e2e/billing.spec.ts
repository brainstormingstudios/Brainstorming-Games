import { ADMIN, DEV, addGame, deleteUpload, expect, resetSite, signIn, test, unlockOwner, uploadProbe } from './helpers';

/**
 * v3: a player buys Plus (test checkout), a studio buys a Boost for its live game, the team posts
 * the videos from the management portal, and the boosted game shows as Sponsored on the home page.
 */
test('premium membership, Boost order, promotions queue and sponsored placement', async ({ page, request }) => {
  test.setTimeout(180_000);
  const prefix = 'e2e-billing/1';
  await uploadProbe(request, prefix);
  try {
    await resetSite(page);

    // A player buys Plus. The local build's checkout is a clearly marked test.
    await page.goto('/premium/');
    await page.getByTestId('login-button').click();
    await signIn(page, 'member@example.test', 'plus_member');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.getByTestId('buy-plus').click();
    await expect(page.getByTestId('test-checkout')).toContainText('₹99');
    await page.getByTestId('test-pay').click();
    await expect(page.getByTestId('membership')).toContainText('Plus');
    await expect(page.getByTestId('premium-chip')).toContainText('Plus');
    await expect(page.getByTestId('wallpapers').locator('img')).toHaveCount(3);

    // A studio with a live game buys the Push Boost.
    await page.goto(`${DEV}/`);
    await page.getByTestId('dev-login').click();
    await signIn(page, 'booster@example.test', 'boost_studio');
    // addGame() publishes under the studio address probe-studio, which this name creates.
    await page.getByTestId('studio-name').fill('Probe Studio');
    await page.getByTestId('studio-terms').check();
    await page.getByTestId('studio-create').click();
    await expect(page.getByTestId('dev-dashboard')).toBeVisible();
    await addGame(page, { slug: 'probe-boost', title: 'Probe Boost', storagePrefix: prefix, status: 'rise' });
    await page.goto(`${DEV}/boost/`);
    await page.getByTestId('buy-boost-push').click();
    await expect(page.getByTestId('test-checkout')).toContainText('₹1,499');
    await page.getByTestId('test-pay').click();
    await expect(page.getByTestId('boost-order')).toContainText('Paid, in production');

    // The team posts the videos and pastes the links; the studio sees them.
    await page.goto(`${ADMIN}/promotions/`);
    await page.getByTestId('login-button').click();
    await signIn(page, 'admin@example.test', 'promo_admin', '1980');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await unlockOwner(page, 'admin@example.test');
    const row = page.getByTestId('promotion-row');
    await expect(row).toContainText('Probe Boost');
    await row.getByTestId('short-links').fill('https://youtube.com/shorts/abc123');
    await row.getByTestId('reel-links').fill('https://instagram.com/reel/xyz789');
    await row.getByTestId('save-links').click();
    await expect(page.getByTestId('promotion-row').getByRole('link', { name: 'Short 1' })).toBeVisible();
    await page.goto(`${ADMIN}/payments/`);
    await expect(page.getByTestId('payment-row')).toHaveCount(2);
    await page.goto(`${DEV}/boost/`);
    await expect(page.getByTestId('boost-order').getByRole('link', { name: 'Reel 1' })).toHaveAttribute('href', 'https://instagram.com/reel/xyz789');

    // On the home page the boosted game carries a Sponsored label.
    await page.goto('/');
    await expect(page.locator('[data-testid="game-tile"][data-slug="probe-boost"]').first().getByTestId('sponsored-badge')).toBeVisible();
  } finally {
    await deleteUpload(request, 'e2e-billing');
  }
});
