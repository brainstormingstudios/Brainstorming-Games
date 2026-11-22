# Going online for free (no domain names)

Everything below costs ₹0 and needs no card. The sites get free Cloudflare addresses ending in
`.pages.dev`, and the games get one free address ending in `.workers.dev`.

**One limit of the free way:** all games share one address, so one game could read another
game's saved progress. Fine for a quiet start. To fix it later, buy one domain for games and
change two settings (docs/DEPLOY.md, "Game origins"); nothing else changes.

You do the clicking and typing of anything secret. Claude never sees your passwords or secret
keys, and asks before every step that changes something online.

---

## Step 1: Accounts (you, about 30 minutes)

1. **Cloudflare**: sign up free at dash.cloudflare.com with the official e-mail address.
2. **GitHub**: sign up free at github.com, then create a **private** repository named
   `brainstorming-games` (no README).
3. **GitHub Desktop**: install it from desktop.github.com and sign in. It uploads the code
   without any typing of commands.

Tell Claude when this is done.

## Step 2: Choose three names (you, 2 minutes)

The free addresses come from project names, and a name must be unused worldwide:

| Site | Example name | Address |
| --- | --- | --- |
| Player site | `brainstorming-games` | https://brainstorming-games.pages.dev |
| Developer portal | `brainstorming-games-dev` | https://brainstorming-games-dev.pages.dev |
| Management portal | something nobody can guess, e.g. `bgm-7q2xk9` | https://bgm-7q2xk9.pages.dev |

Keep the management name private (it is never shown on the public sites).

## Step 3: Database (Claude, after your OK)

Claude pushes the database changes 0020 to 0024 to your Supabase project and deploys the
server functions. You then paste the generated secrets into Supabase > Edge Functions >
Secrets (Claude prepares the list on your computer; you copy and paste).

## Step 4: Game storage and the games server (you paste one key, Claude does the rest)

Game files live in Supabase Storage, in a private storage space called `builds` (free, no card).
Migration 0025 creates it. Free limits: about 1 GB of files and about 5 GB of downloads a month;
when a game gets popular, move to Cloudflare R2 (docs/DEPLOY.md, section 3).

1. Claude pushes migration 0025 (after your OK).
2. Supabase > Project Settings > API Keys: create a **secret key** named `games-server`.
3. Claude gives you one command; you run it and paste that key when it asks. It goes straight
   into the games server and is never written into a file.
4. Claude deploys the games server (`workers/play`). Its address looks like
   `https://bg-play.<your-name>.workers.dev`. Claude then fills it into
   `workers/play/wrangler.toml` (`SHARED_HOST`, and the three site addresses in
   `SITE_ORIGINS`) and deploys it again.

## Step 5: The three websites (you paste settings, Claude uploads)

In the GitHub repository > Settings > Secrets and variables > Actions:

**Variables** (not secret):

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | the player site address |
| `NEXT_PUBLIC_DEVELOPERS_URL` | the developer portal address |
| `NEXT_PUBLIC_MANAGE_URL` | the management portal address |
| `NEXT_PUBLIC_PLAY_ORIGIN` | the games server address |
| `BG_SHARED_GAME_ORIGIN` | `1` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable key |
| `NEXT_PUBLIC_CONTACT_EMAIL` | the official address |
| `NEXT_PUBLIC_INGAME_ADS` | `none` (until AdSense approves) |
| `CF_PAGES_PROJECT`, `CF_PAGES_PROJECT_DEVELOPERS`, `CF_PAGES_PROJECT_MANAGE` | the three names from step 2 |

**Secrets**: `CLOUDFLARE_API_TOKEN` (Cloudflare > My Profile > API Tokens > "Edit Cloudflare
Pages"), `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_SERVICE_ROLE_KEY`, `PRE_QA_CALLBACK_SECRET`,
`SUPABASE_HEALTH_URL`.

Then Claude adds the code to GitHub Desktop and you press **Publish**. GitHub builds the three
sites and puts them online; from then on, every update publishes itself.

## Step 6: Supabase settings (you, 10 minutes)

- Authentication > URL configuration: Site URL = the player site; add the three addresses
  followed by `/login/` to the redirect list.
- Authentication > Multi-Factor: turn on TOTP (the owner code).
- In the SQL editor (Claude gives you the exact lines): the edge key and the media host.

## Step 7: Lock the management portal (you, 10 minutes)

Cloudflare > Zero Trust > Access > Applications > Self-hosted: the management portal address,
allow only your and your co-founder's e-mail addresses, login method One-time PIN. Then sign
up on the live player site, make yourself admin, open the management portal and scan the
owner-code QR code with your phone.

## Step 8: Check (Claude)

Claude checks each site, plays a game, uploads a test game as a developer, approves it, and
runs the security checks against the live sites. Then a small group of people can start.

---

**Later, when you want:** a brand domain for the sites and a games domain (sealed-off games),
Razorpay payments (needs business KYC; keep international payments off), AdSense.
