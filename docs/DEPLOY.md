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
   - `BG_EDGE_KEY`: 32 random bytes, hex. The database must know the same key, so in the SQL
     editor run `select app.set_secret('edge_key', '<the same value>');` (only a hash is stored).
     Without it, player IPs seen through the Edge Functions all look like Supabase's server and
     the per-IP caps on plays and ad views cannot tell people apart.
8. Lock media to your own storage (covers and videos may only come from your project's "media"
   bucket, which migration 0021 creates). In the SQL editor:

   ```sql
   insert into public.site_config (key, value) values ('media_host', '{"url": "https://<project-ref>.supabase.co"}')
   on conflict (key) do update set value = excluded.value;
   ```

## 3. Game builds: Supabase Storage or Cloudflare R2

**Supabase Storage (the free launch, no card).** Migration 0025 creates the private `builds`
bucket (50 MB a file, the free-plan limit) and its upload rule. Developers upload with their own
sign-in; only the games server reads the bucket. Set it up:

- Supabase > Project Settings > API Keys: create a secret key named `games-server`.
- Store it in the Worker yourself (paste it at the prompt; it is never written into a file):
  `npx wrangler secret put SUPABASE_STORAGE_KEY --config workers/play/wrangler.toml`.
- `workers/play/wrangler.toml` has `SUPABASE_URL` and `STORAGE_BUCKET = "builds"`.
- Limits of the free plan: about 1 GB of files in all and about 5 GB of downloads a month. Then
  move to R2 (below): uncomment `[[r2_buckets]]` in `wrangler.toml`, copy the builds across and
  switch `presign-upload` back to signed R2 links (git history before migration 0025).

**Cloudflare R2 (later, more room, unlimited downloads).**

1. Create an R2 bucket, for example `bg-play`.
2. Give it a **custom domain** such as `play.<your-domain>`. Game builds must be served from a
   different origin than the site; that separation is what keeps a game from touching player
   accounts.
3. Add a CORS rule that allows `PUT` from your site's origin (developers upload straight from
   the browser with presigned URLs) and `GET` from the player site and developer portal origins
   (the vertical-trailer maker draws preview videos onto a canvas, which needs CORS). The `PUT`
   rule must allow the request headers `content-type` and `if-none-match`: upload links are
   signed for one file's exact type and size and are write-once.
4. **Game origins.** Every game runs on its own origin, so one game can never read another's
   saves or storage. Buy a second, cheap domain used only for games (for example
   `bgplay.net`; never a subdomain of the site's domain) and add it to Cloudflare. Then:
   - DNS: a proxied (orange cloud) `*` record pointing anywhere, e.g. `AAAA * 100::`.
   - Edit `workers/play/wrangler.toml` (games domain, bucket name, the three site addresses) and
     deploy the Worker: `npx wrangler deploy --config workers/play/wrangler.toml`.
   - Set `NEXT_PUBLIC_GAME_ORIGIN_PATTERN=https://{game}.<games domain>` (GitHub variable) and
     the Supabase secrets `GAME_ORIGIN_PATTERN` (same value) and `PLAY_ORIGIN`.
   - Optional, later: ask for the games domain to be added to the Public Suffix List
     (publicsuffix.org) so browsers also keep cookies apart between game subdomains.
   - Free plan: 100,000 Worker requests a day. Files are cached in the browser for a year, so a
     repeat player costs a few requests, but a busy day of new players can pass it. Watch the
     Workers dashboard; Workers Paid (USD 5 a month) covers 10 million.
   The live build refuses to start without the pattern.
5. Create an R2 API token with read and write on that bucket and put its values in the
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

### Keep the management portal private (Cloudflare Access, free)

The player site and the developer portal contain no link to the management portal and not even
its address (the build checks this). Lock the door too, so nobody else can load it at all:

1. Cloudflare dashboard > Zero Trust (free for up to 50 people) > Access > Applications > Add an
   application > Self-hosted.
2. Application domain: the management portal's address (for example `manage.<your-domain>`).
3. Policy: Action **Allow**, Include **Emails**: only your and your co-founder's addresses.
   Login method: **One-time PIN** (a code e-mailed by Cloudflare).
4. Save. Anyone else now sees Cloudflare's door, not the portal. Behind it the portal still asks
   for your sign-in and the owner code.

Keep the address out of public places (posts, screenshots, the developer docs) and bookmark it.

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

### India only, for now

Money flows in India only (`apps/web/src/lib/domain/market.ts`):

- Premium and Boosts are sold only to visitors in India. The site asks the `geo` Edge Function
  for the visitor's country (deploy it with the others), the `billing` function refuses buyers
  from other countries, and Razorpay refuses foreign cards as long as **International payments
  stays switched off** in the Razorpay dashboard. Keep it off.
- Only studios in India earn a share of ad revenue (others get 0% in the monthly split), and
  payouts go only to Indian bank accounts (IFSC). Creators likewise.

To open another country later: add it to `PAID_COUNTRIES` / `EARNING_COUNTRIES`, switch on
Razorpay international payments or add a provider, and settle GST, export and withholding-tax
rules with a CA first.

## 10. Google and Apple sign-in

- **Google** (free): create an OAuth client in Google Cloud, set `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and
  add the same client to Supabase > Authentication > Providers > Google.
- **Apple**: needs an Apple Developer account (USD 99 a year): create a Services ID and key, then
  fill Supabase > Authentication > Providers > Apple. The button switches on with the live site.

## 11. E-mails

See [EMAIL.md](EMAIL.md).

### Bot check on sign-in (Cloudflare Turnstile, free)

Without it, a script can ask for thousands of sign-in e-mails, flood strangers' inboxes from our
address and use up the daily sending limit so real players cannot sign in.

1. Cloudflare dashboard > Turnstile > Add widget, mode **Managed**, domains: the three sites.
2. Put the **site key** in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (GitHub variable for the build).
3. Put the **secret key** in Supabase > Authentication > Attack Protection > Enable CAPTCHA
   protection > Turnstile. Turn this on only after a build with the site key is live, or sign-in
   stops working.
4. In Supabase > Authentication > Rate Limits, keep e-mail sending low (for example 30 an hour)
   and the OTP verification limit at its default.

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
