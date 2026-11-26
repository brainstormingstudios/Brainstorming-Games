import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/**
 * Migration 0026: developers submit without waiting for the test-play, clear copies are rejected
 * at once by submit-game (apply_auto_review), and harmful code found by the test-play rejects the
 * build at once, before or after submission.
 */
let db: PGlite;
let dev: string;
let studio: string;
let n = 0;
const declaration = JSON.stringify({ ownsRights: true, noCopies: true, credits: '' });
const harmful = JSON.stringify({
  status: 'fail',
  usesSdk: true,
  checks: [
    { id: 'loads', status: 'pass', label: 'The game loads', detail: 'Loaded.', fix: null },
    { id: 'no-credentials', status: 'fail', label: 'No password, card or code fields', detail: 'The game showed: password.', fix: null },
  ],
});
const slowButSafe = JSON.stringify({
  status: 'fail',
  usesSdk: true,
  checks: [{ id: 'time-to-gameplay', status: 'fail', label: 'Reaches gameplay within 20 s', detail: 'Slow.', fix: null }],
});

beforeAll(async () => {
  db = await createDb();
  dev = await createUser(db, 'auto_dev');
  studio = await as(db, 'authenticated', dev, async (q) => {
    const [row] = await q<{ id: string }>(`select public.create_studio('Auto Studio', 'auto-studio', 'IN', 'dev@example.test', 'v1', 'adult') as id`);
    return row!.id;
  });
});

/** A complete game with one uploaded build, ready to submit once its test-play has started. */
async function readyGame(): Promise<{ gameId: string; versionId: string }> {
  n += 1;
  return as(db, 'authenticated', dev, async (q) => {
    const [g] = await q<{ id: string }>(
      `insert into public.games (studio_id, slug, title, short_description, description_md, tags, controls)
       values ($1, $2, $3, 'A test', 'About', '{logic,fixture,puzzle}', '[{"action":"Move","keyboard":"Arrows","touch":"Swipe"}]') returning id`,
      [studio, `auto-game-${n}`, `Auto Game ${n}`],
    );
    const [v] = await q<{ v: { version_id: string } }>(`select public.add_game_version($1, '1', 3, 20000, 'index.html', true, false) as v`, [g!.id]);
    await q(
      `insert into public.game_media (game_id, kind, url, widths, width, height) values
         ($1, 'cover_landscape', 'https://example.test/c.webp', '{1920}', 1920, 1080),
         ($1, 'cover_portrait', 'https://example.test/p.webp', '{800}', 800, 1200),
         ($1, 'cover_square', 'https://example.test/s.webp', '{800}', 800, 800),
         ($1, 'preview_landscape', 'https://example.test/v.mp4', '{}', 1280, 720)`,
      [g!.id],
    );
    // The developer plays the build in the preview before submitting (migration 0031).
    await q(`select public.mark_version_previewed($1)`, [v!.v.version_id]);
    return { gameId: g!.id, versionId: v!.v.version_id };
  });
}
const submit = (gameId: string) => as(db, 'authenticated', dev, (q) => q(`select public.submit_for_review($1, $2)`, [gameId, declaration]));
const startTestPlay = (versionId: string) => as(db, 'authenticated', dev, (q) => q(`select public.mark_pre_qa_running($1)`, [versionId]));
const report = (versionId: string, r: string) =>
  as(db, 'service_role', null, async (q) => (await q<{ r: string }>(`select public.set_pre_qa_report($1, $2::jsonb) as r`, [versionId, r]))[0]!.r);
const state = async (versionId: string) =>
  (
    await db.query<{ qa_status: string; game_status: string; has_report: boolean }>(
      `select v.qa_status, g.status as game_status, v.pre_qa_report is not null as has_report
       from public.game_versions v join public.games g on g.id = v.game_id where v.id = $1`,
      [versionId],
    )
  ).rows[0]!;
const autoReviews = async (versionId: string) =>
  (await db.query<{ reviewer_id: string | null; checklist: { automatic?: boolean }; notes: string }>(`select reviewer_id, checklist, notes from public.qa_reviews where version_id = $1`, [versionId])).rows;

describe('the preview step', () => {
  it('refuses a submission whose build was never previewed, and only the owner can mark it', async () => {
    n += 1;
    const ids = await as(db, 'authenticated', dev, async (q) => {
      const [g] = await q<{ id: string }>(
        `insert into public.games (studio_id, slug, title, short_description, description_md, tags, controls)
         values ($1, $2, $2, 'A test', 'About', '{logic,fixture,puzzle}', '[{"action":"Move","keyboard":"Arrows","touch":"Swipe"}]') returning id`,
        [studio, `nopreview-${n}`],
      );
      const [v] = await q<{ v: { version_id: string } }>(`select public.add_game_version($1, '1', 3, 20000, 'index.html', true, false) as v`, [g!.id]);
      await q(
        `insert into public.game_media (game_id, kind, url, widths, width, height) values
           ($1, 'cover_landscape', 'https://example.test/c.webp', '{1920}', 1920, 1080), ($1, 'cover_portrait', 'https://example.test/p.webp', '{800}', 800, 1200),
           ($1, 'cover_square', 'https://example.test/s.webp', '{800}', 800, 800), ($1, 'preview_landscape', 'https://example.test/v.mp4', '{}', 1280, 720)`,
        [g!.id],
      );
      return { gameId: g!.id, versionId: v!.v.version_id };
    });
    await expect(submit(ids.gameId)).rejects.toThrow(/preview_required/);
    const stranger = await createUser(db, 'not_the_owner');
    await expect(as(db, 'authenticated', stranger, (q) => q(`select public.mark_version_previewed($1)`, [ids.versionId]))).rejects.toThrow(/not_allowed/);
    await as(db, 'authenticated', dev, (q) => q(`select public.mark_version_previewed($1)`, [ids.versionId]));
    await submit(ids.gameId);
  });
});

describe('submitting with no checks on the developer side', () => {
  it('accepts a build as soon as it is uploaded, and closes its uploads', async () => {
    const { gameId, versionId } = await readyGame();
    await as(db, 'authenticated', dev, (q) => q(`select public.register_upload($1, '[{"path":"index.html","size":100}]'::jsonb)`, [versionId]));
    expect((await db.query<{ open: boolean }>(`select app.uploads_open($1) as open`, [versionId])).rows[0]!.open).toBe(true);
    await submit(gameId);
    expect(await state(versionId)).toMatchObject({ qa_status: 'in_review', game_status: 'in_review' });
    // Nothing can be added once it is submitted.
    expect((await db.query<{ open: boolean }>(`select app.uploads_open($1) as open`, [versionId])).rows[0]!.open).toBe(false);
  });

  it('accepts a build whose test-play failed on something harmless', async () => {
    const { gameId, versionId } = await readyGame();
    await startTestPlay(versionId);
    expect(await report(versionId, slowButSafe)).toBe('pre_qa_failed');
    await submit(gameId);
    expect((await state(versionId)).qa_status).toBe('in_review');
  });

  it('keeps a submitted build in review when its report arrives later', async () => {
    const { gameId, versionId } = await readyGame();
    await startTestPlay(versionId);
    await submit(gameId);
    expect(await report(versionId, slowButSafe)).toBe('in_review');
    expect(await state(versionId)).toMatchObject({ qa_status: 'in_review', has_report: true });
  });
});

describe('harmful code', () => {
  it('rejects a submitted build at once, recorded as an automatic decision', async () => {
    const { gameId, versionId } = await readyGame();
    await startTestPlay(versionId);
    await submit(gameId);
    expect(await report(versionId, harmful)).toBe('rejected');
    expect(await state(versionId)).toMatchObject({ qa_status: 'rejected', game_status: 'draft' });
    const [review] = await autoReviews(versionId);
    expect(review).toMatchObject({ reviewer_id: null, checklist: { automatic: true } });
    expect(review!.notes).toMatch(/^Rejected automatically: the test-play found password, card or code fields/);
    const [note] = (await db.query<{ title: string }>(`select title from public.notifications where user_id = $1 order by created_at desc limit 1`, [dev])).rows;
    expect(note!.title).toBe('Submission rejected automatically');
  });

  it('rejects a build before submission too, so it cannot be submitted', async () => {
    const { gameId, versionId } = await readyGame();
    await startTestPlay(versionId);
    expect(await report(versionId, harmful)).toBe('rejected');
    await expect(submit(gameId)).rejects.toThrow(/invalid/);
  });
});

describe('clear copies (submit-game)', () => {
  const apply = (versionId: string, reason: string | null) =>
    as(db, 'service_role', null, async (q) => (await q<{ r: string }>(`select public.apply_auto_review($1, '{"status":"fail","checks":[]}'::jsonb, $2) as r`, [versionId, reason]))[0]!.r);

  it('rejects at once when submit-game gives a reason, and leaves the rest for a person', async () => {
    const copy = await readyGame();
    await startTestPlay(copy.versionId);
    await submit(copy.gameId);
    expect(await apply(copy.versionId, 'Rejected automatically: copied build.')).toBe('rejected');
    expect((await autoReviews(copy.versionId))[0]!.notes).toBe('Rejected automatically: copied build.');

    const fine = await readyGame();
    await startTestPlay(fine.versionId);
    await submit(fine.gameId);
    expect(await apply(fine.versionId, null)).toBe('in_review');
    expect(await autoReviews(fine.versionId)).toEqual([]);
  });

  it('is only for the server', async () => {
    const { versionId } = await readyGame();
    await expect(
      as(db, 'authenticated', dev, (q) => q(`select public.apply_auto_review($1, '{}'::jsonb, 'x')`, [versionId])),
    ).rejects.toThrow(/permission denied|not_allowed/);
  });
});
