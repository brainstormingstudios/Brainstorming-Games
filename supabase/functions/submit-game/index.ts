// POST /functions/v1/submit-game  { gameId, declaration }
// Submits the developer's latest build for review (the database enforces what a submission must
// include and that the caller owns the game), then runs the auto-review with the service role and
// stores it on the version, where only the moderators' view reads it. A clear copy (copied build,
// cover, art or text, a protected name) is rejected at once, with the reason; otherwise the
// test-play starts here, on the server, and its report goes to the moderators (migration 0026).
import { adminClient, json, preflight, requireUser, userClient } from '../_shared/http.ts';
import { dispatchPreQa } from '../_shared/preQa.ts';
import { autoRejectReason, runAutoReview, type AssetOverlap, type Declaration } from '../_shared/autoReview.ts';

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
  const { data: game } = await db
    .from('games')
    .select('id, title, short_description, description_md, how_to_play_md, controls, tags, studio_id, studios(created_at, verified)')
    .eq('id', body.gameId)
    .single();
  const { data: version } = await db.from('game_versions').select('id, storage_prefix, entry_file, build_fingerprint, pre_qa_report').eq('id', versionId).single();
  const { data: media } = await db.from('game_media').select('game_id, phash, is_active').not('phash', 'is', null);
  const { data: released } = await db
    .from('games')
    .select('id, title, studio_id, short_description, description_md, game_versions!game_versions_game_id_fkey(build_fingerprint)')
    .not('released_at', 'is', null)
    .neq('id', body.gameId);
  const { data: assets } = await db.rpc('asset_overlaps', { p_version: versionId });
  const { count: rejections } = await db
    .from('qa_reviews')
    .select('id, games!inner(studio_id)', { count: 'exact', head: true })
    .eq('action', 'reject')
    .eq('games.studio_id', game.studio_id);
  const studio = (game.studios ?? {}) as { created_at?: string; verified?: boolean };

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
      description: `${o.short_description ?? ''}\n${o.description_md ?? ''}`,
    })),
    assetCount: Number((assets as { count?: number } | null)?.count ?? 0),
    assetOverlaps: ((assets as { overlaps?: AssetOverlap[] } | null)?.overlaps ?? []).map((o) => ({ ...o, shared: Number(o.shared) })),
    page: {
      shortDescription: game.short_description ?? '',
      descriptionMd: game.description_md ?? '',
      howToPlayMd: game.how_to_play_md ?? '',
      controls: Array.isArray(game.controls) ? game.controls.length : 0,
      tags: (game.tags ?? []).length,
    },
    studio: { createdAt: studio.created_at ?? new Date().toISOString(), rejections: rejections ?? 0, verified: Boolean(studio.verified) },
  });
  const reason = autoRejectReason(report);
  const { data: outcome } = await db.rpc('apply_auto_review', { p_version: versionId, p_report: report, p_reject_reason: reason });
  // Not a clear copy: test-play it now (harmful code found there is rejected when the report lands).
  if (outcome !== 'rejected' && version && !version.pre_qa_report) await dispatchPreQa(version);
  return json(req, 200, { ok: true, autoReview: report.status, rejected: outcome === 'rejected', reason: outcome === 'rejected' ? reason : null });
});
