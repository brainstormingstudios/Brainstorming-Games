import { addGame, deleteUpload, expect, resetSite, test, uploadProbe } from './helpers';

/**
 * Phase 1 acceptance: with no games every page shows its empty state; a game added through the
 * mock data layer shows up in rails, search and its own page, and plays in the frame.
 */
test.describe('catalogue', () => {
  test.beforeEach(async ({ page }) => {
    await resetSite(page);
  });

  test('an empty site shows friendly empty states everywhere', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('hero-publish')).toBeVisible();
    await expect(page.getByTestId('hero-publish-cta')).toHaveAttribute('href', '/developers/');
    await expect(page.getByTestId('rail-trending').getByTestId('shelf-empty')).toBeVisible();
    await expect(page.getByTestId('rail-fresh').getByTestId('shelf-empty')).toBeVisible();
    await expect(page.getByTestId('game-tile')).toHaveCount(0);

    await page.goto('/c/puzzle/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Puzzle');
    await expect(page.getByText('Games are on the way')).toBeVisible();

    await page.goto('/new/');
    await expect(page.getByText('Games are on the way')).toBeVisible();

    await page.goto('/tags/');
    await expect(page.getByText('No tags yet')).toBeVisible();

    await page.goto('/search/?q=anything');
    await expect(page.getByText('No games match “anything”')).toBeVisible();

    await page.goto('/favourites/');
    await expect(page.getByText('No favourites yet')).toBeVisible();

    await page.goto('/recent/');
    await expect(page.getByText('Nothing played yet')).toBeVisible();
  });

  test('unknown pages get the sad-mascot 404 with a 404 status', async ({ page }) => {
    const response = await page.goto('/definitely/not/here/');
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('not-found')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();

    await page.goto('/game/no-such-game/');
    await expect(page.getByText('We could not find that game')).toBeVisible();
  });

  test('a game added through the mock data layer appears, is searchable and plays', async ({ page, request }) => {
    const prefix = `e2e-catalogue-${test.info().project.name}/1`;
    await uploadProbe(request, prefix);
    try {
      await page.goto('/');
      await addGame(page, { slug: 'probe-quest', title: 'Probe Quest', storagePrefix: prefix, tags: ['fixture', 'logic'] });

      // Rails update live, without a reload.
      const fresh = page.getByTestId('rail-fresh');
      await expect(fresh.getByTestId('game-tile')).toHaveCount(1);
      await expect(fresh.getByText('Probe Quest')).toBeVisible();
      await expect(page.getByTestId('rail-new').getByText('Probe Quest')).toBeVisible();
      await expect(page.getByTestId('rail-made-in-india').getByText('Probe Quest')).toBeVisible();

      // Category, tag and search all find it.
      await page.goto('/c/puzzle/');
      await expect(page.getByTestId('game-tile')).toHaveCount(1);
      await page.goto('/t/logic/');
      await expect(page.getByTestId('game-tile')).toHaveCount(1);
      await page.goto('/tags/');
      await expect(page.getByRole('link', { name: /Logic/ })).toBeVisible();

      await page.goto('/');
      // On phones search is an icon that opens the search bar.
      const openSearch = page.getByTestId('search-open');
      if (await openSearch.isVisible()) await openSearch.click();
      await page.getByTestId('search-input').fill('probe');
      await expect(page.getByTestId('search-results').getByText('Probe Quest')).toBeVisible();
      await page.getByTestId('search-input').press('Enter');
      await expect(page).toHaveURL(/\/search\/\?q=probe/);
      await expect(page.getByTestId('search-page-results').getByText('Probe Quest')).toBeVisible();

      // The game page is resolved in the browser because the game is newer than the build.
      await page.getByTestId('search-page-results').getByTestId('game-tile').click();
      await expect(page).toHaveURL(/\/game\/probe-quest\/$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Probe Quest' })).toBeVisible();
      await expect(page.getByTestId('info-strip')).toContainText('Probe Studio');
      await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible();

      // Nothing from the game loads until Play is pressed.
      await expect(page.getByTestId('game-iframe')).toHaveCount(0);
      await page.getByTestId('play-button').click();
      const frame = page.frameLocator('[data-testid="game-iframe"]');
      await expect(frame.getByRole('heading', { name: 'SDK probe' })).toBeVisible();
      await expect(page.getByTestId('game-frame')).toHaveAttribute('data-phase', 'playing');

      const iframe = page.getByTestId('game-iframe');
      await expect(iframe).toHaveAttribute('sandbox', /allow-scripts allow-same-origin allow-pointer-lock/);
      // Every game runs on its own origin (g-<folder>.localhost here, g-<id>.<games domain> live).
      await expect(iframe).toHaveAttribute('src', new RegExp(`^http://g-${prefix.split('/')[0]}\\.localhost:4100/1/`));
    } finally {
      await deleteUpload(request, prefix.split('/')[0]!);
    }
  });

  test('rating, favouriting and history work for a guest', async ({ page, request }) => {
    const prefix = `e2e-rate-${test.info().project.name}/1`;
    await uploadProbe(request, prefix);
    try {
      await page.goto('/');
      await addGame(page, { slug: 'probe-rate', title: 'Probe Rate', storagePrefix: prefix });
      await page.goto('/game/probe-rate/');

      await page.getByTestId('like-button').click();
      await expect(page.getByTestId('like-count')).toHaveText('1');
      await expect(page.getByTestId('like-button')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('info-strip')).toContainText('/ 10');

      // Changing to a dislike offers optional reasons.
      await page.getByTestId('dislike-button').click();
      await expect(page.getByTestId('like-count')).toHaveText('0');
      await expect(page.getByTestId('dislike-count')).toHaveText('1');
      await page.getByTestId('dislike-reasons').getByRole('button', { name: 'Too hard' }).click();
      await expect(page.getByText('Thanks, the developer will see this.')).toBeVisible();

      await page.getByTestId('favourite-button').click();
      await expect(page.getByTestId('favourite-button')).toHaveAttribute('aria-pressed', 'true');

      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('game-frame')).toHaveAttribute('data-phase', 'playing');

      await page.goto('/favourites/');
      await expect(page.getByTestId('game-tile')).toHaveCount(1);
      await page.goto('/recent/');
      await expect(page.getByTestId('game-tile')).toHaveCount(1);
      await page.goto('/');
      await expect(page.getByTestId('rail-continue').getByText('Probe Rate')).toBeVisible();
    } finally {
      await deleteUpload(request, prefix.split('/')[0]!);
    }
  });

  test('theme and low-data mode are remembered', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem('bg.prefs') ?? '{}');
      localStorage.setItem('bg.prefs', JSON.stringify({ ...prefs, theme: 'light', lowData: true }));
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-low-data', 'true');
  });

  test('policy pages are marked as drafts and the developers page shows the share table', async ({ page }) => {
    await page.goto('/privacy/');
    await expect(page.getByTestId('draft-notice')).toContainText('Draft, pending legal review');
    await page.goto('/developers/');
    await expect(page.getByRole('cell', { name: '70% of net' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '85% of net' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '80% of net' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '75% of net after payment fees' })).toBeVisible();
  });
});
