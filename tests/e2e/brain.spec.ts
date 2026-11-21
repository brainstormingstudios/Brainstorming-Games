import { addGame, deleteUpload, expect, resetSite, signIn, test, uploadProbe } from './helpers';

/**
 * Phase 2 (Brain Profile): playing a game tagged with skills fills the player's Brain Profile;
 * the game page shows what it trains; a public player can be compared with.
 */
test('brain profile grows from play and can be compared', async ({ page, request }) => {
  test.setTimeout(120_000);
  const prefix = 'e2e/brain-probe/1';
  await resetSite(page);
  await uploadProbe(request, prefix);
  await addGame(page, { slug: 'brain-probe', title: 'Brain Probe', storagePrefix: prefix, status: 'rise', usesSdk: true, skills: ['logic', 'speed'] });

  // Before any play: an empty profile with a way to start.
  await page.goto('/brain/');
  await expect(page.getByTestId('brain-page')).toBeVisible();
  await expect(page.getByText('Your Brain Profile starts with your first game')).toBeVisible();

  // Sign in, play for a few seconds, leave the game.
  await page.goto('/game/brain-probe/');
  await expect(page.getByTestId('game-skills')).toContainText('Logic');
  await expect(page.getByTestId('game-skills')).toContainText('Speed');
  await page.getByRole('button', { name: 'Log in' }).first().click();
  await signIn(page, 'brainy@example.test', 'brainy_one');
  await page.getByTestId('play-button').click();
  await expect(page.frameLocator('[data-testid="game-iframe"]').getByTestId('probe-env')).toHaveText('brainstorming', { timeout: 20_000 });
  await page.waitForTimeout(4000);

  // The profile now has a top skill, scores for every skill and the learning-time chart.
  await page.goto('/brain/');
  await expect(page.getByTestId('brain-type')).toHaveText(/Logician|Speedster/, { timeout: 15_000 });
  await expect(page.getByTestId('brain-skill')).toHaveCount(5);
  await expect(page.getByTestId('brain-learning-time')).toBeVisible();
  await expect(page.getByTestId('brain-challenge-link')).toContainText('/brain/compare/?u=brainy_one');
  await page.screenshot({ path: '.local/look/brain-page.png', fullPage: true });

  // Friends see the public profile through the challenge link; unknown players are not found.
  await page.goto('/brain/compare/?u=brainy_one');
  await expect(page.getByTestId('brain-compare')).toBeVisible();
  await page.goto('/brain/compare/?u=nobody_here');
  await expect(page.getByText('private or does not exist')).toBeVisible();
  await deleteUpload(request, prefix);
});
