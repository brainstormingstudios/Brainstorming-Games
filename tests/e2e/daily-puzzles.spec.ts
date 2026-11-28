import { expect, resetSite, test } from './helpers';

/** The Daily hub: four puzzle tiles; each opens its puzzle, and Back returns to the tiles. */
test('daily puzzles open from their tiles', async ({ page }) => {
  await resetSite(page);
  await page.goto('/daily/');
  for (const kind of ['word', 'crossword', 'sudoku', 'path']) await expect(page.getByTestId(`puzzle-${kind}`)).toBeVisible();

  await page.getByTestId('puzzle-word').click();
  await expect(page.getByTestId('word-game')).toBeVisible();
  // Made-up words are refused; real ones are marked.
  for (const k of 'qzxvb') await page.keyboard.press(k);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Not in the word list')).toBeVisible();
  await page.getByTestId('puzzles-back').click();

  await page.getByTestId('puzzle-sudoku').click();
  await expect(page.getByTestId('sudoku-game')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('puzzle-crossword')).toBeVisible();
  await page.getByTestId('puzzle-crossword').click();
  await expect(page.getByTestId('crossword-clue')).toContainText(/Across|Down/);
});
