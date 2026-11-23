# Changing a key (key rotation)

Change a key at once if it may have leaked (pasted in a chat, a screenshot, a public place, a
lost laptop), when someone with access leaves, and otherwise once a year. **The founders type all
secrets themselves**; never paste one into a chat or a file in the repository.

| Key | Where it lives | How to change it |
| --- | --- | --- |
| Database password | Supabase | Project Settings > Database > Reset password. Then update the `SUPABASE_DB_URL` GitHub secret (docs/BACKUPS.md). |
| Supabase secret keys (`games-server`, `github-build`) | Supabase > Project Settings > API Keys | Create a new secret key, put it where the old one was used (games server: `npx wrangler secret put SUPABASE_STORAGE_KEY --config workers/play/wrangler.toml`; GitHub: `SUPABASE_SERVICE_ROLE_KEY`), check the site works, then delete the old key. |
| Publishable key | Supabase, GitHub variable `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Create a new one, update the variable, run Actions > Deploy, then delete the old one. It is public by design; rotate only if Supabase advises. |
| `CLOUDFLARE_API_TOKEN` | GitHub secret | Cloudflare > My Profile > API Tokens: roll the token (same permission: Account / Cloudflare Pages / Edit), paste the new value into GitHub. |
| `GITHUB_DISPATCH_TOKEN` | Supabase Edge Function secret | GitHub > Settings > Developer settings > Fine-grained tokens: regenerate (it also expires; renew before then), paste into Supabase > Edge Functions > Secrets. |
| `PRE_QA_CALLBACK_SECRET` | Supabase secret **and** GitHub secret | Make a new random value (for example a password manager's 40-character password), set it in both places within a few minutes. |
| `CRON_SECRET` | Supabase secret **and** GitHub secret | Same as above. |
| `BG_EDGE_KEY` | Supabase secret **and** the database | New random value in Supabase, then in the SQL editor: `select app.set_secret('edge_key', '<new value>');` |
| `MAIL_OUTBOX_SECRET`, `MAIL_WEBHOOK_SECRET` | Supabase secrets | New random values; update the mail sender's settings to match (docs/EMAIL.md). |
| `GAME_JWT_PRIVATE_JWK` | Supabase secret, public half as GitHub variable `GAME_JWT_PUBLIC_JWK` | `node scripts/gen-game-jwk.mjs`, set the private key in Supabase and the public key in GitHub, run Actions > Deploy. Players may need to reopen a game. |
| `PAYOUT_ENCRYPTION_KEY` | Supabase secret | **Do not just replace it**: saved payout details are encrypted with it. Rotation needs re-encrypting them; ask before doing this. |
| `BACKUP_PASSPHRASE` | GitHub secret, founders' password managers | Set a new one; older backups still need the old passphrase, so keep it until they expire (30 days). |
| Owner code (phone) | Each admin's authenticator app | Lost phone: Supabase > Authentication > Users > the admin > remove their MFA factor; next time they open the management portal it shows a new QR code to scan. |

After any change: Actions > Live security check > Run workflow, and open the three sites.
