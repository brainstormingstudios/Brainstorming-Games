// GET /functions/v1/health — keeps the free project awake (GitHub Actions cron, daily).
// With ?jobs=daily and the cron secret it also runs the daily jobs (KPI roll-up, A/B winners,
// cleanup) and the debounced site rebuild.
import { adminClient, json, sameSecret } from '../_shared/http.ts';
import { maybeDeploy } from '../deploy-hook/index.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const db = adminClient();
  const { error } = await db.from('site_config').select('key').limit(1);
  if (error) return json(req, 500, { ok: false });
  if (url.searchParams.get('jobs') !== 'daily') return json(req, 200, { ok: true });
  const secret = Deno.env.get('CRON_SECRET');
  if (!sameSecret(req.headers.get('x-cron-secret'), secret)) return json(req, 401, { error: 'unauthorised' });
  const { data: jobs, error: jobError } = await db.rpc('run_daily_jobs');
  const deploy = await maybeDeploy().catch((e) => ({ triggered: false, reason: String(e) }));
  return json(req, jobError ? 500 : 200, { ok: !jobError, jobs, deploy, error: jobError?.message });
});
