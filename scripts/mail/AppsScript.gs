/**
 * Brainstorming Games: sends the automated e-mails from the official Gmail account, for free.
 *
 * Set-up (5 minutes, once), signed in as brainstormingstudios26@gmail.com:
 *   1. Go to https://script.google.com and create a new project. Paste this file in.
 *   2. Project Settings > Script Properties > add SECRET with a long random value. Put the same
 *      value in the Supabase secret MAIL_WEBHOOK_SECRET.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *      Copy the web app URL into the Supabase secret MAIL_WEBHOOK_URL.
 *   4. Approve the permission prompt (sending mail as you).
 *
 * Limits: a personal Gmail account can send about 100 e-mails a day this way. Moving to Google
 * Workspace raises that to 1,500 with no code change.
 */
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'bad_json' });
  }
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || body.secret !== secret) return reply({ ok: false, error: 'forbidden' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.to || ''))) return reply({ ok: false, error: 'bad_address' });
  if (MailApp.getRemainingDailyQuota() < 1) return reply({ ok: false, error: 'quota' });
  MailApp.sendEmail({
    to: body.to,
    subject: String(body.subject || '').slice(0, 250),
    htmlBody: String(body.html || ''),
    body: String(body.text || ''),
    name: 'Brainstorming Games',
    replyTo: body.replyTo || Session.getActiveUser().getEmail(),
  });
  return reply({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
