# Brainstorming Games SDK

The SDK connects an HTML5 game to Brainstorming Games: loading and gameplay signals (your KPIs), ads with the rules handled for you, player accounts, cloud saves, leaderboards, quests and party invites. It is under 6 KB gzipped and has no dependencies.

## Install

Script tag (recommended):

```html
<script src="https://brainstorming.games/sdk/v1/bg-sdk.js"></script>
```

Use the site you publish on as the host. During local development the same file is served by `npm run dev` at `http://localhost:3000/sdk/v1/bg-sdk.js`.

Or from npm, in a bundled game:

```bash
npm install @brainstorming/sdk
```

```ts
import BG from '@brainstorming/sdk';
```

## The minimum integration

```js
await BG.init();

BG.game.loadingStart();
await loadEverything();
BG.game.loadingStop();

// When the player can act:
BG.game.gameplayStart();

// On pause menus, level end, game over:
BG.game.gameplayStop();
```

`gameplayStart` and `gameplayStop` are what turn time on the page into real playtime. They are required for Full Launch.

## Environments

| `BG.environment` | Where | What happens |
|---|---|---|
| `brainstorming` | Inside the Brainstorming Games player | Calls go to the page around your game |
| `local` | `localhost`, `127.0.0.1`, `*.local` | Mock ads with the real rules, saves in localStorage, a debug overlay listing every call |
| `disabled` | Anywhere else | Every method resolves safely; the SDK warns once in the console |

You never need to branch on the environment: the same code runs everywhere.

## Ads

```js
// Between levels. Pause and mute in onStart, resume in onFinish.
const { shown } = await BG.ad.midgame({
  onStart: () => game.pause(),
  onFinish: () => game.resume(),
});

// A reward the player asked for.
const { rewarded } = await BG.ad.rewarded({ onStart: () => game.pause() });
if (rewarded) giveExtraLife();
game.resume();
```

The platform enforces the rules, so a refused call resolves quickly with `{ shown: false, reason }`:

- **Midgame**: at most one every 3 minutes per player, never in the first 60 seconds of gameplay (`reason: 'cooldown'`).
- **Rewarded**: the reward is granted only when the ad finishes, never on an error. Two in a row are refused (`reason: 'chained'`); gameplay has to start again in between.
- **Banners**: at most 2 at once, only while gameplay is stopped (`BG.ad.showBanner({ containerId, size })`).
- **Basic Launch**: every ad call returns `{ shown: false, reason: 'spark' }`.

`BG.game.onAdStateChange(({ playing }) => …)` tells you when an ad starts and ends, and `BG.game.settings.muteAudio` turns true while one plays. `BG.ad.hasAdblock()` reports an ad blocker. Never block play because of it.

## Players and saves

```js
const user = await BG.user.get(); // { id, username, avatarUrl } or null for guests

await BG.data.set('progress', { level: 4, coins: 120 });
const progress = await BG.data.get('progress');
```

Saves go to the cloud for signed-in players and to the device for guests. Guest saves move into the account when the player logs in. Each value can be up to 1 MB.

`BG.user.promptLogin()` opens the login dialog. `BG.user.onAuthChange(cb)` fires when a player logs in or out.

### Verifying players on your own server

`await BG.user.getToken()` returns a short-lived JWT (one hour) signed with ES256:

```json
{ "sub": "<player id>", "gameId": "<your game id>", "iat": 1731400000, "exp": 1731403600, "iss": "brainstorming-games" }
```

Verify it with the public keys at `https://brainstorming.games/.well-known/bg-game-jwks.json`. In Node:

```js
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL('https://brainstorming.games/.well-known/bg-game-jwks.json'));

export async function verifyPlayer(token, gameId) {
  const { payload } = await jwtVerify(token, jwks, { issuer: 'brainstorming-games', algorithms: ['ES256'] });
  if (payload.gameId !== gameId) throw new Error('token is for another game');
  return payload.sub; // the player id
}
```

Always check `gameId`, and never trust a player id sent without a token.

## Leaderboards

```js
await BG.leaderboard.submit('main', score);
const { entries, me } = await BG.leaderboard.top('main', { limit: 10 });
```

Scores are validated on the server: a score must belong to a play session the player started, and it cannot be higher than your declared maximum score per second multiplied by the session length (set it in the game wizard). Outliers are flagged for review.

## Celebrations, context and invites

```js
BG.game.celebrate();                       // the mascot pops in with confetti
BG.game.reportProgress(60);                // 0 to 100
BG.game.setContext({ level: 7, seed });    // attached to player bug reports

const link = BG.game.inviteLink({ room: 'abc' });
const room = BG.game.getInviteParam('room');
BG.game.updateRoom({ roomId: 'abc', isJoinable: true, inviteParams: { room: 'abc' } });

BG.quests.track('boss_defeated');          // counts towards cross-game quests
```

## Settings

`BG.game.settings` is `{ muteAudio, disableChat, lowData, schoolSafe }`. Respect them: hide chat when `disableChat` is true, prefer smaller assets when `lowData` is true. `BG.game.onSettingsChange(cb)` tells you when they change.

## The rules

What a game must and must not do with the SDK is in [SDK_RULES.md](SDK_RULES.md): one SDK only, the signals every game sends, the ad rules, saves, fairness and the technical limits.

## Testing your integration

1. Run your game on `localhost`: the debug overlay lists every call and mock ads appear.
2. Upload a build in the developer portal. The pre-QA bot loads it on desktop and on a Pixel 7 and reports which events fired and how long gameplay took to start.
3. Open the private preview link: every SDK call is listed live beside the game.
