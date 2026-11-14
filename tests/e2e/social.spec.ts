import { addGame, deleteUpload, expect, resetSite, signIn, test, uploadProbe } from './helpers';

/**
 * Phase 3 acceptance: two players (two tabs: one shared mock database, separate sessions)
 * befriend each other, see each other online, start a party, move to a game together and both
 * earn quest progress. A minor's account is restricted until a parent approves.
 */
test('friends, presence, party and quests across two players', async ({ context, request }) => {
  test.setTimeout(180_000);
  const prefix = 'e2e-social/1';
  await uploadProbe(request, prefix);
  const alice = await context.newPage();
  try {
    await resetSite(alice);
    await alice.goto('/');
    await addGame(alice, { slug: 'probe-party', title: 'Probe Party', storagePrefix: prefix, category: 'puzzle' });

    // Two players sign in, one per tab.
    await alice.goto('/friends/');
    await alice.getByTestId('require-login').click();
    await signIn(alice, 'alice@example.test', 'alice');
    await expect(alice.getByTestId('friends-page')).toBeVisible();

    const bob = await context.newPage();
    await bob.goto('/friends/');
    await bob.getByTestId('require-login').click();
    await signIn(bob, 'bob@example.test', 'bob');
    await expect(bob.getByTestId('friends-page')).toBeVisible();

    // Bob sends a request, Alice accepts it.
    await bob.getByTestId('friend-username').fill('alice');
    await bob.getByTestId('friend-send').click();
    await expect(alice.getByTestId('friend-request')).toBeVisible({ timeout: 10_000 });
    await alice.getByTestId('friend-accept').click();
    await expect(alice.getByTestId('friend')).toHaveCount(1);

    // Both see the other online.
    await expect(bob.getByTestId('friend')).toHaveAttribute('data-online', 'true', { timeout: 15_000 });
    await expect(alice.getByTestId('friend')).toHaveAttribute('data-online', 'true', { timeout: 15_000 });

    // Alice starts a party; Bob joins with the link.
    await alice.goto('/party/');
    await alice.getByTestId('party-create').click();
    const room = alice.getByTestId('party-room');
    await expect(room).toBeVisible();
    const code = await room.getAttribute('data-code');
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    await bob.goto(`/party/${code}/`);
    await expect(bob.getByTestId('party-members').locator('li')).toHaveCount(2);
    await expect(alice.getByTestId('party-members').locator('li')).toHaveCount(2, { timeout: 10_000 });

    // Preset chat only.
    await bob.getByRole('button', { name: 'Ready!' }).click();
    await expect(alice.getByTestId('party-chat')).toContainText('Ready!', { timeout: 10_000 });

    // The host picks the game and everyone moves to it together.
    await alice.getByTestId('party-select').first().click();
    await alice.getByTestId('party-go').click();
    await expect(alice).toHaveURL(/\/game\/probe-party\/\?party=/, { timeout: 15_000 });
    await expect(bob).toHaveURL(/\/game\/probe-party\/\?party=/, { timeout: 15_000 });
    await expect(bob.getByTestId('party-bar')).toContainText(code!);

    // Both play: quests move for both.
    for (const page of [alice, bob]) {
      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('game-frame')).toHaveAttribute('data-phase', 'playing');
    }
    await alice.waitForTimeout(1500);
    for (const page of [alice, bob]) {
      await page.goto('/quests/');
      const progressed = page.locator('[data-testid="quest"]:not([data-progress="0"])');
      await expect(progressed.first()).toBeVisible({ timeout: 10_000 });
    }
    // Friends see what you are playing.
    await bob.goto('/game/probe-party/');
    await bob.getByTestId('play-button').click();
    await alice.goto('/friends/');
    await expect(alice.getByTestId('friend-status')).toContainText('Playing Probe Party', { timeout: 15_000 });
  } finally {
    await deleteUpload(request, 'e2e-social');
  }
});

test('a minor keeps guest-level features until a parent approves', async ({ page }) => {
  test.setTimeout(90_000);
  await resetSite(page);
  const year = String(new Date().getUTCFullYear() - 13);
  await page.goto('/friends/');
  await page.getByTestId('require-login').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByTestId('login-email').fill('kid@example.test');
  await dialog.getByTestId('login-submit').click();
  // No mailbox in tests: the 6-digit code is shown on screen.
  const code = dialog.getByTestId('dev-code').locator('strong');
  await expect(code).toBeVisible();
  await dialog.getByTestId('login-code').fill((await code.innerText()).trim());
  await dialog.getByTestId('login-code-submit').click();
  await dialog.getByTestId('signup-username').fill('young_player');
  await dialog.getByTestId('signup-birth-year').fill(year);
  await dialog.getByTestId('signup-submit').click();

  // The consent step appears; the parent link is shown in mock mode.
  await expect(dialog.getByTestId('consent-step')).toBeVisible();
  await dialog.getByTestId('parent-email').fill('parent@example.test');
  await dialog.getByTestId('consent-submit').click();
  const link = await dialog.getByTestId('consent-dev-link').getAttribute('href');
  expect(link).toContain('/parents/consent/?token=');
  await dialog.getByTestId('consent-done').click();

  // Restricted: no friends, no public profile.
  await expect(page.getByTestId('restricted-notice')).toBeVisible();
  await page.goto('/u/young_player/');
  await expect(page.getByTestId('profile-page')).toBeVisible(); // visible to themselves only
  await page.goto('/leaderboards/');
  await expect(page.getByTestId('leaderboards-page')).toBeVisible();

  // The parent approves.
  await page.goto(link!);
  await expect(page.getByTestId('consent-page')).toContainText('young_player');
  await page.getByTestId('consent-approve').click();
  await expect(page.getByTestId('consent-result')).toContainText('approved');

  // Social features are on now.
  await page.goto('/friends/');
  await expect(page.getByTestId('friends-page')).toBeVisible();
  await expect(page.getByTestId('restricted-notice')).toHaveCount(0);
});
