import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PLAY = 'http://localhost:4100';
/** The developer portal and the management portal are separate sites (and separate sign-ins). */
export const DEV = 'http://localhost:3001';
export const ADMIN = 'http://localhost:3002';
const PROBE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sdk-probe');

const TYPES: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
};

/** Uploads the sdk-probe fixture to the local play origin under `<prefix>/`. */
export async function uploadProbe(request: APIRequestContext, prefix: string): Promise<void> {
  for (const name of readdirSync(PROBE_DIR)) {
    const ext = name.split('.').pop() ?? '';
    const res = await request.put(`${PLAY}/__mock/upload/${prefix}/${name}`, {
      data: readFileSync(join(PROBE_DIR, name)),
      headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' },
    });
    expect(res.ok(), `upload ${name}`).toBeTruthy();
  }
}

/** Removes an uploaded build from the local play origin. */
export async function deleteUpload(request: APIRequestContext, prefix: string): Promise<void> {
  await request.delete(`${PLAY}/__mock/prefix/${prefix}`);
}

/** Waits until the mock data layer has loaded and exposed its test tools. */
export async function mockReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as MockWindow).__bgMock), null, {
    timeout: 15_000,
  });
}

export interface TestGame {
  slug: string;
  title: string;
  storagePrefix: string;
  category?: string;
  tags?: string[];
  status?: 'spark' | 'rise' | 'featured';
  usesSdk?: boolean;
  /** Covers and previews, e.g. two labelled landscape covers for a thumbnail test. */
  media?: Record<string, unknown>[];
}

/** A tiny solid-colour landscape cover as a data URL, labelled for a thumbnail A/B test. */
export function testCover(label: string | null, colour: string): Record<string, unknown> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${colour}"/></svg>`;
  return {
    kind: 'cover_landscape',
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    widths: [],
    width: 640,
    height: 360,
    placeholder: null,
    variantLabel: label,
  };
}

/** Adds a published game to the mock database of the page's browser context. */
export async function addGame(page: Page, game: TestGame): Promise<string> {
  await mockReady(page);
  return page.evaluate(
    (g) =>
      (window as unknown as MockWindow).__bgMock!.addGame({
        slug: g.slug,
        title: g.title,
        shortDescription: 'A bare page used by automated tests.',
        descriptionMd: 'This fixture checks that the platform can **load and frame** a build.',
        howToPlayMd: '1. Press Play.\n2. Watch the log.',
        controls: [{ action: 'Run a check', keyboard: 'Click a button', touch: 'Tap a button' }],
        faq: [{ q: 'Is this a game?', a: 'No. It is a test fixture.' }],
        category: g.category ?? 'puzzle',
        tags: g.tags ?? ['fixture'],
        status: g.status ?? 'spark',
        storagePrefix: g.storagePrefix,
        usesSdk: g.usesSdk ?? false,
        media: g.media,
        studio: { slug: 'probe-studio', name: 'Probe Studio', country: 'IN' },
      }),
    game,
  );
}

/** Clears the mock database and all guest data so each test starts from an empty site. */
export async function resetSite(page: Page): Promise<void> {
  // The three sites share one local database: empty it (no first-party games either).
  const reset = await page.request.post(`${PLAY}/__mock/db/reset?seed=0`);
  expect(reset.ok(), 'reset the local database').toBeTruthy();
  await page.goto('/offline/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // The greeting would cover the corner of small screens; mark it as already seen.
    window.localStorage.setItem('bg.prefs', JSON.stringify({ greeted: true }));
  });
}

/** Signs in through the login dialog (mock mode signs in straight away), finishing signup if asked. */
export async function signIn(page: Page, email: string, username: string, birthYear = '1990'): Promise<void> {
  const dialog = page.locator('dialog[open]');
  await dialog.getByTestId('login-email').fill(email);
  await dialog.getByTestId('login-submit').click();
  const profile = dialog.getByTestId('signup-username');
  const needsProfile = await profile
    .waitFor({ state: 'visible', timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (needsProfile) {
    await profile.fill(username);
    await dialog.getByTestId('signup-birth-year').fill(birthYear);
    await dialog.getByTestId('signup-submit').click();
  }
}

/** Shape of the mock tools the app exposes on `window` in mock mode. */
interface MockWindow {
  __bgMock?: {
    addGame(input: Record<string, unknown>): string;
    removeGame(id: string): void;
    reset(): void;
  };
}
