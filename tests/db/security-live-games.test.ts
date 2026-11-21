import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, createUser } from './harness';

/** 0021: a released game's text, media and build only change through review. */
let db: PGlite;
let dev: string;
let other: string;
let admin: string;
let liveId: string;
let draftId: string;
const HOST = 'https://proj.supabase.co';
const fileId = '11111111-2222-4333-8444-555555555555';

beforeAll(async () => {
  db = await createDb();
  dev = await createUser(db, 'live_dev');
  other = await createUser(db, 'other_dev');
  admin = await createUser(db, 'live_admin');
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  const studio = (await db.query<{ id: string }>(
    `insert into public.studios (owner_id, name, slug, country, contact_email) values ($1, 'Live Studio', 'live-studio', 'IN', 'l@example.test') returning id`,
    [dev],
  )).rows[0]!.id;
  await db.query(
    `insert into public.studios (owner_id, name, slug, country, contact_email) values ($1, 'Other Studio', 'other-studio', 'IN', 'o@example.test')`,
    [other],
  );
  liveId = (await db.query<{ id: string }>(
    `insert into public.games (studio_id, slug, title, short_description, description_md, tags, controls, status, released_at)
     values ($1, 'live-game', 'Live Game', 'Reviewed text', 'About', '{a,b,c}', '[]', 'rise', now()) returning id`,
    [studio],
  )).rows[0]!.id;
  draftId = (await db.query<{ id: string }>(
    `insert into public.games (studio_id, slug, title, status) values ($1, 'draft-game', 'Draft Game', 'draft') returning id`,
    [studio],
  )).rows[0]!.id;
  await db.query(
    `insert into public.game_media (game_id, kind, url) values ($1, 'cover_landscape', $2)`,
    [liveId, `${HOST}/storage/v1/object/public/media/${liveId}/${fileId}-1280.webp`],
  );
  await db.query(`insert into public.site_config (key, value) values ('media_host', $1)`, [JSON.stringify({ url: HOST })]);
});

const game = async (id: string) => (await db.query<{ title: string; short_description: string; tags: string[] }>(`select * from public.games where id = $1`, [id])).rows[0]!;
const mediaUrl = (gameId: string, name = `${fileId}-640.webp`) => `${HOST}/storage/v1/object/public/media/${gameId}/${name}`;

describe('live game text', () => {
  it('holds edits to a released game for review', async () => {
    await as(db, 'authenticated', dev, (q) => q(`update public.games set title = 'Free Robux Here', tags = '{x,y,z}' where id = $1`, [liveId]));
    expect((await game(liveId)).title).toBe('Live Game');
    const [held] = await as(db, 'authenticated', dev, (q) => q<{ changes: Record<string, unknown> }>(`select changes from public.game_pending_edits where game_id = $1`, [liveId]));
    expect(held!.changes).toEqual({ title: 'Free Robux Here', tags: ['x', 'y', 'z'] });
    // A later edit adds to the held one.
    await as(db, 'authenticated', dev, (q) => q(`update public.games set short_description = 'New line' where id = $1`, [liveId]));
    const [both] = (await db.query<{ changes: Record<string, unknown> }>(`select changes from public.game_pending_edits where game_id = $1`, [liveId])).rows;
    expect(Object.keys(both!.changes).sort()).toEqual(['short_description', 'tags', 'title']);
  });

  it('lets drafts change straight away and never lets a released address change', async () => {
    await as(db, 'authenticated', dev, (q) => q(`update public.games set title = 'Draft Two' where id = $1`, [draftId]));
    expect((await game(draftId)).title).toBe('Draft Two');
    await expect(as(db, 'authenticated', dev, (q) => q(`update public.games set slug = 'stolen-slug' where id = $1`, [liveId]))).rejects.toThrow(/invalid/);
  });

  it('applies held edits only when staff approve', async () => {
    await expect(as(db, 'authenticated', dev, (q) => q(`select public.admin_decide_change($1, true, '')`, [liveId]))).rejects.toThrow(/not_allowed/);
    const [list] = await as(db, 'authenticated', admin, (q) => q<{ p: { game_id: string; live: Record<string, unknown> }[] }>(`select public.admin_pending_changes() as p`));
    expect(list!.p[0]!.game_id).toBe(liveId);
    expect(list!.p[0]!.live.title).toBe('Live Game');
    await as(db, 'authenticated', admin, (q) => q(`select public.admin_decide_change($1, true, '')`, [liveId]));
    const g = await game(liveId);
    expect(g.title).toBe('Free Robux Here');
    expect(g.short_description).toBe('New line');
    expect((await db.query(`select 1 from public.game_pending_edits where game_id = $1`, [liveId])).rows).toHaveLength(0);
  });
});

describe('live game media', () => {
  it('only accepts files from the game’s own storage folder', async () => {
    const insert = (gameId: string, url: string) =>
      as(db, 'authenticated', dev, (q) => q(`insert into public.game_media (game_id, kind, url) values ($1, 'cover_square', $2)`, [gameId, url]));
    await expect(insert(draftId, 'https://evil.example/cover.webp')).rejects.toThrow(/invalid/);
    await expect(insert(draftId, mediaUrl(liveId))).rejects.toThrow(/invalid/);
    await expect(insert(draftId, `${mediaUrl(draftId)}?x=1`)).rejects.toThrow(/invalid/);
    await expect(insert(draftId, mediaUrl(draftId, `../${liveId}/${fileId}-640.webp`))).rejects.toThrow(/invalid/);
    await insert(draftId, mediaUrl(draftId));
    const [m] = (await db.query<{ pending: boolean; is_active: boolean }>(`select pending, is_active from public.game_media where game_id = $1`, [draftId])).rows;
    expect(m).toEqual({ pending: false, is_active: true });
  });

  it('holds a new cover for a released game and keeps the live one until approval', async () => {
    const newUrl = mediaUrl(liveId, '99999999-2222-4333-8444-555555555555-1280.webp');
    await as(db, 'authenticated', dev, (q) => q(`insert into public.game_media (game_id, kind, url) values ($1, 'cover_landscape', $2)`, [liveId, newUrl]));
    const rows = (await db.query<{ url: string; pending: boolean; is_active: boolean }>(`select url, pending, is_active from public.game_media where game_id = $1 and kind = 'cover_landscape' order by created_at`, [liveId])).rows;
    expect(rows.map((r) => [r.pending, r.is_active])).toEqual([[false, true], [true, false]]);
    // The developer cannot switch it on, swap its URL, or delete the live cover.
    await expect(as(db, 'authenticated', dev, (q) => q(`update public.game_media set url = $2 where game_id = $1 and pending`, [liveId, mediaUrl(liveId)]))).rejects.toThrow(/invalid/);
    await as(db, 'authenticated', dev, (q) => q(`update public.game_media set is_active = true where game_id = $1 and pending`, [liveId]));
    expect((await db.query<{ is_active: boolean }>(`select is_active from public.game_media where game_id = $1 and pending`, [liveId])).rows[0]!.is_active).toBe(false);
    await expect(as(db, 'authenticated', dev, (q) => q(`delete from public.game_media where game_id = $1 and not pending`, [liveId]))).rejects.toThrow(/invalid/);
    await as(db, 'authenticated', admin, (q) => q(`select public.admin_decide_change($1, true, '')`, [liveId]));
    const after = (await db.query<{ url: string; is_active: boolean }>(`select url, is_active from public.game_media where game_id = $1 and kind = 'cover_landscape'`, [liveId])).rows;
    expect(after).toEqual([{ url: newUrl, is_active: true }]);
  });

  it('drops held media when staff decline', async () => {
    await as(db, 'authenticated', dev, (q) => q(`insert into public.game_media (game_id, kind, url) values ($1, 'cover_square', $2)`, [liveId, mediaUrl(liveId)]));
    await expect(as(db, 'authenticated', admin, (q) => q(`select public.admin_decide_change($1, false, 'no')`, [liveId]))).rejects.toThrow(/invalid/);
    await as(db, 'authenticated', admin, (q) => q(`select public.admin_decide_change($1, false, 'Misleading cover art')`, [liveId]));
    expect((await db.query(`select 1 from public.game_media where game_id = $1 and pending`, [liveId])).rows).toHaveLength(0);
  });
});

describe('build uploads', () => {
  const addVersion = (gameId: string, version: string, files = 3, bytes = 3000, minor = false) =>
    as(db, 'authenticated', dev, async (q) => {
      const [r] = await q<{ v: { version_id: string } }>(`select public.add_game_version($1, $2, $3, $4, 'index.html', true, $5) as v`, [gameId, version, files, bytes, minor]);
      return r!.v.version_id;
    });
  const register = (user: string, version: string, files: unknown[]) =>
    as(db, 'authenticated', user, (q) => q(`select public.register_upload($1, $2::jsonb)`, [version, JSON.stringify(files)]));

  it('records each file before it can be uploaded, within the declared size', async () => {
    const v = await addVersion(draftId, '1.0');
    await expect(register(other, v, [{ path: 'index.html', size: 10 }])).rejects.toThrow(/not_allowed/);
    for (const bad of ['../x.js', '/abs.js', 'a//b.js', 'a\\b.js', './a.js']) {
      await expect(register(dev, v, [{ path: bad, size: 10 }])).rejects.toThrow(/invalid/);
    }
    await expect(register(dev, v, [{ path: 'big.bin', size: 4000 }])).rejects.toThrow(/invalid/);
    await register(dev, v, [{ path: 'index.html', size: 1000 }, { path: 'game.js', size: 1000 }]);
    // Same path, same size is a retry; a different size is refused.
    await register(dev, v, [{ path: 'game.js', size: 1000 }]);
    await expect(register(dev, v, [{ path: 'game.js', size: 999 }])).rejects.toThrow(/invalid/);
    await expect(register(dev, v, [{ path: 'a.js', size: 10 }, { path: 'b.js', size: 10 }])).rejects.toThrow(/invalid/);
    const [row] = (await db.query<{ upload_manifest: Record<string, number> }>(`select upload_manifest from public.game_versions where id = $1`, [v])).rows;
    expect(row!.upload_manifest).toEqual({ 'index.html': 1000, 'game.js': 1000 });
  });

  it('approves nothing while upload links may still be open', async () => {
    const v = await addVersion(draftId, '1.1');
    await register(dev, v, [{ path: 'index.html', size: 1000 }]);
    await db.query(`update public.game_versions set qa_status = 'in_review' where id = $1`, [v]);
    await expect(as(db, 'authenticated', admin, (q) => q(`select public.qa_decide($1, 'approve', '')`, [v]))).rejects.toThrow(/uploads_open/);
    await db.query(`update public.game_versions set last_presign_at = now() - interval '7 minutes' where id = $1`, [v]);
    await as(db, 'authenticated', admin, (q) => q(`select public.qa_decide($1, 'approve', '')`, [v]));
    expect((await db.query<{ qa_status: string }>(`select qa_status from public.game_versions where id = $1`, [v])).rows[0]!.qa_status).toBe('approved');
  });

  it('publishes a minor update by itself only when it is close to the reviewed build', async () => {
    const base = await addVersion(liveId, '2.0', 10, 100000);
    await db.query(`update public.game_versions set qa_status = 'approved' where id = $1`, [base]);
    await db.query(`update public.games set current_version_id = $2 where id = $1`, [liveId, base]);
    const report = (v: string) => as(db, 'service_role', null, async (q) => (await q<{ r: string }>(`select public.set_pre_qa_report($1, '{"status":"pass"}') as r`, [v]))[0]!.r);

    const close = await addVersion(liveId, '2.0.1', 10, 110000, true);
    expect(await report(close)).toBe('approved');

    // Twice the size: a different game wearing the old one's page. Human review.
    const swap = await addVersion(liveId, '2.0.2', 10, 400000, true);
    expect(await report(swap)).toBe('pre_qa_passed');
    await expect(as(db, 'authenticated', dev, (q) => q(`select public.publish_minor_update($1)`, [swap]))).rejects.toThrow(/invalid/);

    // Close in size but its upload links are still open: the developer publishes a little later.
    const late = await addVersion(liveId, '2.0.3', 10, 105000, true);
    await register(dev, late, [{ path: 'index.html', size: 1000 }]);
    expect(await report(late)).toBe('pre_qa_passed');
    await expect(as(db, 'authenticated', dev, (q) => q(`select public.publish_minor_update($1)`, [late]))).rejects.toThrow(/uploads_open/);
    await db.query(`update public.game_versions set last_presign_at = now() - interval '7 minutes' where id = $1`, [late]);
    await as(db, 'authenticated', dev, (q) => q(`select public.publish_minor_update($1)`, [late]));
    expect((await db.query<{ current_version_id: string }>(`select current_version_id from public.games where id = $1`, [liveId])).rows[0]!.current_version_id).toBe(late);
  });
});
