# Star Catcher: the Brainstorming Games starter kit

A complete little HTML5 game that already does everything Brainstorming Games asks for. Change
the art and the rules, keep the SDK calls, and your first game can be live in a day.

## Try it

1. Unzip this folder.
2. Open a terminal in it and start any local web server, for example `npx serve .` or
   `python -m http.server 8080`.
3. Open the address it shows (for example http://localhost:8080). On `localhost` the SDK runs in
   local mode: test ads, saves in the browser, and a small debug panel.

Opening `index.html` straight from the folder (file://) also works, but browsers limit some
features there, so a local server is better.

## What it shows

| What | Where in `game.js` |
|---|---|
| Start the SDK first | `BG.init()` at the bottom |
| Loading time | `BG.game.loadingStart()` / `loadingStop()` |
| Playtime and ad timing | `BG.game.gameplayStart()` / `gameplayStop()` |
| Cloud saves (signed-in players) | `BG.data.get` / `BG.data.set` |
| Leaderboard | `BG.leaderboard.submit('main', score)` |
| Break ad between rounds | `BG.ad.midgame()` |
| Rewarded ad, only rewarded when finished | `BG.ad.rewarded()` |
| Celebration | `BG.game.celebrate()` |
| Clips | The game draws on one canvas, so the Clip button can record it |

Search for `SDK:` to find every call.

## Make it yours

- Replace `draw()` with your art and `update()` with your rules.
- Keep `gameplayStart()` when play begins and `gameplayStop()` on menus and game over.
- Keep every file path relative (`img/hero.png`, not `/img/hero.png`).
- Keep the first download small: load later levels after `gameplayStart()`.

## Publish

1. Zip the folder (with `index.html` at the top of the zip).
2. In the developer portal, choose **New game**, fill in the four steps and drop the zip in step 4.
3. The automatic checks run in about a minute; a person reviews your game within 72 hours.

Read the SDK rules in the developer docs before you change the ad calls.
