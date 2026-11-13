import { expect, test, type Page } from '@playwright/test';
import { addGame, resetSite, signIn as signInDialog, testCover } from './helpers';

async function signIn(page: Page, email: string, username: string, birthYear = '1990') {
  await signInDialog(page, email, username, birthYear);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

/**
 * Phase 5: three people in three tabs (one shared mock database, separate sessions).
 * A developer, a player on the playtest panel and an admin exercise thumbnail tests, the
 * playtest survey, studio follows and devlogs, a jam, moderation, the quest editor and the
 * featured row.
 */
test('thumbnail test, playtest, follow + devlog, jam, moderation and editors', async ({ context }) => {
  test.setTimeout(240_000);
  const dev = await context.newPage();
  await resetSite(dev);

  // The developer creates a studio; its Spark game has two covers, so a thumbnail test runs.
  await dev.goto('/dev/');
  await dev.getByTestId('dev-login').click();
  await signIn(dev, 'studio@example.test', 'studio_owner');
  await dev.getByTestId('studio-name').fill('Probe Studio');
  await dev.getByTestId('studio-terms').check();
  await dev.getByTestId('studio-create').click();
  await expect(dev.getByTestId('dev-dashboard')).toBeVisible();
  const gameId = await addGame(dev, {
    slug: 'probe-jam',
    title: 'Probe Jam',
    storagePrefix: 'e2e-growth/1',
    status: 'spark',
    media: [testCover('A', '#0c2a6e'), testCover('B', '#8a1c1c')],
  });

  // A player sees one of the two covers (always the same one) and joins the playtest panel.
  const player = await context.newPage();
  await player.goto('/');
  const tile = player.locator('[data-testid="game-tile"][data-slug="probe-jam"]').first();
  await expect(tile).toHaveAttribute('data-variant', /^[AB]$/);
  const variant = await tile.getAttribute('data-variant');
  await player.getByTestId('login-button').click();
  await signIn(player, 'player@example.test', 'playtester');
  await player.goto('/settings/');
  // The switch reflects the saved profile, so it flips a moment after the click.
  await player.getByTestId('playtest-optin').click({ force: true });
  await expect(player.getByTestId('playtest-optin')).toBeChecked();

  // Clicking the tile counts a click for that cover and opens the game with the survey.
  await player.goto('/');
  await expect(tile).toHaveAttribute('data-variant', variant!);
  await tile.click();
  await expect(player).toHaveURL(/\/game\/probe-jam\//);
  const survey = player.getByTestId('playtest-card');
  await expect(survey).toBeVisible();
  await player.getByTestId('playtest-fun-5').click();
  await player.getByTestId('playtest-clarity-4').click();
  await player.getByTestId('playtest-again-yes').click();
  await player.getByTestId('playtest-send').click();
  await expect(survey).toHaveCount(0);
  await expect(player.getByTestId('points-chip')).toContainText('15');

  // The player follows the studio and reports it.
  await player.goto('/studio/probe-studio/');
  await player.getByTestId('follow-button').click();
  await expect(player.getByTestId('follow-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(player.getByTestId('follower-count')).toHaveText('1 follower');
  await player.getByTestId('report-link').first().click();
  await player.getByTestId('report-reason').fill('The studio page links to a scam site.');
  await player.getByTestId('report-send').click();
  await expect(player.getByText('Thanks. A moderator will take a look.')).toBeVisible();

  // The developer publishes a devlog: the follower is notified and it shows on the studio page.
  await dev.goto('/dev/devlogs/');
  await dev.getByRole('button', { name: 'New post' }).click();
  await dev.getByLabel('Title').fill('Winter update');
  await dev.getByLabel('Post', { exact: true }).fill('We added **snow levels** and fixed the jump bug.');
  await dev.getByRole('button', { name: 'Publish' }).click();
  await expect(dev.getByText('Published.')).toBeVisible();
  // A background tab may be throttled, so load the page again rather than rely on the live refresh.
  await player.reload();
  await expect(player.getByTestId('devlog-post')).toContainText('Winter update', { timeout: 10_000 });
  await expect(player.getByTestId('notifications-bell')).toHaveAccessibleName(/unread/);
  await player.goto('/blog/');
  await expect(player.getByTestId('devlog-post')).toContainText('snow levels');

  // The developer sees the thumbnail test and the playtest answers.
  await dev.goto(`/dev/games/view/?id=${gameId}`);
  const abRow = dev.getByTestId('ab-row').filter({ hasText: new RegExp(`^${variant}`) });
  // One impression per page view that showed the tile, and exactly one click.
  await expect(abRow.locator('td').nth(1)).toHaveText('1');
  expect(Number(await abRow.locator('td').nth(0).textContent())).toBeGreaterThanOrEqual(1);
  await expect(dev.getByTestId('ab-panel')).toContainText('Test running.');
  await expect(dev.getByTestId('playtest-panel')).toContainText('5.0 / 5');
  await expect(dev.getByTestId('playtest-panel')).toContainText('100.0%');

  // An admin opens a jam; the developer enters; the admin ranks the entry.
  const admin = await context.newPage();
  await admin.goto('/admin/jams/');
  await admin.getByTestId('login-button').click();
  await signIn(admin, 'admin@example.test', 'site_admin', '1980');
  await admin.getByTestId('jam-new').click();
  await admin.getByTestId('jam-title').fill('Winter Jam');
  await admin.getByTestId('jam-slug').fill('winter-jam');
  await admin.getByTestId('jam-theme').fill('Snow');
  await admin.getByTestId('jam-status').selectOption('published');
  await admin.getByTestId('jam-save').click();
  await expect(admin.getByTestId('jam-row')).toContainText('Winter Jam');

  await dev.goto('/jams/');
  await dev.getByTestId('jam-card').click();
  await expect(dev.getByTestId('jam-page')).toContainText('Theme: Snow');
  await dev.getByTestId('jam-enter').click();
  await expect(dev.getByTestId('jam-entry')).toHaveCount(1);

  await admin.getByTestId('jam-row').getByLabel('Rank').selectOption('1');
  await player.goto('/jams/view/?slug=winter-jam');
  await expect(player.getByTestId('jam-entry')).toContainText('Rank #1');

  // Moderation: the report is in the queue; the devlog can be hidden.
  await admin.goto('/admin/moderation/');
  const report = admin.getByTestId('report-row');
  await expect(report).toContainText('Probe Studio');
  await expect(report).toContainText('scam site');
  await admin.getByTestId('report-action').click();
  await expect(report).toContainText('Actioned');
  await admin.getByRole('tab', { name: 'Devlogs' }).click();
  await admin.getByTestId('devlog-hide').click();
  await expect(admin.getByTestId('devlog-row')).toContainText('Hidden');
  await player.goto('/blog/');
  await expect(player.getByText('No posts yet')).toBeVisible();
  await expect(player.getByTestId('devlog-post')).toHaveCount(0);

  // Quest editor: a new reward is saved and shown.
  await admin.goto('/admin/progression/');
  const quest = admin.getByTestId('quest-row').first();
  await quest.getByTestId('quest-reward').fill('33');
  await quest.getByTestId('quest-save').click();
  await expect(admin.getByText('Saved.')).toBeVisible();
  await expect(admin.getByTestId('quest-row').first().getByTestId('quest-reward')).toHaveValue('33');

  // Featured row: picked in the admin console, live on the homepage straight away.
  await admin.goto('/admin/home/');
  await admin.getByTestId('featured-picker-add').click();
  await admin.getByTestId('featured-save').click();
  await expect(admin.getByText('Homepage saved.')).toBeVisible();
  await player.goto('/');
  await expect(player.getByTestId('rail-featured').locator('[data-slug="probe-jam"]')).toBeVisible();
});
