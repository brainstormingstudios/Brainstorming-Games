// POST /functions/v1/deploy-hook (Database Webhook on `games`, or the daily job)
// Rebuilds the static site after the public catalogue changed, at most once every 30 minutes
// (Cloudflare Pages Free allows 500 builds a month). A trigger on `games` records
// site_config.deploy.lastRequestedAt; this function compares it with lastTriggeredAt.
import { adminClient, json } from '../_shared/http.ts';

const DEBOUNCE_MS = 30 * 60 * 1000;

export async function maybeDeploy(): Promise<{ triggered: boolean; reason: string }> {
  const db = adminClient();
  const { data } = await db.from('site_config').select('value').eq('key', 'deploy').single();
  const state = (data?.value ?? {}) as { lastRequestedAt?: string | null; lastTriggeredAt?: string | null };
  const requested = state.lastRequestedAt ? Date.parse(state.lastRequestedAt) : 0;
  const triggered = state.lastTriggeredAt ? Date.parse(state.lastTriggeredAt) : 0;
  if (!requested || requested <= triggered) return { triggered: false, reason: 'nothing changed' };
  if (Date.now() - triggered < DEBOUNCE_MS) return { triggered: false, reason: 'debounced' };
  const hook = Deno.env.get('PAGES_DEPLOY_HOOK_URL');
  const repo = Deno.env.get('GITHUB_REPO');
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  let ok = false;
  if (repo && token) {
    // The GitHub workflow builds with the catalogue snapshot and deploys with wrangler.
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'brainstorming-games-deploy' },
      body: JSON.stringify({ event_type: 'rebuild' }),
    });
    ok = res.ok;
  } else if (hook) {
    ok = (await fetch(hook, { method: 'POST' })).ok;
  }
  if (!ok) return { triggered: false, reason: 'no deploy target configured or it failed' };
  await db
    .from('site_config')
    .update({ value: { ...state, lastTriggeredAt: new Date().toISOString() }, updated_at: new Date().toISOString() })
    .eq('key', 'deploy');
  return { triggered: true, reason: 'ok' };
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    const secret = Deno.env.get('CRON_SECRET');
    const webhookSecret = Deno.env.get('DEPLOY_WEBHOOK_SECRET');
    const provided = req.headers.get('x-cron-secret') ?? req.headers.get('x-webhook-secret');
    if (!provided || (provided !== secret && provided !== webhookSecret)) return json(req, 401, { error: 'unauthorised' });
    return json(req, 200, await maybeDeploy());
  });
}
