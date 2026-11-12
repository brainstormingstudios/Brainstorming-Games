// POST /functions/v1/pre-qa-dispatch { versionId }
// Starts the pre-QA bot: a repository_dispatch to the GitHub Actions workflow pre-qa.yml with the
// build URL on the play origin. The caller must own the version.
import { json, preflight, userClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const { versionId } = (await req.json().catch(() => ({}))) as { versionId?: string };
  if (!versionId) return json(req, 400, { error: 'invalid' });
  const { data: version } = await userClient(req)
    .from('game_versions')
    .select('id, storage_prefix, entry_file')
    .eq('id', versionId)
    .maybeSingle();
  if (!version) return json(req, 403, { error: 'not_allowed' });
  const playOrigin = (Deno.env.get('PLAY_ORIGIN') ?? '').replace(/\/+$/, '');
  const repo = Deno.env.get('GITHUB_REPO');
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  if (!playOrigin || !repo || !token) return json(req, 503, { error: 'pre-QA is not configured' });
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'brainstorming-games-pre-qa',
    },
    body: JSON.stringify({
      event_type: 'pre-qa',
      client_payload: { url: `${playOrigin}/${version.storage_prefix}/${version.entry_file}`, version_id: version.id },
    }),
  });
  if (!res.ok) return json(req, 502, { error: `dispatch failed (${res.status})` });
  return json(req, 202, { queued: true });
});
