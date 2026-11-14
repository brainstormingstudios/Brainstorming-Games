# Deploying Brainstorming Games

Everything here uses free tiers. Nothing needs a credit card. The site works with **no setup at
all** in mock mode (`npm run dev`); follow this guide when you want the real thing online.

You need accounts with **GitHub**, **Cloudflare** and **Supabase**. Later, optionally: Google
AdSense and Resend.

Every variable named below is described in [`.env.example`](../.env.example).

## 1. Put the code on GitHub

This machine has no Git, so commits were made with a small helper. Install Git, then:

```bash
git remote add origin https://github.com/<you>/brainstorming-games.git
```

```bash
git push -u origin main
```

## 2. Supabase (database, sign-in, functions)

1. Create a project at supabase.com (free plan). Pick the Mumbai region for Indian players.
2. Install the Supabase CLI and link the project:

   ```bash
   npx supabase link --project-ref <project-ref>
   ```

3. Apply the schema (migrations 0001 to 0010) and the starter quests and locker items:

   ```bash
   npx supabase db push
   ```

   ```bash
   npx supabase db execute --file supabase/seed.sql
   ```

4. Sign-in: in **Authentication > Providers** keep Email (magic link) on. Google and Discord are
   optional; add their client id and secret there. In **Authentication > URL configuration** set
   the Site URL to your domain and add `https://<your-domain>/login/` to the redirect list.
5. Make yourself an admin: sign up on the site once, then run in the SQL editor:

   ```sql
   update public.profiles set role = 'admin' where username = '<your username>';
   ```

6. Deploy the Edge Functions:

   ```bash
   npx supabase functions deploy
   ```

7. Set their secrets (`supabase secrets set NAME=value`). The list is in `.env.example` under
   "Edge Function secrets". The ones you need on day one:
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (step 3 below)
   - `GAME_JWT_PRIVATE_JWK`: run `node scripts/gen-game-jwk.mjs` and paste the private key
   - `PAYOUT_ENCRYPTION_KEY`: 32 random bytes, base64
   - `SITE_URL`, `PAGES_DEPLOY_HOOK_URL` (step 4 below)
   - `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, `PRE_QA_CALLBACK_SECRET` (the pre-QA bot)
   - `RESEND_API_KEY`, `MAIL_FROM` (parental-consent e-mails; without them minors cannot be approved)

## 3. Cloudflare R2 (game builds)

1. Create an R2 bucket, for example `bg-play`.
2. Give it a **custom domain** such as `play.<your-domain>`. Game builds must be served from a
   different origin than the site; that separation is what keeps a game from touching player
   accounts.
3. Add a CORS rule that allows `PUT` from your site's origin (developers upload straight from
   the browser with presigned URLs).
4. Create an R2 API token with read and write on that bucket and put its values in the
   Supabase secrets from step 2.

## 4. Cloudflare Pages (the site)

1. Create a Pages project named `brainstorming-games` (Direct Upload; GitHub Actions does the
   building).
2. In the GitHub repository, under Settings > Secrets and variables > Actions, add:
   - **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_SERVICE_ROLE_KEY`,
     `PRE_QA_CALLBACK_SECRET`, `SUPABASE_HEALTH_URL`.
   - **Variables:** `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_PLAY_ORIGIN`, `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_CONTACT_EMAIL`, and later the AdSense ones.
     `CF_PAGES_PROJECT` if your Pages project has another name.
3. Push to `main`. The `deploy` workflow builds the static site and uploads it. The build reads
   the live catalogue from Supabase, so every public game gets its own pre-rendered page.
4. Rebuilds after a game goes live: the database calls the `deploy-hook` function, which starts
   the `deploy` workflow through `GITHUB_DISPATCH_TOKEN` and `GITHUB_REPO` (at most one build
   every 30 minutes). If you let Cloudflare build from Git instead, store a Pages deploy hook
   URL as `PAGES_DEPLOY_HOOK_URL`. Until a rebuild lands, new games already work through the
   client fallback page.
5. Add your custom domain in Pages > Custom domains.

## 5. Check it

- Open the site: the "Mock mode" badge in the header must be **gone**.
- Sign in, open `/dev/`, create a studio, upload a small HTML5 zip. The pre-QA bot report should
  arrive within a few minutes (GitHub Actions > pre-qa).
- Open `/admin/`, approve the game, and play it from the homepage.

## 6. Ads (when you are ready)

Ads are off until you set the variables. Apply for AdSense with the live site, then set
`NEXT_PUBLIC_ADSENSE_CLIENT` and the two slot ids and redeploy. In-game video ads need Google's
separate H5 games ads approval; until then leave `NEXT_PUBLIC_INGAME_ADS=mock` off in production
by setting it to `none`.

The site's own rules stay on whatever you configure: no ad ever covers the game frame, none
appear on `/dev`, `/admin` or policy pages, and minors, visitors of unknown age and school-safe
mode only get non-personalised ads.

## 7. Three sites, one sign-in

The player site, the developer portal and the management portal are three Cloudflare Pages
projects built from this repository (`npm run build` makes `apps/web/out`, `out-developers` and
`out-manage`). Give them, for example, `brainstorming.games`, `developers.brainstorming.games` and
`manage.brainstorming.games`, and set `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=.brainstorming.games` so one
sign-in covers all three. Serve games from a different domain (for example `bgplay.net`): the build
refuses a cookie domain that would cover the game origin.

## 8. The owner code (management portal)

Every admin must also pass a 6-digit code from an authenticator app. On the live site this is
Supabase multi-factor sign-in: turn on Authentication > Multi-Factor > TOTP. The database itself
refuses staff actions from a session without the code (migration 0012), so a stolen password or a
stolen sign-in link opens nothing. The first time an admin opens the portal it shows a QR code to
scan with Google Authenticator, Microsoft Authenticator or Authy.

To make your co-founder an admin: they sign up on the site, then you open Moderation > Players and
press **Make admin** (or run `update public.profiles set role = 'admin' where username = '…'`).

## 9. Payments (Premium and Boost)

1. Create a Razorpay account (no monthly fee) and complete its business verification.
2. Subscriptions > Plans: create **Plus** at ₹99 monthly and **Max** at ₹199 monthly.
3. Supabase secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_PLUS`,
   `RAZORPAY_PLAN_MAX`, `RAZORPAY_WEBHOOK_SECRET`. GitHub variable: `NEXT_PUBLIC_RAZORPAY_KEY_ID`.
4. Deploy `billing` and `razorpay-webhook` (the webhook with `--no-verify-jwt`).
5. Razorpay > Webhooks: URL `https://<project>.supabase.co/functions/v1/razorpay-webhook`, the same
   secret, events `subscription.activated`, `subscription.charged`, `subscription.cancelled`,
   `subscription.halted`, `subscription.completed`, `order.paid`.

A membership or Boost only ever starts from Razorpay's signed webhook, never from the browser.
Without the keys, the site shows a clearly marked test checkout where no money moves.

## 10. Google and Apple sign-in

- **Google** (free): create an OAuth client in Google Cloud, set `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and
  add the same client to Supabase > Authentication > Providers > Google.
- **Apple**: needs an Apple Developer account (USD 99 a year): create a Services ID and key, then
  fill Supabase > Authentication > Providers > Apple. The button switches on with the live site.

## 11. E-mails

See [EMAIL.md](EMAIL.md).

## 12. Monthly routine

1. Download the month's AdSense report as CSV (`country,gross,refunds,invalid_traffic`).
2. `/admin/revenue/`: paste it, preview the split, publish the statements.
3. Pay each studio outside the site, then record the payout reference on the same page.

## Free-tier limits to watch

| Service | Free limit | What happens near it | Upgrade trigger |
| --- | --- | --- | --- |
| Supabase database | 500 MB | Events are the big table; they are rolled up daily | Above ~400 MB, or 50,000 monthly players |
| Supabase Edge Functions | 500,000 calls a month | Set `NEXT_PUBLIC_EVENTS_TRANSPORT=rpc` to stop spending calls on events | Regularly above 400,000 |
| Supabase project pause | After 7 quiet days | The `keepalive` workflow pings it daily | n/a |
| Cloudflare Pages | 500 builds a month, 20,000 files | Rebuilds are debounced to one per 30 minutes | Above ~8,000 games (2 files each) |
| Cloudflare R2 | 10 GB storage, free egress | About 500 games at 20 MB | Storage above 8 GB |
| GitHub Actions | 2,000 minutes a month (private repo) | Each pre-QA run takes about 3 minutes | Make the repo public (unlimited) or cap uploads |
| Resend | 100 e-mails a day | Only parental-consent mails use it | More than ~80 consent requests a day |

Do not use Vercel's Hobby plan for this site: its terms do not allow commercial use, and the
site shows ads.

## Before a public launch

- The three legal documents in `/docs` are **drafts** and say so on the site. Have a lawyer
  review them, then remove their slugs from the `DRAFT` list in
  `apps/web/src/lib/policies/policyPage.tsx`.
- Fill `NEXT_PUBLIC_CONTACT_EMAIL`.
