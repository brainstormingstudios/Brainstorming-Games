// POST /functions/v1/events: batched gameplay events from the site.
// Validation, rate limiting (per anonymous id and per IP) and the insert all happen in the
// ingest_events() Postgres function; this wrapper adds the country from the edge and keeps the
// caller's identity so signed-in players get streaks and quest progress.
import { json, preflight, userClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });
  let body: { anon_id?: string; device?: string; ref_studio?: string | null; ref_creator?: string | null; events?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: 'invalid json' });
  }
  if (!body.anon_id || !Array.isArray(body.events) || body.events.length > 50) return json(req, 400, { error: 'invalid' });
  const country = req.headers.get('cf-ipcountry') ?? req.headers.get('x-country') ?? null;
  const { data, error } = await userClient(req).rpc('ingest_events', {
    p_anon_id: body.anon_id,
    p_device: body.device ?? null,
    p_ref_studio: body.ref_studio ?? null,
    p_ref_creator: body.ref_creator ?? null,
    p_events: body.events,
    p_country: country,
  });
  if (error) {
    const limited = error.message.includes('rate_limited');
    return json(req, limited ? 429 : 400, { error: limited ? 'rate_limited' : 'invalid' });
  }
  return json(req, 200, { accepted: data });
});
