# Security

How the platform defends itself, phase by phase. Internal: not published on the site.

## Phase 1: before launch (done)

| Attack | Defence | Where |
| --- | --- | --- |
| Fake plays and ad views to earn money or climb the charts | Country only from Cloudflare (or our own Edge Function, proven by `BG_EDGE_KEY`); plays capped per browser (20) and per IP (100) per game per day; ad views capped per browser and IP; an ad view counts for revenue only in a session with at least 20 seconds of play; creator referrals count only for the right studio | `0020_security_fraud.sql` |
| Faking many IPs with `X-Forwarded-For` | The client's copy is ignored; the IP comes from `cf-connecting-ip`, or from our Edge Function with the edge key | `app.client_ip()`, `_shared/http.ts` |
| Bait-and-switch: get a page approved, then change it to a scam | Text edits to a released game wait for review (`game_pending_edits`); new covers and videos wait for review; a released game's address never changes; staff review them in Review queue > Changes to live games | `0021_security_live_games.sql` |
| Covers and videos pointing at other websites | Media URLs must be files in the game's own folder of our `media` bucket (`site_config.media_host`) | `app.media_url_ok()` |
| Uploading anything to the media bucket, or overwriting another game's cover | Bucket accepts WebP, MP4 and WebM up to 50 MB; uploads only into a game you own; no overwrite or delete through the API; 120 files an hour | `0021`, storage policy `bg_media_insert` |
| Swapping build files after pre-QA, or filling storage | Every file is registered first (path and exact size, within the declared totals); links last 5 minutes, are bound to the size and a type we choose, and are write-once (`If-None-Match: *`); nothing is approved while links may be open | `presign-upload`, `register_upload()`, `app.block_open_uploads()` |
| A "minor update" that is really a different game | Auto-publish only when the entry file matches, the size is within 0.5x to 1.5x and the file count is similar, at most 3 a week; anything else needs human review | `app.minor_update_ok()` |
| Bots flooding sign-in e-mails (spam from our address, daily limit used up) | Cloudflare Turnstile before a code is sent; Supabase checks the token | `Turnstile.tsx`, DEPLOY.md section 11 |
| Guessing secrets by timing | Constant-time comparison for every shared secret | `sameSecret()` |
| Sign-in links that redirect to a phishing site | `next` must be a path on this site; backslashes, control characters and encoded `//` are refused | `lib/domain/safeNext.ts` |
| Internal helpers callable by anyone | `app.*` functions are callable by API roles only where row security needs them | `0022_security_helpers.sql` |
| A live build accidentally in test mode | The build stops if a live address has no Supabase settings | `scripts/postbuild.mjs` |

Already in place before Phase 1: the owner code (multi-factor) enforced in the database for every
staff action, signed payment webhooks, encrypted payout details, sandboxed game frames on a
separate origin, server-checked scores, CSP with `frame-ancestors 'none'`, local services bound
to 127.0.0.1.

### Go-live checklist for Phase 1

1. Push migrations 0020 to 0022, deploy the changed Edge Functions.
2. `BG_EDGE_KEY` secret, and `select app.set_secret('edge_key', '<same value>');`.
3. `site_config.media_host` (DEPLOY.md section 2, step 8).
4. R2 CORS allows `content-type` and `if-none-match` on PUT.
5. Turnstile site key in the build, secret key in Supabase, then turn CAPTCHA on.

## Phase 2: isolation (next)

Per-game origins on a separate domain through Cloudflare; HSTS, stricter CSP, `security.txt`;
Next.js and test-tool updates; pre-QA checks for crypto-mining and fake password forms.

## Phase 3: money and accounts

Payout-detail changes: e-mail alert, fresh sign-in and a 48-hour hold; sign out everywhere;
owner backup codes and a second owner; alerts and a fraud review screen.

## Phase 4: resilience

Nightly encrypted backups and monitoring; incident plan (CERT-In within 6 hours, DPDP); key
rotation; automated security tests in CI.
