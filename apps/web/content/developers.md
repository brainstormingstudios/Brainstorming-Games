# Why publish here

- **A published revenue share.** The table below is the deal for everyone. No private negotiations.
- **A fair first launch.** Every game gets guaranteed players in a Basic Launch, and you see exactly how it performed.
- **Payouts that suit small studios.** A low threshold, monthly payments and Indian bank transfers alongside PayPal, Wise and Payoneer.
- **Players come back.** Cross-game quests, streaks and party rooms bring people back to the site and into your game.

# Revenue share

| Source | Developer share |
|---|---|
| Ads, players from our traffic | 70% of net |
| Ads, players the developer brings through their referral link (`?ref=studioSlug`) | 85% of net |
| Ads during a 60-day web-exclusive window after Full Launch | 80% of net |
| In-game purchases (later) | 75% of net after payment fees |

Net = ad revenue we receive, minus refunds and invalid traffic. Payouts are monthly, about 45 days after month end, with a threshold of ₹2,000 / $25 (smaller amounts roll over). Methods: Indian bank (NEFT/IMPS), PayPal, Wise, Payoneer.

# Launch tiers

1. **Sandbox.** Upload a build and test it on a private preview link with the SDK debug overlay. Our pre-QA bot checks load time, console errors and SDK events within minutes.
2. **Basic Launch.** After a human review, your game goes to a limited audience with ads off. It gets a place in the "Fresh games" rail and 1 in 10 homepage slots. The launch ends at 7 days and 1,000 plays, or at 14 days.
3. **Full Launch.** Games that players enjoy are invited to a full launch: ads on, revenue share on. Full Launch needs the SDK with `gameplayStart`, and account linking if your game saves progress.
4. **Featured.** Editorial picks for the homepage hero.

When a Basic Launch ends you always get an answer: a Full Launch invitation, or a written reason naming the number that fell short and how to improve it.

# What we measure

| KPI | Great looks like |
|---|---|
| Conversion (plays that reach 1 minute) | 80% or more |
| Day-1 retention | 10% to 15% |
| Average session | 10 minutes or more |

You see these for your own games, with a percentile against games in the same category.

# The SDK

One small script (under 15 KB) gives your game:

- gameplay and loading events that power your KPIs;
- midgame, rewarded and banner ads with the rules handled for you;
- player accounts, cloud saves and a signed token for your own server;
- leaderboards, quests and party invites.

There is one SDK to learn, ours, and one short list of rules. Both are in the developer docs.

# Requirements

- HTML5 or WebGL build, `index.html` at the root, relative paths only.
- At most 250 MB and 1,500 files.
- Reaches gameplay within 20 seconds.
- Suitable for ages 12 and over, original work, no external ads or logins.
- Covers at 1920×1080, 800×1200 and 800×800 with title text only.

# FAQ

## Does it cost anything?

No. Publishing is free.

## Do I keep the rights to my game?

Yes. You give us a non-exclusive licence to host and promote it, and you can remove it at any time.

## Can I publish elsewhere too?

Yes. Exclusivity is optional: choose the 60-day web-exclusive window and your share rises to 80% for that period.

## Do I need the SDK for a Basic Launch?

No, but we recommend it. Without it we can only measure time on the page. Full Launch requires it.

## Which engines work?

Anything that exports to the web: Unity WebGL, Godot, Construct, Phaser, PlayCanvas, GameMaker, Defold, Cocos or plain JavaScript.

## How long does review take?

The pre-QA bot answers in minutes. Human review of a first version usually takes a few working days.
