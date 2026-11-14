/**
 * The automated e-mails of Brainstorming Games. One file, used by the live mail sender
 * (supabase/functions/mail-outbox) and by the local services process, so a message looks the
 * same everywhere. Plain TypeScript with no imports (it runs in Deno, Node and the browser build).
 *
 * Every e-mail is short, says what happened, what happens next and where to look, and comes from
 * the official address. HTML for mail clients means tables and inline styles.
 */

export type MailTemplate =
  | 'sign_in_code'
  | 'welcome_player'
  | 'welcome_studio'
  | 'submission_received'
  | 'review_approved'
  | 'review_changes'
  | 'review_rejected'
  | 'rise_invite'
  | 'spark_ended'
  | 'statement_ready'
  | 'payout_sent'
  | 'premium_welcome'
  | 'premium_cancelled'
  | 'guest_pass_redeemed'
  | 'boost_received'
  | 'boost_posted'
  | 'parental_consent';

export interface MailContext {
  /** Public URL of the player site, no trailing slash. */
  siteUrl: string;
  /** Public URL of the developer portal. */
  developersUrl: string;
  /** The official address: sender and reply-to. */
  contactEmail: string;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface Body {
  subject: string;
  /** Short line shown in the inbox after the subject. */
  preview: string;
  heading: string;
  paragraphs: string[];
  /** Key facts, shown as a small table. */
  facts?: [string, string][];
  button?: { label: string; url: string };
  /** A quoted block, e.g. the reviewer's notes. */
  quote?: string;
}

function layout(b: Body, ctx: MailContext): RenderedMail {
  const p = b.paragraphs.map((x) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2a2c33">${esc(x)}</p>`).join('');
  const facts = b.facts?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 18px;border-collapse:collapse">${b.facts
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 0;border-top:1px solid #e6e6e1;font-size:13px;color:#6b6f78;width:42%">${esc(k)}</td><td style="padding:8px 0;border-top:1px solid #e6e6e1;font-size:14px;font-weight:700;color:#121316">${esc(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const quote = b.quote
    ? `<div style="margin:0 0 18px;padding:12px 14px;border-left:3px solid #00c0f0;background:#f5f5f2;font-size:14px;line-height:1.6;color:#2a2c33;white-space:pre-wrap">${esc(b.quote)}</div>`
    : '';
  const button = b.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 20px"><tr><td style="border-radius:10px;background:#00c0f0"><a href="${esc(b.button.url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#04131c;text-decoration:none">${esc(b.button.label)}</a></td></tr></table>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f2;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${esc(b.preview)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f2;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px;font-size:17px;font-weight:800;letter-spacing:-0.02em;color:#121316">Brainstorming <span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#00c0f0;color:#04131c;font-size:10px;letter-spacing:0.14em;vertical-align:middle">GAMES</span></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e6e6e1;border-radius:14px;padding:28px 26px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;letter-spacing:-0.02em;color:#121316">${esc(b.heading)}</h1>
${p}${facts}${quote}${button}
<p style="margin:8px 0 0;font-size:15px;line-height:1.6;color:#2a2c33">The Brainstorming Games team</p>
</td></tr>
<tr><td style="padding:16px 6px;font-size:12px;line-height:1.6;color:#6b6f78">
You are getting this because of your account on <a href="${esc(ctx.siteUrl)}" style="color:#0a5c9e">Brainstorming Games</a>. Questions? Reply to this e-mail or write to <a href="mailto:${esc(ctx.contactEmail)}" style="color:#0a5c9e">${esc(ctx.contactEmail)}</a>.<br>Brainstorming Studios, India.
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    b.heading,
    '',
    ...b.paragraphs,
    ...(b.facts ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(b.quote ? ['', b.quote] : []),
    ...(b.button ? ['', `${b.button.label}: ${b.button.url}`] : []),
    '',
    'The Brainstorming Games team',
    `Questions? Reply to this e-mail or write to ${ctx.contactEmail}.`,
  ].join('\n');
  return { subject: b.subject, html, text };
}

const s = (v: unknown) => String(v ?? '');

/** Builds one e-mail. `data` carries the names, titles, amounts and links each template uses. */
export function renderMail(template: MailTemplate, data: Record<string, unknown>, ctx: MailContext): RenderedMail {
  const name = s(data.name) || 'there';
  const game = s(data.game);
  const dev = (path: string) => `${ctx.developersUrl}${path}`;
  switch (template) {
    case 'sign_in_code':
      return layout(
        {
          subject: `${s(data.code)} is your Brainstorming Games code`,
          preview: 'Type this code to sign in. It works for 10 minutes.',
          heading: 'Your sign-in code',
          paragraphs: ['Type this code on Brainstorming Games to sign in. It works for 10 minutes and only once.'],
          facts: [['Code', s(data.code)]],
          quote: 'If you did not try to sign in, you can ignore this e-mail: nobody can sign in without the code.',
        },
        ctx,
      );
    case 'welcome_player':
      return layout(
        {
          subject: 'Welcome to Brainstorming Games',
          preview: 'Your account is ready. Your favourites, saves and Brain Points follow you everywhere.',
          heading: `Welcome, ${name}!`,
          paragraphs: [
            'Your account is ready. Your favourites, game saves, quests and Brain Points are now kept with your account, on every device you sign in on.',
            'Every game starts in your browser with one tap: no downloads, no installs.',
          ],
          button: { label: 'Find a game', url: ctx.siteUrl },
        },
        ctx,
      );
    case 'welcome_studio':
      return layout(
        {
          subject: `Your studio ${s(data.studio)} is ready`,
          preview: 'Upload your first build and our pre-QA bot checks it in minutes.',
          heading: `Welcome to the developer portal, ${s(data.studio)}`,
          paragraphs: [
            'Your studio is set up. Upload a zip of your HTML5 or WebGL build: our pre-QA bot tests it on a desktop browser and a phone and tells you what to fix before a person reviews it.',
            'Every new game starts with a Spark Launch: real players, ads off, and a clear report on how they responded.',
          ],
          button: { label: 'Add your first game', url: dev('/games/new/') },
        },
        ctx,
      );
    case 'submission_received':
      return layout(
        {
          subject: `We received ${game}`,
          preview: 'Thank you for submitting to Brainstorming Games. Here is what happens next.',
          heading: `Thank you for submitting ${game}`,
          paragraphs: [
            `Thank you for submitting ${game} to Brainstorming Games. Our team will now play it and look at the build, the art, the covers and the page you wrote.`,
            'Reviews usually take a few working days. We will e-mail you the moment there is a decision, and if anything needs changing we will tell you exactly what.',
          ],
          facts: [
            ['Game', game],
            ['Version', s(data.version) || '1'],
            ['Studio', s(data.studio)],
          ],
          button: { label: 'See your submission', url: dev(`/games/view/?id=${encodeURIComponent(s(data.gameId))}`) },
        },
        ctx,
      );
    case 'review_approved':
      return layout(
        {
          subject: `${game} is live`,
          preview: 'Approved: your Spark Launch has started.',
          heading: `${game} is approved and live`,
          paragraphs: [
            data.update
              ? 'Your new version passed review and is now the one players get.'
              : 'Your game passed review and its Spark Launch has started: real players, ads off, for 7 to 14 days. Then we decide together about Rise Launch, where ads and revenue start.',
          ],
          quote: s(data.notes) || undefined,
          button: { label: 'Watch your numbers', url: dev(`/games/kpi/?id=${encodeURIComponent(s(data.gameId))}`) },
        },
        ctx,
      );
    case 'review_changes':
      return layout(
        {
          subject: `Changes requested for ${game}`,
          preview: 'A few things to fix before it goes live.',
          heading: `${game}: a few things to change`,
          paragraphs: ['Thank you for your patience. Our reviewer played your game and found a few things to fix before it can go live. Their notes:'],
          quote: s(data.notes),
          button: { label: 'Upload a fixed build', url: dev(`/games/view/?id=${encodeURIComponent(s(data.gameId))}`) },
        },
        ctx,
      );
    case 'review_rejected':
      return layout(
        {
          subject: `About your submission ${game}`,
          preview: 'We could not accept this submission.',
          heading: `We could not accept ${game}`,
          paragraphs: ['Thank you for submitting your game. After playing it, we could not accept it this time. The reviewer explains why:'],
          quote: s(data.notes),
          button: { label: 'Open the developer portal', url: dev('/') },
        },
        ctx,
      );
    case 'rise_invite':
      return layout(
        {
          subject: `${game} is invited to Rise Launch`,
          preview: 'Ads and revenue start now.',
          heading: `${game} is moving up to Rise Launch`,
          paragraphs: ['Players responded well during the Spark Launch. Your game now moves to Rise Launch: ads are on, and you earn your share of the revenue from today.'],
          quote: s(data.reason) || undefined,
          button: { label: 'See the decision', url: dev(`/games/view/?id=${encodeURIComponent(s(data.gameId))}`) },
        },
        ctx,
      );
    case 'spark_ended':
      return layout(
        {
          subject: `Spark Launch results for ${game}`,
          preview: 'The test period has ended. Here is what we saw.',
          heading: `${game}: Spark Launch results`,
          paragraphs: ['The Spark Launch has ended and the game is not moving to Rise Launch this time. What we saw, and what would make the biggest difference:'],
          quote: s(data.reason),
          button: { label: 'Open the analysis', url: dev(`/games/kpi/?id=${encodeURIComponent(s(data.gameId))}`) },
        },
        ctx,
      );
    case 'statement_ready':
      return layout(
        {
          subject: `Your statement for ${s(data.month)}`,
          preview: `You earned ${s(data.earned)} in ${s(data.month)}.`,
          heading: `Your ${s(data.month)} statement is ready`,
          paragraphs: ['Your monthly statement has been published. You can download it as a PDF from the payouts page.'],
          facts: [
            ['Earned', s(data.earned)],
            ['Payout due', s(data.due)],
          ],
          button: { label: 'Open payouts', url: dev('/payouts/') },
        },
        ctx,
      );
    case 'payout_sent':
      return layout(
        {
          subject: `Payout sent: ${s(data.amount)}`,
          preview: 'Your earnings are on their way.',
          heading: 'Your payout is on its way',
          paragraphs: ['We have sent your earnings. Depending on the method, it can take a few working days to reach your account.'],
          facts: [
            ['Amount', s(data.amount)],
            ['Reference', s(data.reference)],
          ],
          button: { label: 'Open payouts', url: dev('/payouts/') },
        },
        ctx,
      );
    case 'premium_welcome':
      return layout(
        {
          subject: `Welcome to Brainstorming ${s(data.plan)}`,
          preview: 'Your membership is active.',
          heading: `You are now a ${s(data.plan)} member`,
          paragraphs: [
            s(data.plan) === 'Max'
              ? 'No ads anywhere, rewards without watching a video, double Brain Points from quests, the member wallpapers and two guest passes a month for friends.'
              : 'Far fewer ads, a short ad break at most every 10 minutes in games, and the member wallpapers.',
          ],
          facts: [
            ['Plan', s(data.plan)],
            ['Price', s(data.price)],
            ['Renews', s(data.until)],
          ],
          button: { label: 'Open your membership', url: `${ctx.siteUrl}/premium/` },
        },
        ctx,
      );
    case 'premium_cancelled':
      return layout(
        {
          subject: 'Your membership will not renew',
          preview: `It stays active until ${s(data.until)}.`,
          heading: 'Renewal cancelled',
          paragraphs: [`Your ${s(data.plan)} membership will not renew. Everything stays on until ${s(data.until)}. You can start it again at any time.`],
          button: { label: 'Manage membership', url: `${ctx.siteUrl}/premium/` },
        },
        ctx,
      );
    case 'guest_pass_redeemed':
      return layout(
        {
          subject: 'Your guest pass is active',
          preview: '7 days of Brainstorming Plus, on a friend.',
          heading: 'Enjoy 7 days of Plus',
          paragraphs: [`A friend shared their membership with you: Brainstorming Plus until ${s(data.until)}. Far fewer ads, and the member wallpapers.`],
          button: { label: 'Play now', url: ctx.siteUrl },
        },
        ctx,
      );
    case 'boost_received':
      return layout(
        {
          subject: `Boost confirmed for ${game}`,
          preview: 'Payment received. Here is the plan.',
          heading: `${game} is boosted`,
          paragraphs: [
            'Thank you: your payment went through. Our team will make the short videos from your game and post them on the official Brainstorming Games YouTube and Instagram channels, and your game gets sponsored placement on the site.',
          ],
          facts: [
            ['Package', s(data.package)],
            ['Amount', s(data.amount)],
            ['YouTube Shorts', s(data.shorts)],
            ['Instagram Reels', s(data.reels)],
            ['Sponsored placement', s(data.window)],
          ],
          button: { label: 'Follow your Boost', url: dev('/boost/') },
        },
        ctx,
      );
    case 'boost_posted':
      return layout(
        {
          subject: `Your videos for ${game} are live`,
          preview: 'The Shorts and Reels are up.',
          heading: `${game} is on YouTube and Instagram`,
          paragraphs: ['The videos for your Boost are posted. Share them: every view helps.'],
          quote: s(data.links),
          button: { label: 'See your Boost', url: dev('/boost/') },
        },
        ctx,
      );
    case 'parental_consent':
      return layout(
        {
          subject: `${s(data.username)} would like to use Brainstorming Games`,
          preview: 'A parent or guardian needs to approve this account.',
          heading: 'A request for your approval',
          paragraphs: [
            `Someone who gave their birth year as under 18 created the account "${s(data.username)}" on Brainstorming Games and gave your e-mail address as their parent or guardian.`,
            'Until you approve, the account can play every game but cannot add friends, join parties or appear on public leaderboards. We only store the player name, birth year and game progress.',
            'If you do not know who this is, you can simply ignore this e-mail.',
          ],
          button: { label: 'Review and decide', url: s(data.link) },
        },
        ctx,
      );
  }
}
