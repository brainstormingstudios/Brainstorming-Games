import { addGame, expect, resetSite, test } from './helpers';

/**
 * Clip & share: on a game that uses the SDK, the Clip button asks the game to record itself
 * (no browser prompt), then the site makes a vertical clip to share or save.
 */
test('clip & share records the game through the SDK and makes a vertical clip', async ({ page }) => {
  test.setTimeout(120_000);
  await resetSite(page);
  // Project Homecoming is served by the local services and loads the SDK from its own folder.
  await addGame(page, { slug: 'homecoming-clip', title: 'Homecoming Clip Test', storagePrefix: 'originals/project-homecoming', status: 'rise', usesSdk: true });
  await page.goto('/game/homecoming-clip/');
  await page.getByTestId('play-button').click();
  const clip = page.getByTestId('clip-button');
  await expect(clip).toBeVisible({ timeout: 30_000 });
  await clip.click();
  // 15 seconds of recording, then the vertical version is made from it.
  const dialog = page.getByTestId('clip-dialog');
  await expect(dialog).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('clip-preview')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('clip-download')).toHaveAttribute('download', /homecoming-clip-test\.(webm|mp4)$/);
});
