// Starts the pre-QA bot (the test-play): a repository_dispatch to the GitHub Actions workflow
// pre-qa.yml with the build URL on the play origin. Used by submit-game, after a submission, and
// by pre-qa-dispatch (a moderator re-running it).
import { gamePlayUrl } from './gameOrigin.ts';

export async function dispatchPreQa(version: { id: string; storage_prefix: string; entry_file: string }): Promise<{ ok: boolean; error?: string }> {
  const playOrigin = (Deno.env.get('PLAY_ORIGIN') ?? '').replace(/\/+$/, '');
  const repo = Deno.env.get('GITHUB_REPO');
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  if (!playOrigin || !repo || !token) return { ok: false, error: 'pre-QA is not configured' };
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
      // The bot loads the build from the game's own origin, exactly as players will.
      client_payload: {
        url: gamePlayUrl(`${version.storage_prefix}/${version.entry_file}`, (Deno.env.get('GAME_ORIGIN_PATTERN') ?? '').trim(), playOrigin),
        version_id: version.id,
      },
    }),
  });
  return res.ok ? { ok: true } : { ok: false, error: `dispatch failed (${res.status})` };
}
