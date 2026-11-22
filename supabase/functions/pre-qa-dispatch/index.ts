// POST /functions/v1/pre-qa-dispatch { versionId }
// Runs the test-play (pre-QA bot) again for a version. Staff only: developers never run checks;
// submit-game starts the test-play by itself after a submission (migration 0026).
import { dispatchPreQa } from '../_shared/preQa.ts';
import { adminClient, json, preflight, userClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const { versionId } = (await req.json().catch(() => ({}))) as { versionId?: string };
  if (!versionId) return json(req, 400, { error: 'invalid' });
  const { data: staff } = await userClient(req).rpc('is_staff_session');
  if (staff !== true) return json(req, 403, { error: 'not_allowed' });
  const { data: version } = await adminClient().from('game_versions').select('id, storage_prefix, entry_file').eq('id', versionId).maybeSingle();
  if (!version) return json(req, 404, { error: 'not_found' });
  const sent = await dispatchPreQa(version);
  return sent.ok ? json(req, 202, { queued: true }) : json(req, 502, { error: sent.error });
});
