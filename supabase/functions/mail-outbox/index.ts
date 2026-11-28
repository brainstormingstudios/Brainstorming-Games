// POST /functions/v1/mail-outbox  (called by a database webhook on every insert into email_outbox,
// and by the daily job as a safety net). Sends queued e-mails from the official Gmail address
// through a Google Apps Script web app (free; see scripts/mail/AppsScript.gs and docs/EMAIL.md).
// Auth: the MAIL_OUTBOX_SECRET header, set on the database webhook.
import { adminClient, sameSecret } from '../_shared/http.ts';
import { renderMail, type MailTemplate } from '../_shared/mailTemplates.ts';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const db = adminClient();
  // Either the database's own timer (a token kept inside the database, migration 0034) or the
  // older database webhook with MAIL_OUTBOX_SECRET.
  const cron = req.headers.get('x-outbox-cron');
  const viaTimer = cron ? (await db.rpc('check_internal_token', { p_name: 'mail_cron', p_token: cron })).data === true : false;
  if (!viaTimer && !sameSecret(req.headers.get('x-outbox-secret'), env('MAIL_OUTBOX_SECRET'))) return new Response('forbidden', { status: 403 });
  // Not connected to the Gmail sender yet: leave everything queued, untouched (docs/EMAIL.md).
  if (!env('MAIL_WEBHOOK_URL')) return new Response(JSON.stringify({ sent: 0, error: 'MAIL_WEBHOOK_URL is not set' }), { status: 503, headers: { 'content-type': 'application/json' } });
  const { data: queued } = await db.from('email_outbox').select('*').eq('status', 'queued').lt('attempts', 5).order('created_at').limit(40);
  const ctx = {
    siteUrl: env('SITE_URL'),
    developersUrl: env('DEVELOPERS_URL') || env('SITE_URL'),
    contactEmail: env('CONTACT_EMAIL') || 'brainstormingstudios26@gmail.com',
  };
  let sent = 0;
  for (const row of queued ?? []) {
    try {
      const mail = renderMail(row.template as MailTemplate, row.data ?? {}, ctx);
      const res = await fetch(env('MAIL_WEBHOOK_URL'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: env('MAIL_WEBHOOK_SECRET'), to: row.to_email, subject: mail.subject, html: mail.html, text: mail.text, replyTo: ctx.contactEmail }),
        redirect: 'follow',
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error ?? `mail webhook ${res.status}`);
      await db.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), attempts: row.attempts + 1, error: null }).eq('id', row.id);
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      await db.from('email_outbox').update({ status: attempts >= 5 ? 'failed' : 'queued', attempts, error: String(err).slice(0, 300) }).eq('id', row.id);
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { 'content-type': 'application/json' } });
});
