// GET /functions/v1/geo → { country: "IN" | null }
// The visitor's country as Cloudflare sees it, so the site can show paid features only where we
// sell them (India for now). Nothing is stored. The billing function checks the same header.
import { json, preflight } from '../_shared/http.ts';

Deno.serve((req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const country = (req.headers.get('cf-ipcountry') ?? '').toUpperCase();
  return json(req, 200, { country: /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'T1' ? country : null });
});
