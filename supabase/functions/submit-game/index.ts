// POST /functions/v1/submit-game  { gameId, declaration }
// Submits the developer's latest build for review (the database enforces what a submission must
// include and that the caller owns the game), then runs the auto-review with the service role and
// stores it on the version, where only the moderators' view reads it.
import { adminClient, json, preflight, requireUser, userClient } from '../_shared/http.ts';
import { runAutoReview, type Declaration } from '../_shared/autoReview.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const user = await requireUser(req);
  if (!user) return json(req, 401, { error: 'login_required' });
  const body = (await req.json().catch(() => ({}))) as { gameId?: string; declaration?: Declaration };
  const declaration: Declaration = {
    ownsRights: body.declaration?.ownsRights === true,
    noCopies: body.declaration?.noCopies === true,
    credits: String(body.declaration?.credits ?? '').slice(0, 2000),
  };
  const { data: versionId, error } = await userClient(req).rpc('submit_for_review', { p_game_id: body.gameId, p_declaration: declaration });
  if (error) return json(req, 400, { error: 'invalid', message: error.message });

  const db = adminClient();
  const { data: game } = await db.from('games').select('id, title, short_description, description_md, tags, studio_id').eq('id', body.gameId).single();
  const { data: version } = await db.from('game_versions').select('build_fingerprint, pre_qa_report').eq('id', versionId).single();
  const { data: media } = await db.from('game_media').select('game_id, phash, is_active').not('phash', 'is', null);
  const { data: released } = await db.from('games').select('id, title, studio_id, game_versions(build_fingerprint)').not('released_at', 'is', null).neq('id', body.gameId);
  const report = runAutoReview({
    title: game.title,
    description: `${game.short_description}\n${game.description_md}`,
    tags: game.tags ?? [],
    studioId: game.studio_id,
    declaration,
    buildFingerprint: version?.build_fingerprint ?? null,
    coverHashes: (media ?? []).filter((m) => m.game_id === game.id && m.is_active).map((m) => m.phash),
    preQaProblems: ((version?.pre_qa_report?.checks ?? []) as { id: string; status: string }[])
      .filter((c) => c.status === 'warn' || c.status === 'fail')
      .map((c) => ({ id: c.id, status: c.status as 'warn' | 'fail' })),
    others: (released ?? []).map((o) => ({
      title: o.title,
      studioId: o.studio_id,
      buildFingerprints: ((o.game_versions ?? []) as { build_fingerprint: string | null }[]).map((v) => v.build_fingerprint).filter(Boolean) as string[],
      coverHashes: (media ?? []).filter((m) => m.game_id === o.id).map((m) => m.phash),
    })),
  });
  await db.from('game_versions').update({ auto_review: report }).eq('id', versionId);
  return json(req, 200, { ok: true, autoReview: report.status });
});
