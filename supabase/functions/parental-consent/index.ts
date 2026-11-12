// POST /functions/v1/parental-consent { parentEmail }
// For a signed-in minor: creates a one-time approval token (only its hash is stored, and only a
// hash of the parent's e-mail) and e-mails the approval link to the parent through Resend.
import { adminClient, json, preflight, randomToken, requireUser, sha256Hex, userClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const user = await requireUser(req);
  if (!user) return json(req, 401, { error: 'login_required' });
  const { parentEmail } = (await req.json().catch(() => ({}))) as { parentEmail?: string };
  const email = String(parentEmail ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === user.email) return json(req, 400, { error: 'invalid' });

  const { data: profile } = await userClient(req).from('profiles').select('username, is_minor').eq('id', user.id).single();
  if (!profile?.is_minor) return json(req, 400, { error: 'invalid' });
  // Rate limit: three requests an hour per account (token bucket in Postgres).
  const { data: allowed } = await adminClient().rpc('take_token_public', {
    p_key: `consent-mail:${user.id}`,
    p_capacity: 3,
    p_window_seconds: 3600,
  });
  if (allowed === false) return json(req, 429, { error: 'rate_limited' });

  const token = randomToken(32);
  const { error } = await adminClient().rpc('parental_consent_create', {
    p_user: user.id,
    p_token_hash: await sha256Hex(token),
    p_parent_email_hash: await sha256Hex(email),
  });
  if (error) return json(req, 400, { error: error.message });

  const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  const link = `${site}/parents/consent/?token=${token}`;
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return json(req, 503, { error: 'e-mail is not configured' });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('MAIL_FROM') ?? 'Brainstorming Games <no-reply@example.com>',
      to: [email],
      subject: `Approve ${profile.username}'s Brainstorming Games account`,
      text: [
        'Hello,',
        '',
        `${profile.username} created an account on Brainstorming Games, a free website for browser games, and asked for your approval.`,
        'Until you approve, they can play games but cannot add friends, have a public profile, use party chat or appear by name on leaderboards.',
        'Chat only uses preset phrases, games are reviewed for ages 12+, and we never show personalised ads to minors.',
        '',
        `Approve or decline here (the link works for 14 days): ${link}`,
        '',
        'If you do not know this account, you can ignore this e-mail.',
      ].join('\n'),
    }),
  });
  if (!res.ok) return json(req, 502, { error: 'could not send the e-mail' });
  return json(req, 200, { sent: true });
});
