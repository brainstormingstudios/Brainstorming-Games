# If something goes wrong (incident plan)

For a hacked account, leaked key, data leak, defaced site, malware in a game, or the site down.
Keep this short list where both founders can reach it without the site.

## First hour: contain

1. **Write down the time** you noticed and what you saw (screenshots). Keep notes as you go.
2. **Stop the damage:**
   - A bad game: management portal > Games > pause it (or reject the version).
   - A bad account: management portal > Moderation > ban; for staff accounts, remove the admin
     role in the SQL editor: `update public.profiles set role = 'player' where username = '…';`
   - A leaked key: change it now (docs/KEY-ROTATION.md). Assume anything it could reach was read.
   - Someone in the database: Supabase > Project Settings > Database > reset the database password,
     then rotate the secret keys.
   - The whole site: Cloudflare > Workers & Pages > each project > Deployments > roll back to the
     last good deployment.
3. **Keep evidence:** do not delete logs. Supabase > Logs (database, auth, functions) and
   management portal > Security alerts and Audit log. Export what is relevant.

## Within 6 hours: report to CERT-In (India)

Cyber security incidents such as unauthorised access, data breaches, malicious code, defacement
and attacks on servers or applications must be reported to **CERT-In within 6 hours** of noticing
them: e-mail incident@cert-in.org.in (form and details on cert-in.org.in). Send what you know;
you can add details later.

## Personal data breach (DPDP Act, 2023)

If players' personal data (e-mail addresses, names, payout details) may have been seen or taken:
inform the **Data Protection Board of India** and **every affected person** without delay, with
what happened, what data, what we are doing and what they should do (for example change their
password). A full report to the Board follows within 72 hours. Use the e-mail outbox for the
notice to players; keep a copy of everything sent.

## Afterwards

- Fix the cause, then check with `node scripts/monitor-live.mjs` (or Actions > Live security check).
- Write a short note: what happened, when, what we changed. Keep it with the incident notes.
- If payments were involved, tell Razorpay. If Google ads were involved, tell AdSense.

## Contacts

- CERT-In: incident@cert-in.org.in · cert-in.org.in
- Supabase support: supabase.com/dashboard/support
- Cloudflare: dash.cloudflare.com > Support
- GitHub: support.github.com
