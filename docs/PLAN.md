# Brainstorming Games: build plan

Status legend: `[ ]` not started Â· `[~]` in progress Â· `[x]` done and verified.

This file is the single source of truth for scope and progress. Each phase is ticked only after
`npm run build`, `npm run lint`, `npm run typecheck` and the tests pass.

---

## 1. Decisions that shape the build

These are the places where the brief leaves a choice or where two requirements pull against each other.

| # | Decision | Why |
|---|---|---|
| D1 | **Static export + live catalogue.** `scripts/build-catalogue.ts` writes a catalogue snapshot at build time. Pages are pre-rendered from it, then client components revalidate against the live data layer. | The site is a static export, but games are published at any time and the mock catalogue lives in the browser. |
| D2 | **Client fallback for pages that are not pre-rendered.** `/fallback/` is exported and copied to `404.html` (and `/hi/404.html`). It resolves `/game/*`, `/studio/*`, `/t/*`, `/u/*`, `/party/*`, `/jams/*` in the browser. `_redirects` also serves `/u/*` and `/party/*` shells with a 200. | A game approved 5 minutes ago must be playable before the next debounced rebuild. Profiles and parties can never be pre-rendered. |
| D3 | **English at the root, other locales prefixed** (`/game/x`, `/hi/game/x`). Canonical routes live in `app/(en)`; `scripts/gen-locale-routes.mjs` generates thin re-export wrappers in `app/[locale]`. | Static export has no middleware, hreflang needs one URL per language, and the brief's routes are un-prefixed. Adding Tamil, Telugu, Bengali or Marathi is one line in `i18n/config.ts` plus a messages file. |
| D4 | **Dev mode is not an export.** `output: 'export'` is applied to production builds only, so `next dev` can render any dynamic path on demand. | `next dev` refuses unknown dynamic params under `output: 'export'`. |
| D5 | **Mock mode = `localStorage` database + `BroadcastChannel` realtime + per-tab sessions.** The "database" is shared by every tab; the signed-in user is per tab (`sessionStorage`). | Lets two tabs act as two players (friends, presence, parties) with zero backend. |
| D6 | **Local dev services** (`scripts/dev-services.mjs`, no dependencies) emulate the play origin on another port, presigned uploads and the pre-QA trigger. | Games must run on a different origin from the site even locally; a static site cannot accept uploads. |
| D7 | **Privileged logic lives in `SECURITY DEFINER` Postgres functions** wherever an untrusted client is involved (events, scores, ratings, points, QA transitions, friends, parties). Edge Functions are used only where a secret or an outbound call is needed (R2 presign, game JWT, GitHub dispatch, deploy hook, e-mail, events wrapper, health). | SQL is testable in CI with PGlite, and it keeps us inside the 500k Edge Function calls a month. |
| D8 | **Pure domain logic is TypeScript, unit-tested once** (`apps/web/src/lib/domain`): Bayesian rating, KPI maths, quest evaluation, revenue split, Spark rotation, ad rules. The admin revenue run executes in the admin's browser and persists through an admin-only, audit-logged RPC. | One canonical implementation of the money maths for both mock and Supabase modes. |
| D9 | **Game user token is ES256, not a shared secret.** The private JWK is an Edge Function secret; the public JWKS is published at `/.well-known/bg-game-jwks.json`. | Developers must be able to verify the token on their own servers without holding our secret. |
| D10 | **In-game ads render in the parent page over the frame**, driven by the SDK through `postMessage`. One `AdRules` engine is shared by the SDK and the host. | The platform owns the rules, consent state and provider code; a game cannot bypass the cooldown. |
| D11 | **Cover variants are made in the browser at upload** (WebP at 320/640/960/1280/1920 + a tiny blur placeholder). Brand assets get AVIF + WebP from `sharp`. | Supabase Free has no image transformations and Cloudflare Images is paid. |
| D12 | **Database types are generated from the migrations** by booting PGlite (`scripts/gen-db-types.ts`). | End-to-end typing without Docker or a live project. |
| D13 | **Age gate is conservative.** With only a birth year, anyone who could still be 17 this year is treated as a minor. Behind `AGE_GATE` in `lib/config.ts`. | DPDP: under 18 needs parental consent; birth year alone cannot prove 18. |
| D14 | **CSP uses an allow-list with `'unsafe-inline'` for scripts.** `_headers` is generated at build from env. | App Router static HTML contains per-page inline bootstrap scripts and static hosting has no nonces. Developer content is rendered by a React-element markdown renderer (no `innerHTML`). |
| D15 | **Sitemaps, `_headers`, `_redirects`, the service worker manifest and the 404 copies are written by `scripts/postbuild.mjs`.** | Full control over a static output; no reliance on export edge cases. |
| D16 | **Events default to the Edge Function** (as briefed) and can switch to the direct RPC with `NEXT_PUBLIC_EVENTS_TRANSPORT=rpc`. | Events are the first thing to hit the 500k function-call limit. |

### Local machine notes (not part of the product)

- This machine has **no Git**. Phase commits are made with `isomorphic-git` (a pure-JS Git, kept outside the repo). They are ordinary Git commits and will show up in `git log` once Git is installed.
- The repo sits in a OneDrive-synced folder. `node_modules`, `apps/web/.next`, `apps/web/.build` and `.local` are **directory junctions** to `%LOCALAPPDATA%\BrainstormingGames\dev`, so OneDrive never sees them. The static export goes to `apps/web/.build/out` here (`BG_EXPORT_DIR` in the git-ignored `.env.local`); everywhere else it is the usual `apps/web/out`.
- Playwright and Lighthouse use the installed Chrome (`channel: 'chrome'`) locally; CI installs Chromium.

---

## 2. File tree

```
brainstorming-games/
â”œâ”€ package.json                 npm workspaces + root scripts
â”œâ”€ tsconfig.base.json  eslint.config.mjs  .prettierrc.json  vitest.config.ts  playwright.config.ts
â”œâ”€ .env.example                 every variable, one line each on how to get it
â”œâ”€ brand/                       logo-full.png, mascot.png (sources)
â”œâ”€ apps/web/
â”‚  â”œâ”€ next.config.ts  postcss.config.mjs  tsconfig.json
â”‚  â”œâ”€ messages/                 en.json, hi.json
â”‚  â”œâ”€ public/                   generated brand assets, sdk/v1/, sw.js
â”‚  â””â”€ src/
â”‚     â”œâ”€ app/
â”‚     â”‚  â”œâ”€ layout.tsx  not-found.tsx  manifest.ts  robots.ts
â”‚     â”‚  â”œâ”€ (en)/               canonical routes (see below)
â”‚     â”‚  â””â”€ [locale]/           generated wrappers for hi (and future locales)
â”‚     â”œâ”€ routes/                page implementations shared by both trees
â”‚     â”œâ”€ components/
â”‚     â”‚  â”œâ”€ shell/              Header, Sidebar, BottomTabs, Footer, SearchBox, ThemeToggle, LocaleSwitch
â”‚     â”‚  â”œâ”€ catalogue/          GameTile, Rail, GameGrid, HeroCarousel, CategoryGrid, FilterBar, EmptyState
â”‚     â”‚  â”œâ”€ game/               GameFrame, Toolbar, InfoStrip, SeoContent, RightRail, GameLeaderboard, SdkHost
â”‚     â”‚  â”œâ”€ player/             Quests, Locker, Profile, Friends, Party, Leaderboards, Notifications
â”‚     â”‚  â”œâ”€ dev/                wizard steps, KPI charts, pre-QA report, docs
â”‚     â”‚  â”œâ”€ admin/              QA queue, Spark decisions, featured editor, revenue, moderation
â”‚     â”‚  â”œâ”€ ads/                AdSlot, ConsentBanner, InGameAdOverlay
â”‚     â”‚  â””â”€ seo/                JsonLd
â”‚     â”œâ”€ i18n/                  config.ts, request.ts, navigation.tsx
â”‚     â”œâ”€ lib/
â”‚     â”‚  â”œâ”€ config.ts           MASCOT_NAME, site URL, play origin, flags, AGE_GATE
â”‚     â”‚  â”œâ”€ catalogue/          categories.ts, snapshot.ts, listings.ts, search.ts
â”‚     â”‚  â”œâ”€ data/               types.ts, repo.ts (the one interface), index.ts (picks the implementation)
â”‚     â”‚  â”‚  â”œâ”€ mock/            localStorage tables, seeds, "server" logic, realtime
â”‚     â”‚  â”‚  â””â”€ supabase/        supabase-js implementation, generated database.types.ts
â”‚     â”‚  â”œâ”€ domain/             rating, kpis, quests, revenue, spark, ageGate, markdown, zipValidation, preqa
â”‚     â”‚  â”œâ”€ sdk-host/           postMessage bridge (zod schemas), ad manager, session tracker
â”‚     â”‚  â”œâ”€ events/             client queue and transports
â”‚     â”‚  â””â”€ hooks/              useRepoQuery, useSession, usePrefs, useToast
â”‚     â””â”€ generated/             catalogue snapshot, SDK reference JSON (git-ignored)
â”œâ”€ packages/
â”‚  â”œâ”€ sdk/                      @brainstorming/sdk
â”‚  â”‚  â””â”€ src/                   index.ts, env.ts, transport.ts, protocol.ts, game.ts, ad.ts, ads/*, user.ts,
â”‚  â”‚                            data.ts, leaderboard.ts, quests.ts, debugOverlay.ts, host.ts (zod, host only),
â”‚  â”‚                            crazygames-shim.ts
â”‚  â””â”€ ui/                       @brainstorming/ui: tokens.css, Button, Card, Chip, Dialog, Tabs, Toast, Field,
â”‚                               Mascot, MascotAvatar (layered SVG cosmetics), Skeleton, ProgressBar, EmptyState
â”œâ”€ supabase/
â”‚  â”œâ”€ config.toml  seed.sql
â”‚  â”œâ”€ migrations/               0001_core â€¦ 0010_growth (one per area, see section 3)
â”‚  â””â”€ functions/                events, presign-upload, game-token, pre-qa-dispatch, pre-qa-report,
â”‚                               deploy-hook, parental-consent, payout-profile, health, _shared/
â”œâ”€ tests/
â”‚  â”œâ”€ fixtures/sdk-probe/       the only "game": a bare page that calls every SDK method (tests only)
â”‚  â”œâ”€ e2e/                      Playwright specs
â”‚  â””â”€ db/                       PGlite tests: migrations apply, RLS on every table, RPC behaviour
â”œâ”€ scripts/                     prepare-brand.ts, build-catalogue.ts, pre-qa.ts, gen-locale-routes.mjs,
â”‚                               gen-db-types.ts, gen-sdk-docs.ts, dev.mjs, dev-services.mjs, serve-static.mjs,
â”‚                               postbuild.mjs, check-budgets.mjs, lighthouse.mjs
â”œâ”€ .github/workflows/           ci.yml, pre-qa.yml, keepalive.yml, deploy.yml
â””â”€ docs/                        PLAN.md, SDK.md, DEPLOY.md, DEVELOPER_TERMS.md, PRIVACY.md, PLAYER_TERMS.md
```

### Routes

| Area | Routes |
|---|---|
| Catalogue | `/` Â· `/game/[slug]` Â· `/c/[category]` Â· `/t/[tag]` Â· `/tags` Â· `/new` Â· `/trending` Â· `/updated` Â· `/originals` Â· `/multiplayer` Â· `/recent` Â· `/favourites` Â· `/search` |
| Player | `/quests` Â· `/leaderboards` Â· `/u/[username]` Â· `/locker` Â· `/friends` Â· `/party` Â· `/party/[code]` Â· `/notifications` Â· `/settings` Â· `/login` Â· `/signup` Â· `/parents/consent` |
| Studios | `/studio/[slug]` Â· `/developers` Â· `/jams` Â· `/jams/[slug]` Â· `/blog` |
| Developer portal | `/dev` Â· `/dev/signup` Â· `/dev/games/new` Â· `/dev/games/edit` Â· `/dev/games/view` Â· `/dev/games/kpi` Â· `/dev/games/versions` Â· `/dev/preview` Â· `/dev/feedback` Â· `/dev/devlogs` Â· `/dev/studio` Â· `/dev/referrals` Â· `/dev/payouts` Â· `/dev/docs/[page]` |
| Admin | `/admin` Â· `/admin/qa` Â· `/admin/qa/review` Â· `/admin/spark` Â· `/admin/featured` Â· `/admin/quests` Â· `/admin/cosmetics` Â· `/admin/jams` Â· `/admin/reports` Â· `/admin/users` Â· `/admin/studios` Â· `/admin/revenue` Â· `/admin/audit` |
| Policies | `/about` Â· `/contact` Â· `/parents` Â· `/school-safe` Â· `/terms` Â· `/privacy` Â· `/developer-terms` Â· `/cookies` |
| System | `/offline` Â· `/fallback` (becomes `404.html`) Â· `/og/game/[slug]/image.png` |

Private pages (`/dev`, `/admin`) take ids in the query string, so each is one static file.

---

## 3. Database schema (Supabase Postgres)

RLS is enabled on every table with default deny. `anon` and `authenticated` get only what a policy grants.
`service_role` is used only inside Edge Functions. Tables are grouped by the migration that creates them.

### 0001_core: enums and catalogue

- Enums: `game_status` (draft, in_review, changes_requested, spark, rise, featured, paused, removed) Â· `game_orientation` (landscape, portrait, any) Â· `game_platform` (desktop, mobile, tablet) Â· `media_kind` (cover_landscape, cover_portrait, cover_square, preview_landscape, preview_portrait) Â· `qa_status` (uploaded, pre_qa_running, pre_qa_passed, pre_qa_warn, pre_qa_failed, in_review, approved, changes_requested, rejected) Â· `studio_level` (rookie, pro, partner) Â· `user_role` (player, moderator, admin) Â· `consent_status` (not_required, pending, granted, denied) Â· `event_type` (the 12 briefed types).
- `profiles` (id â†’ auth.users, username unique, display_name, avatar_cosmetics jsonb, birth_year, is_minor, parental_consent_status, locale, low_data, school_safe, school_safe_pin_hash, brain_points, level, streak_days, streak_last_day, last_active, role, banned_at, profile_public, playtest_opt_in, created_at). Users can read public columns through the `public_profiles` view and update only their own safe columns (column grants); `role`, `brain_points`, `level`, `is_minor`, `parental_consent_status` change only through functions.
- `studios` (id, owner_id, name, slug unique, bio, avatar_url, country, contact_email, links jsonb, verified, is_first_party, level, suspended_at, terms_version, terms_accepted_at, guardian_name, created_at)
- `studio_payout_profiles` (studio_id pk, ciphertext, iv, key_version, method, currency, updated_at): AES-GCM encrypted by the `payout-profile` Edge Function; no client policy at all.
- `studio_followers` (studio_id, user_id, created_at)
- `games` (id, studio_id, slug unique, title, short_description, description_md, how_to_play_md, controls jsonb, faq jsonb, features_md, tips_md, category, tags text[], orientation, platforms game_platform[], engine, is_multiplayer, has_progress, school_safe, size_bytes, initial_load_bytes, status, spark_started_at, rise_started_at, exclusive_until, current_version_id, max_score_per_sec, created_at, released_at, updated_at, search tsvector generated). `status` and launch columns are not client-writable.
- `game_versions` (id, game_id, version, storage_prefix, file_count, total_bytes, entry_file, uses_sdk, pre_qa_report jsonb, qa_status, qa_notes, preview_token_hash, created_by, created_at)
- `game_media` (id, game_id, kind, url, widths int[], width, height, placeholder, variant_label, is_active, created_at)
- `ratings` (voter_key, game_id, user_id null, value Â±1, reason, created_at; pk voter_key + game_id). `voter_key` is the user id or `anon:<id>`.
- `favorites` (user_id, game_id, created_at) Â· `play_history` (user_id, game_id, last_played_at, play_count, seconds_played)
- `site_config` (key, value jsonb, updated_by, updated_at): hero, rails order, featured ids, ad weights, deploy debounce.
- `rate_limits` (bucket_key pk, tokens, updated_at): the Postgres token bucket.

### 0002_events_kpis

- `events` (id bigint, anon_id, user_id, session_id, game_id, version_id, type, ts, payload jsonb, country, device, ref_studio). Insert only through `ingest_events()`; no client select.
- `daily_game_kpis` (game_id, day, plays, players, conversion_1min, avg_session_sec, d1_retention, d7_retention, ad_impressions, ad_impressions_by_country jsonb, likes, dislikes, load_ms_p50, load_ms_p90, est_revenue), filled by `refresh_daily_game_kpis(day)`.
- `game_stats` (game_id pk, plays_total, plays_7d, likes_180d, dislikes_180d, rating10, updated_at): the public counters the site reads.

### 0003_devportal_qa

- `qa_reviews` (id, version_id, game_id, reviewer_id, action, checklist jsonb, notes, created_at)
- `game_launches` (id, game_id, tier, started_at, ended_at, decision, reason, kpi_snapshot jsonb, decided_by)
- `reports` (id, kind, target_type, target_id, reporter_key, reason, details, status, resolved_by, created_at)
- `feedback` (id, game_id, version_id, reporter_key, category, message, context jsonb, status, created_at)
- `admin_audit_log` (id, actor_id, action, target_type, target_id, detail jsonb, created_at): append-only.
- Functions: `submit_for_review`, `qa_decide`, `spark_decide`, `publish_version`, `rollback_version`, `set_pre_qa_report`.

### 0004_progression

- `quests` (id, period, code, title jsonb, description jsonb, rule jsonb, target, reward_points, active, sort)
- `quest_progress` (user_key, quest_id, period_start, progress, completed_at, claimed_at)
- `cosmetics` (id, slot, code, name jsonb, cost_points, min_level, spec jsonb, active, sort) Â· `user_cosmetics` (user_id, cosmetic_id, unlocked_at)
- `brain_point_ledger` (id, user_id, delta, reason, ref_type, ref_id, created_at): append-only; `profiles.brain_points` is its running sum.

### 0005_social

- `friendships` (requester, addressee, status, created_at, responded_at)
- `parties` (code pk, host_key, current_game_id, members jsonb, votes jsonb, chat jsonb, state, expires_at, updated_at)
- `notifications` (id, user_id, kind, title, body, link, read_at, created_at)
- `parental_consents` (id, user_id, token_hash, parent_email_hash, status, requested_at, resolved_at, expires_at)

### 0006_leaderboards_saves

- `play_sessions` (id, user_id, anon_id, game_id, version_id, started_at, last_seen_at)
- `leaderboards` (id, game_id, key, title, sort_desc, max_score, max_score_per_sec, created_at)
- `scores` (id, leaderboard_id, user_id, score, session_id, flagged, created_at)
- `cloud_saves` (user_id, game_id, key, value jsonb â‰¤ 1 MB, updated_at)

### 0007_revenue

- `revenue_imports` (id, month, currency, fx_inr, rows jsonb, uploaded_by, created_at)
- `revenue_months` (id, studio_id, month, gross, net, share_pct, payout_due, carry_in, breakdown jsonb, status, created_at)
- `payouts` (id, studio_id, amount, currency, method, reference, status, months text[], paid_at, created_at)
- `referral_visits` (id, studio_slug, anon_id, landed_at, game_id)

### 0008_growth

- `devlogs` (id, studio_id, game_id null, title, body_md, published_at, hidden_at)
- `jams` (id, slug, title, theme, description_md, starts_at, ends_at, status) Â· `jam_entries` (jam_id, game_id, studio_id, submitted_at, rank)
- `media_variant_stats` (game_id, variant_label, impressions, clicks, decided_at, winner)
- `playtest_responses` (id, game_id, user_id, fun, clarity, play_again, created_at)

---

## 4. KPI and rule definitions (shared by mock and SQL)

- **Play** = one play session: a `play_click` followed by the frame loading. Sessions carry a `session_id`.
- **Playtime** = cumulative seconds between `gameplay_start` and `gameplay_stop`. Games without the SDK get synthetic start and stop events from the host while the frame is visible.
- **Conversion** = share of plays with at least 60 s of playtime. **Average session** = mean playtime per play.
- **D1 / D7 retention** = share of a day's new players (by anon id) who play the same game again 1 / 7 days later.
- **Rating out of 10** = `10 Ã— (20 Ã— 0.7 + likes) / (20 + votes)`, votes from the last 180 days only.
- **Spark window** ends at (7 days and 1,000 plays) or 14 days, whichever comes first. Spark games fill the "Fresh games" rail and 1 in 10 slots of the other homepage rails, least-exposed first.
- **Ad rules**: midgame at most once every 3 minutes per player and never in the first 60 s of gameplay; rewarded pays only on finish and never twice in a row; at most 2 banners and only while gameplay is stopped; every ad call during Spark resolves `{ shown: false, reason: 'spark' }`.
- **Revenue split**: net = gross âˆ’ refunds âˆ’ invalid traffic. Each country's net is shared across games by attributed ad impressions; a global row uses impressions Ã— country weight. Share: 85 % referral traffic, 80 % inside the 60-day web-exclusive window, 70 % otherwise. Payout threshold â‚¹2,000 / $25, smaller amounts roll over.

---

## 5. Phases

### Phase 1: Foundation + portal MVP

- [x] Monorepo, npm workspaces, TypeScript, ESLint, Prettier, Vitest, Playwright, CI workflow
- [x] Brand script: transparent logo and mascot, dark-theme logo, favicons, maskable icon, OG image
- [x] Design tokens, fonts (Fredoka, Nunito, Devanagari pair for Hindi), dark default + light toggle
- [x] `@brainstorming/ui` primitives and the animated mascot
- [x] i18n scaffolding (en + hi), locale wrapper generator, hreflang
- [x] Site shell: header, instant search, sidebar, bottom tabs, footer
- [x] Data layer: repository interface, mock implementation, Supabase implementation, catalogue snapshot
- [x] Migrations 0001â€“0002 with RLS, seed, PGlite tests, generated database types
- [x] Home, category, tag, tags, listing pages, search, recent, favourites
- [x] Game page: frame, toolbar (ratings, favourites, share, fullscreen, theatre, report), info strip, SEO content, right rail
- [x] AdSlot placeholders with reserved space
- [x] SEO: metadata, canonical, JSON-LD, sitemaps, robots, per-game OG image
- [x] PWA: manifest, service worker, offline page; 404 with the sad mascot; client fallback
- [x] Policy page drafts (parents, school-safe, terms, privacy, developer terms, cookies, about, contact)
- [x] Local dev services (play origin, uploads) and static server for e2e
- [x] Checks: zero-env `npm run dev`; empty states everywhere; a test-added game shows in rails, search and its page and plays in the frame; Lighthouse and JS budgets on a production build

### Phase 2: SDK + developer portal + pre-QA + admin QA

- [ ] `@brainstorming/sdk`: all modules, three environments, mock ad provider, debug overlay, size under 15 KB gzipped
- [ ] Host bridge with zod schemas and strict origin checks; in-game ad overlay
- [ ] CrazyGames shim and `docs/SDK.md`; SDK reference generated from TSDoc
- [ ] `sdk-probe` fixture
- [ ] Developer portal: signup and terms, dashboard, new-game wizard with autosave, media validation and crop, zip validation and upload, private preview with the debug overlay, versions and rollback, feedback inbox, devlogs editor, studio page editor, referral link, docs
- [ ] Pre-QA bot (Playwright, desktop + Pixel 7) and its workflow; report UI
- [ ] Admin: QA queue, review screen, checklist, approve / request changes / reject, school-safe flag, audit log
- [ ] Spark Launch exposure logic, events pipeline, KPI aggregation job, KPI page
- [ ] Migration 0003, Edge Functions (events, presign-upload, pre-qa-dispatch, pre-qa-report, deploy-hook, health)
- [ ] Check: studio signs up â†’ uploads the probe zip â†’ sees the pre-QA report â†’ submits â†’ admin approves to Spark â†’ played from "Fresh games" â†’ KPIs update

### Phase 3: Accounts + social + progression

- [ ] Auth (magic link, Google, Discord), guest merge, age gate, parental consent flow
- [ ] Profiles, settings (data export, account delete), privacy controls
- [ ] Brain Quests, Brain Points ledger, levels, streaks, locker with 30 cosmetics
- [ ] Friends, presence, join; party rooms with preset chat; notifications
- [ ] Leaderboards with server-side validation; cloud saves with guest merge
- [ ] School-safe mode with PIN; low-data mode
- [ ] Migrations 0004â€“0006, Edge Functions (game-token, parental-consent)
- [ ] Check: two sessions befriend, see each other online, start a party, move to a game together, both earn quest progress; a minor is restricted until consent

### Phase 4: Monetisation + revenue + payouts

- [ ] AdSense display adapter behind flags; non-personalised logic; consent banner
- [ ] `adsense-h5` in-game provider behind a flag
- [ ] Spark â†’ Rise decision flow with written reasons; exclusivity flag
- [ ] Revenue engine, statements (PDF), payout tracking, referral attribution
- [ ] `/developers` with the published share table
- [ ] Migration 0007, Edge Function (payout-profile)
- [ ] Check: a fake monthly revenue CSV produces correct per-studio statements in a unit-tested split

### Phase 5: Growth polish

- [ ] Clip & share (feature-detected)
- [ ] Thumbnail A/B tests with auto-pick after 1,000 impressions
- [ ] Playtest panel and the 3-question survey
- [ ] Devlogs and studio-follow notifications, blog feed
- [ ] Jams (public pages, admin manager, developer entry)
- [ ] Admin featured editor, quests and cosmetics editors, moderation
- [ ] Hindi content pass
- [ ] Migration 0008; performance re-audit against the section 10 budgets

### Final deliverables

- [ ] `npm run build && npm run lint && npm run typecheck && npm test && npm run e2e` all pass
- [ ] E2E covers: play, rate, favourite, search, upload â†’ pre-QA â†’ submit â†’ approve â†’ Spark, friend + party, minor consent gate
- [ ] README with screenshots, architecture, free-tier limits and upgrade triggers
- [ ] `docs/DEPLOY.md`
- [ ] No paid service; every external service behind an env flag with a mock fallback

---

## 6. What only the owner can switch on

Everything runs in mock mode with no keys. These need accounts that only the owner can create, so they are
written, type-checked and unit-tested here but not exercised against the live service:

- Supabase project (database, auth providers, storage, realtime, Edge Function secrets)
- Cloudflare Pages project, R2 bucket and the `play.<domain>` custom domain
- GitHub repository secrets and the pre-QA `repository_dispatch` token
- AdSense approval, and the H5 games ads programme for in-game video ads
- A transactional e-mail key for parental consent (Resend free tier)

## 7. Progress notes

- **Phase 1 (2026-11-12):** done. 6 e2e, 22 unit and 12 database tests pass; lint and typecheck clean; home first-load JS 143 KB gzipped. Lighthouse mobile: accessibility 100, best practices 100, SEO 100; performance 80s locally on simulated slow 4G, tuned again in the Phase 5 performance re-audit.
