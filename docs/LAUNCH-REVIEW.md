# Brainstorming Games: launch review

Written 27 November 2026 for the full launch update. Three parts: the security check, a simulated
100 customers, and a five-shark pitch. The customer and shark parts are **a thought experiment
built from our real prices and features, not survey data**. Treat every number in them as a
guess to test, not a fact.

---

## 1. Security check ("break the bars")

| Check | Result | How it is kept true |
| --- | --- | --- |
| Row-level security on every table | **Pass.** All tables in `public` have it on. | `tests/db/security-audit.test.ts` fails the build if a table without it appears. |
| Secret keys only on the server | **Pass.** The three built sites contain only the public key. The service key lives in Supabase and the Worker secrets. | CI: gitleaks on every push; the audit above. |
| Every request checks the data belongs to the caller (no ID tampering) | **Pass.** Every database function a browser can call checks the caller (account, studio ownership, staff with owner code, a hashed secret link, or a rate limit). Nine public read-only ones (search, rising games, username free?, etc.) were reviewed by hand. | The audit test lists any new unchecked function, so it must be reviewed before it ships. |
| Limits on sign-in attempts | **Pass.** There are no passwords to guess: sign-in is Google or a one-time e-mail link, behind Cloudflare Turnstile, with Supabase's own rate limits. The admin owner code (TOTP) is rate-limited by Supabase. The cross-site hand-over code is single-use, lives 60 seconds, and is limited to 20 an hour per account. | Supabase Auth settings; migration 0030. |
| Known holes in packages | **Pass.** `npm audit` finds 0 in what the live site uses. | CI security job, Dependabot. |

Still worth doing later (needs money or a domain): a custom domain so the three sites share one
sign-in natively, and a paid penetration test once there is revenue.

---

## 2. A hundred customers

Prices used: Premium Lite ₹49, Plus ₹99, Max ₹179 a month. Boost ₹499 / ₹1,499 / ₹3,999. Verified
tick ₹49 a month or ₹399 a year. First developers are free.

### Who they are (100 people who find the site in month one)

| Group | Of 100 | Budget | What they do |
| --- | --- | --- | --- |
| School and college students playing in breaks | 48 | ₹0, maybe ₹49 with pocket money | Play free. **2** try Lite, mostly to skip ad breaks. |
| Casual adult players (commute, office) | 22 | ₹50 to ₹150 a month on apps | Play free with ads. **3** buy Plus (no site ads, rewards without ads). **1** buys Max. |
| Hardcore players who chase quests and the Locker | 8 | ₹100 to ₹300 | **2** buy Max for double points and guest passes; they bring friends. |
| Indie developers (students, solo devs) | 12 | ₹0 to ₹500 one-off | Upload because it is free and the preview step is easy. **1** buys a ₹499 Spotlight. **2** buy Verified (₹49). |
| Small studios | 3 | ₹1,500 to ₹5,000 per launch | **1** buys a ₹1,499 Push for a launch. |
| Parents and teachers | 5 | ₹0 | Use school-safe mode. Their trust drives word of mouth, not money. |
| YouTube and Instagram creators | 2 | Want to earn, not pay | Join the creator programme; bring traffic. |

### What that month earns (simulated)

| Source | Count | Money |
| --- | --- | --- |
| Lite | 2 × ₹49 | ₹98 |
| Plus | 3 × ₹99 | ₹297 |
| Max | 3 × ₹179 | ₹537 |
| Boost | ₹499 + ₹1,499 | ₹1,998 |
| Verified | 2 × ₹49 | ₹98 |
| Ads (house promo now, so ₹0 until a network is approved) | | ₹0 |
| **Total** | | **about ₹3,000 per 100 visitors** |

**What this says:** 8 in 100 players pay something, which is high for a games portal; plan for 1 to 3 in 100.
Developers (Boost) bring in more than players. The real money at scale is ads, which needs an
approved ad network and a lot more traffic.

### Business checklist

- [ ] Get an ad network approved (AdSense H5 games ads first); our promo already fills the breaks.
- [ ] Payments: switch on Razorpay when ready (paused for now on purpose).
- [ ] 20 good games before marketing: the first visit decides whether players come back.
- [ ] Measure return visits (day 1 and day 7), not just plays.
- [ ] One YouTube Short a day from the channel, each linking to one game.
- [ ] Sign up 10 college game-dev clubs as first developers (free, Verified tick as a thank-you).
- [ ] A custom domain (about ₹800 a year) for trust and one shared sign-in.
- [ ] Register the mascot trademark (in progress) and the name.
- [ ] GST registration once income nears the threshold; keep every payment record (already stored).
- [ ] Monthly look at: players, return rate, paying share, Boost sales, cost of servers.

---

## 3. Shark Tank: five sharks, no mercy

**The pitch:** "Brainstorming Games is a free, fast browser-game portal made in India. Players get
quests, a mascot to dress up and no install; developers upload for free and keep most of the money;
we earn from ads, Premium and paid promotion."

### Shark 1: "Who will pay?"
*"Indian players don't pay for browser games. CrazyGames and Poki are free with no plan at all. Why
would anyone give you ₹99?"*

**Answer:** Most won't, and the plan doesn't need them to. Ads pay for players; Premium is for the
few who hate ad breaks; developers pay for reach.

**Verdict: out** until real numbers show people paying.
**Fix checklist:**
- [ ] Show 3 months of data: paying share, cancellations, which plan sells.
- [ ] Try a yearly plan at a discount.
- [ ] Give 3 days of Plus free from Brain Points so people try it before paying (the swap exists; promote it).

### Shark 2: "Where will customers come from, and at what cost?"
*"You have no ad budget. How do 100,000 players find you?"*

**Answer:** The Brainstorming Studios YouTube channel, Shorts of each game, creators who earn a share,
and developers who share their own game links.

**Verdict: interested, but wants proof.**
**Fix checklist:**
- [ ] Track where every visitor came from (the referral and creator links already record it).
- [ ] Spend ₹0 until one channel brings players for under ₹2 each in time and effort.
- [ ] Ask every developer to post their game's link; give a free Boost to the one who brings the most players.

### Shark 3: "The numbers and profit"
*"What do you earn per thousand players, and what do servers cost you?"*

**Answer:** Servers are free today (Cloudflare and Supabase free plans). From the simulation, about
₹30 per player-month in early days, falling as most new players are free. Ads should add the most once approved.

**Verdict: out.** "Free servers don't last. Show me the cost at 100,000 players."
**Fix checklist:**
- [ ] Work out the cost at 10k, 100k and 1M players per month (Supabase Pro is about $25 a month; games are served by Cloudflare).
- [ ] Watch earnings per 1,000 plays once ads run.
- [ ] Keep developer payouts as a share of real revenue only (already the rule).

### Shark 4: "Competition"
*"Poki, CrazyGames and Google's own games are huge. Why won't they crush you?"*

**Answer:** We are built for India: Hindi, rupee prices, school-safe mode, low-data mode, a mascot
and quests, and a home for Indian developers that the big portals ignore.

**Verdict: in, if the India angle is real.**
**Fix checklist:**
- [ ] Finish Hindi across the whole site (some pages are English only).
- [ ] Commission or feature 5 games with Indian themes (cricket, festivals, local puzzles).
- [ ] Pitch schools and parents on school-safe mode.

### Shark 5: "Can it scale?"
*"What breaks at a million players?"*

**Answer:** The sites are static files on Cloudflare, so pages scale. Games are served by a
Cloudflare Worker. The database is the limit: event counting and today's numbers refresh every 5 minutes.

**Verdict: in, with conditions.**
**Fix checklist:**
- [ ] Load-test 1,000 players at once before any big push.
- [ ] Move to Supabase Pro once events near the free limit.
- [ ] Keep the nightly encrypted backups (running) and practise one restore.

### Final tally
Two sharks in (Competition, Scale), one interested (Customers), two out (Who pays, Numbers).
The common message: **the product is ready; the proof is not.** Spend the next 90 days collecting
real numbers: players, return rate, paying share and cost.
