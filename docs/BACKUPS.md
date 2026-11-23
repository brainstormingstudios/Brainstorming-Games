# Backups

**What:** every night at about 03:10 India time, GitHub Actions (`.github/workflows/backup.yml`)
dumps the database: game, player and studio data (`public`), sign-in accounts (`auth`) and the
list of stored files (`storage`). The dump is encrypted with AES-256 (PBKDF2, 600,000 rounds)
using a passphrase only the owners hold, and kept for 30 days as a private workflow artifact.

**Not in the backup:** the files themselves (game builds in the `builds` bucket, covers and videos
in `media`). They are write-once and can be uploaded again from the developers' zips; a copy of
the BS Originals is in this repository (`games/`).

## Set up (once)

1. Choose a backup passphrase of at least 20 characters. Store it in your password manager **and**
   give a sealed copy to your co-founder. Without it the backups cannot be opened.
2. GitHub > repository > Settings > Secrets and variables > Actions > New repository secret:
   - `BACKUP_PASSPHRASE`: the passphrase.
   - `SUPABASE_DB_URL`: Supabase > Connect > **Session pooler** > URI, with your database
     password filled in (`postgresql://postgres.<project>:<password>@...pooler.supabase.com:5432/postgres`).
3. Actions > Nightly backup > Run workflow, and check that it ends green.

## Restore

1. Actions > Nightly backup > the run you want > Artifacts: download `db-backup-<date>`.
2. Check the file is complete: `sha256sum -c brainstorming-db-<date>.sha256`.
3. Decrypt (asks for the passphrase):
   `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in brainstorming-db-<date>.dump.enc -out db.dump`
4. Restore into a **new** Supabase project first and check it, then switch the sites over
   (docs/DEPLOY.md), or restore single tables with `pg_restore --data-only --table=<name>`:
   `pg_restore --no-owner --no-privileges --dbname "<new project's connection string>" db.dump`
5. Delete `db.dump` afterwards: it is the unencrypted database.

Test a restore once a quarter, so you know it works before you need it.
