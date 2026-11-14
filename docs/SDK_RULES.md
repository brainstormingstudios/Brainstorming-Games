# Brainstorming SDK rules

These are the rules every game on Brainstorming Games follows. They exist so that a game loads
fast, earns fairly, and is measured the same way as every other game. The pre-QA bot checks most
of them automatically; our reviewers check the rest.

There is one SDK: ours (`bg-sdk.js`, or `@brainstorming/sdk` from npm). It is under 6 KB.

## 1. One SDK only

- A build must not load another portal's SDK or any ad, analytics or tracking script
  (CrazyGames, Poki, GameDistribution, AdSense, Google Analytics and so on). The pre-QA bot fails
  a build that requests them.
- A build makes **no requests to other domains** at all: fonts, images, music and code ship
  inside the zip. The only exception is your own multiplayer or save server, which you declare
  when you submit.
- Do not copy `bg-sdk.js` from an old build and edit it. Load the current file, or use the npm
  package.

## 2. What you must call

| Call | Spark Launch | Rise Launch |
| --- | --- | --- |
| `BG.init()` before anything else | Recommended | Required |
| `BG.game.loadingStart()` / `loadingStop()` | Recommended | Required |
| `BG.game.gameplayStart()` / `gameplayStop()` | Recommended | Required |
| `BG.data` for saves | Optional | Required if the game saves progress |
| `BG.ad.midgame()` / `BG.ad.rewarded()` | Ignored (ads are off) | Required to earn |

A game without the SDK can run a Spark Launch, where we measure it with no ads. It cannot be
promoted to Rise Launch, because Rise is where ads and revenue start.

## 3. Loading and gameplay signals

These four calls are your numbers. Playtime, the 1-minute conversion rate and retention on your
dashboard, and your Brain Rank, are all built from them.

- `loadingStart()` when the first loading screen appears, `loadingStop()` when the player can
  act. Loading time is the gap between them.
- `gameplayStart()` whenever the player is actually playing. `gameplayStop()` on every pause,
  menu, level-complete screen, game over, and when the tab is hidden.
- Never leave gameplay "on" in a menu to inflate playtime. Sessions with gameplay running while
  the tab is hidden, or with no input for long stretches, are discarded, and repeated cases are a
  reason to end a launch.
- Call each start once per stretch of play. The SDK ignores duplicates.

## 4. Ads

The platform enforces these, so a refused call simply returns `{ shown: false, reason }`. Your
game must keep working when an ad is refused, blocked or fails.

- **Midgame ads** only at natural breaks: between levels, after a game over, before a restart.
  Never during play. At most one every 3 minutes per player, and none in the first 60 seconds.
- **Rewarded ads** only when the player chooses one, with the reward stated on the button. Give
  the reward only when the call resolves with `rewarded: true`. Never chain two.
- **Banners** only while gameplay is stopped, at most two at once, never over buttons.
- Pause the game and mute audio in `onStart`; resume in `onFinish`. Never start an ad on a click
  that the player meant for the game.
- Never tell players to click ads, never block play for players with an ad blocker, and never
  show your own ads, pop-ups or links to other sites.
- During Spark Launch every ad call returns `reason: 'spark'`. That is expected.

## 5. Saves and players

- Use `BG.data.set / get / remove` for anything worth keeping. It saves to the player's account
  when they are logged in and to the device when they are not, and moves guest saves into the
  account at login. Up to 1 MB per value.
- Do not ask for an e-mail, a password or a name. `BG.user.get()` gives you the player's public
  name and avatar; `BG.user.promptLogin()` opens our login.
- No chat with free text, no links to social networks or stores inside the game, and no
  collection of personal data. Many players are children.

## 6. Leaderboards and fairness

- Submit scores with `BG.leaderboard.submit(board, score)` when a run ends.
- Declare the highest score a player can gain per second when you set the game up. Scores that
  arrive faster than that are rejected automatically.
- Scores are tied to a play session the platform started. A score without a session is ignored.

## 7. Technical limits

- One `index.html` at the top of the zip. All paths relative. No absolute URLs to your own site.
- Up to 250 MB and 1,500 files per build. Under 20 MB and a first load under 10 seconds is what
  players stay for.
- The game runs in a sandboxed frame on a separate domain. It cannot open pop-ups, navigate the
  page around it, or read anything from the site.
- Works with keyboard and mouse on desktop, and with touch if you tick mobile or tablet. Fits any
  frame size without scrolling.
- No "Play now" or "New" badges, borders or store logos on covers: the title only.

## 8. Content

- Suitable for a general audience (PEGI 12 at most): no gambling, no real-money mechanics, no
  loot boxes bought with money, no hate, no sexual content.
- You own the game or have the right to publish it, including its art, music and fonts.

## How the rules are checked

1. **In your browser, before upload:** the zip is unpacked and checked for the entry file, size,
   file count and whether the SDK is present.
2. **Pre-QA bot:** the build is run on a desktop browser and a Pixel 7. It records every request,
   every SDK call, the time to gameplay and any crash, and fails builds that load another SDK or
   call out to other domains.
3. **Review:** a person plays the game against this list before it goes live.
4. **After launch:** the same signals keep being measured. A game that breaks a rule can be
   paused until it is fixed.
