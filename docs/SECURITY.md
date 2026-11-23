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
| Swapping build files after pre-QA, or filling storage | Every file is registered first (path and exact size, within the declared totals). Supabase Storage (free launch): the private `builds` bucket takes only registered files, at the registered size, from the owner, for 6 minutes after registering, 50 MB a file, never overwritten or deleted; only the games server reads it. R2 (later): links last 5 minutes, are bound to the size and a type we choose, and are write-once (`If-None-Match: *`). Either way nothing is approved while uploads may be open | `presign-upload`, `register_upload()`, `app.build_upload_ok()` and policy `bg_builds_insert` (`0025`), `app.block_open_uploads()` |
| Copied games and harmful builds wasting moderator time | Clear copies (copied build, cover, art or text, a protected name, no rights declaration) are rejected at submission; harmful code found by the test-play (mining, password or card fields, outside ad networks) is rejected whenever the report arrives. Borderline findings go to a person. Automatic rejections are recorded with no reviewer and tell the developer why | `autoRejectReason()`, `harmfulReason()`, `app.auto_reject()` (`0026`) |
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
4. Builds: migration 0025 (Supabase `builds` bucket) and the games server's `SUPABASE_STORAGE_KEY`; or, with R2, CORS allows `content-type` and `if-none-match` on PUT.
5. Turnstile site key in the build, secret key in Supabase, then turn CAPTCHA on.

## Phase 2: isolation (done)

| Attack | Defence | Where |
| --- | --- | --- |
| One game reading another game's saves, IndexedDB, cookies or service worker | Every game on its own origin, `g-<game id>.<games domain>`, on a domain separate from the site; the server maps each subdomain to exactly one game folder | `workers/play`, `_shared/gameOrigin.ts`, `scripts/dev-services.mjs` |
| A game page opened on the shared play origin, or reading the local test database | The shared origin no longer serves game pages; game origins serve no tools | `scripts/dev-services.mjs` |
| Our games framed on someone else's site | Game pages carry `frame-ancestors` with only our three sites | `gameHeaders()` |
| A game talking to the site as another game | The bridge only answers the exact origin of the frame it loaded | `lib/sdk-host/bridge.ts` |
| Phishing forms, camera or microphone inside a game | `form-action 'self'`, Permissions-Policy denies camera, microphone, location, payment, USB | `gameHeaders()` |
| Script injection (XSS) on the sites | Each page carries a second policy that allows only its own inline scripts (by SHA-256); the player site skips it while AdSense is on | `scripts/postbuild.mjs` |
| HTTPS downgrade, clickjacking | HSTS for a year (live https builds), `X-Frame-Options: DENY` with `frame-ancestors 'none'` | `_headers` |
| No way to report a vulnerability | `/.well-known/security.txt` on every site | `scripts/postbuild.mjs` |
| Hidden crypto-miners | Pre-QA fails builds that contact mining pools or contain miner code | `lib/domain/preqa.ts`, `scripts/pre-qa.ts` |
| Fake sign-in or payment forms | Pre-QA fails builds that show password, card or one-time-code fields (warns if only the code can make them) | same |
| Known holes in dependencies | Next.js 15.5.29 (newest 15.x) with PostCSS forced to 8.5.32; Vitest 5, Playwright 1.65, typescript-eslint 8.73; `npm audit` reports 0 | `package.json` |

Next.js 16 is a major upgrade with breaking changes. It is left for a planned upgrade; 15.5.x
still gets security fixes.

### Go-live checklist for Phase 2

1. A separate games domain on Cloudflare, wildcard DNS, the `workers/play` Worker deployed
   (DEPLOY.md, section 3, step 4).
2. `NEXT_PUBLIC_GAME_ORIGIN_PATTERN` (GitHub variable), `GAME_ORIGIN_PATTERN` and `PLAY_ORIGIN`
   (Supabase secrets).
3. After the first live deploy, check the headers at securityheaders.com and the HSTS line.
4. Verify the crypto-mining and password-form checks online, on the live pre-QA bot. No fake
   malware samples are kept on the development machine (antivirus rightly flags them).

## Full audit, 2026-11-22

| Area | Result |
| --- | --- |
| Secrets | Git history (18 commits) and all three built sites checked against the real key values and common key formats: no leaks. Env files are ignored by Git. Only public keys reach the browser. |
| Admin routes | Management portal: separate site, no links or address in the public sites (build check), owner code enforced by the database, Cloudflare Access at go-live. |
| Authentication | E-mail code sign-in (no passwords stored anywhere; Supabase handles codes), owner code (TOTP) for staff, Turnstile bot check. |
| Own data only | Row-level security on every table; guests cannot write any table; every admin function checks the staff role; every privileged function pins its search path (`tests/db/security-audit.test.ts`). |
| Forms and XSS | Markdown is rendered without HTML; unsafe link schemes and backslash tricks dropped; structured data escaped; strict per-page script policy. |
| Rate limits | Database token buckets on sign-in, events, uploads, payments and edits. |
| CORS | Edge Functions answer only our three sites, never `*`. |
| Headers | CSP, HSTS, X-Frame-Options, nosniff, Referrer and Permissions policies; private headers on the management portal. |
| Debug | No source maps or debug logging in production; a live build refuses mock mode. |
| Dependencies | `npm audit`: 0 vulnerabilities. Next.js's own copy of PostCSS is forced to the patched version: after `npm update`, check `npm audit` again (it can bring the old copy back). |
| Exposed files | No env, map, source, SQL or Git files in the built sites. |
| Antivirus | Windows Defender scan of the project: clean. No malware-like test samples are kept; such checks run online only. |

## Phase 3: money and accounts (done)

Payout-detail changes get an e-mail alert, a fresh sign-in and a 48-hour hold; sign out
everywhere; owner backup codes; security alerts and a fraud scan in the daily job
(`0023_security_accounts.sql`). Studio co-owners (`0028`): a second owner for BrainStorming
Studios, while payout details stay with the main owner.

## Phase 4: resilience (done)

| What | How | Where |
| --- | --- | --- |
| Nightly encrypted backups | pg_dump of public, auth and storage, AES-256 with the owners' passphrase, 30 days | `.github/workflows/backup.yml`, docs/BACKUPS.md |
| Live monitoring | Every 3 hours: sites, games server and database answer; HSTS, CSP, framing, nosniff, permissions; private tables and builds stay private; the management portal stays hidden. A failure e-mails the owner | `.github/workflows/monitor.yml`, `scripts/monitor-live.mjs` |
| Security checks on every change | Leaked secrets in the whole history (gitleaks), vulnerable packages (npm audit, high and above), risky code patterns (Semgrep, errors) | `.github/workflows/ci.yml` (job `security`) |
| Supply chain | Every GitHub Action pinned to a commit, the deploy tool to an exact version; jobs only read the repository; weekly Dependabot updates | `.github/workflows/*`, `.github/dependabot.yml` |
| Miner rules online only | The test-play downloads the community miner host list on GitHub's runner for each run; extra hosts and code signatures can be GitHub secrets. Nothing of the kind is stored in the repository or on a developer machine | `.github/workflows/pre-qa.yml` |
| Incident plan | Contain, keep evidence, CERT-In within 6 hours, DPDP notices | docs/INCIDENT.md |
| Key rotation | Every secret, where it lives and how to change it | docs/KEY-ROTATION.md |
| Bot check on sign-in | Cloudflare Turnstile before a sign-in code is sent | DEPLOY.md, "Bot check on sign-in" |

Limits of the free plans, and what replaces them: GitHub's CodeQL, secret scanning and branch
protection need a paid plan for private repositories (gitleaks and Semgrep run instead);
Supabase Free has no backups (the nightly job); Cloudflare Access needs a card (the management
portal relies on the admin role plus the owner code, enforced by the database).
