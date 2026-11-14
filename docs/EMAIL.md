# Automated e-mails

Every e-mail comes from the official address, **brainstormingstudios26@gmail.com**, and costs
nothing to send. The templates are in `supabase/functions/_shared/mailTemplates.ts`.

| When | E-mail |
| --- | --- |
| A player finishes signing up | Welcome |
| A studio is created | Welcome to the developer portal |
| A game is submitted for review | "Thank you for submitting…", what happens next |
| Review decision | Approved and live / changes requested (with the notes) / not accepted |
| Basic Launch decided | Invited to Full Launch, or the results |
| Monthly statement published | Your statement is ready |
| Payout sent | Payout on its way |
| Premium bought or cancelled, guest pass used | Membership e-mails |
| Boost paid, videos posted | Boost confirmation, links to the Shorts and Reels |
| A minor names a parent | The approval request to the parent |

All of them are listed in the management portal under **E-mails**.

## On this computer

Add a Gmail **app password** for the official address to `.env.local` and restart `npm run dev`:

```
GMAIL_USER=brainstormingstudios26@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

To make one: sign in to the Google account, turn on 2-Step Verification, then Security > App
passwords. Without it nothing is sent; each e-mail is saved as an HTML file in `.local/mail`.
Addresses ending in `example.test` are never sent.

## On the live site

Sign-in links (magic links) are sent by Supabase itself. In Supabase > Authentication > SMTP
Settings, turn on custom SMTP: host `smtp.gmail.com`, port `465`, user
`brainstormingstudios26@gmail.com`, password the app password, sender name "Brainstorming Games".

Everything else goes through the outbox table and a small Google Apps Script that sends from the
Gmail account:

1. Signed in as the official account, open https://script.google.com, create a project and paste
   in `scripts/mail/AppsScript.gs`.
2. Project Settings > Script Properties: add `SECRET` with a long random value.
3. Deploy > New deployment > Web app, execute as Me, access Anyone. Copy the URL.
4. Supabase secrets: `MAIL_WEBHOOK_URL` (that URL), `MAIL_WEBHOOK_SECRET` (the same SECRET),
   `MAIL_OUTBOX_SECRET` (another random value), `CONTACT_EMAIL`, `SITE_URL`, `DEVELOPERS_URL`.
5. Deploy the function: `npx supabase functions deploy mail-outbox --no-verify-jwt`.
6. Supabase > Database > Webhooks: on INSERT into `email_outbox`, call the `mail-outbox` Edge
   Function with the header `x-outbox-secret: <MAIL_OUTBOX_SECRET>`.

A personal Gmail account sends about 100 e-mails a day this way. If the site outgrows that, a
Google Workspace account on your own domain raises it to 1,500 with no code change.
