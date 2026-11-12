# Porting from CrazyGames

If your game already uses the CrazyGames SDK v3, the shim maps its calls onto ours.

## Steps

1. Remove the CrazyGames script tag.
2. Add, in this order:

```html
<script src="https://brainstorming.games/sdk/v1/bg-sdk.js"></script>
<script src="https://brainstorming.games/sdk/v1/bg-crazygames-shim.js"></script>
```

3. Keep calling `window.CrazyGames.SDK.init()` and the rest as before.
4. Upload the build and check the pre-QA report: loading and gameplay events should show up.

## What maps to what

| CrazyGames SDK | Brainstorming SDK |
|---|---|
| `SDK.init()` | `BG.init()` |
| `SDK.environment` (`crazygames`) | `BG.environment` (`brainstorming`) |
| `SDK.game.loadingStart()` / `loadingStop()` | `BG.game.loadingStart()` / `loadingStop()` |
| `SDK.game.gameplayStart()` / `gameplayStop()` | `BG.game.gameplayStart()` / `gameplayStop()` |
| `SDK.game.happytime()` | `BG.game.celebrate()` |
| `SDK.game.inviteLink(params)` | `BG.game.inviteLink(params)` |
| `SDK.game.getInviteParam(name)` | `BG.game.getInviteParam(name)` |
| `SDK.game.updateRoom(room)` | `BG.game.updateRoom(room)` |
| `SDK.game.settings` | `BG.game.settings` |
| `SDK.ad.requestAd('midgame', callbacks)` | `BG.ad.midgame({ onStart, onFinish })` |
| `SDK.ad.requestAd('rewarded', callbacks)` | `BG.ad.rewarded({ onStart })` |
| `SDK.ad.hasAdblock()` | `BG.ad.hasAdblock()` |
| `SDK.banner.requestBanner(banner)` | `BG.ad.showBanner({ containerId, size })` |
| `SDK.banner.clearBanner(id)` | `BG.ad.hideBanner(id)` |
| `SDK.user.getUser()` | `BG.user.get()` |
| `SDK.user.getUserToken()` | `BG.user.getToken()` |
| `SDK.user.showAuthPrompt()` | `BG.user.promptLogin()` |
| `SDK.user.addAuthListener(cb)` | `BG.user.onAuthChange(cb)` |
| `SDK.data.getItem / setItem / removeItem` | `BG.data.get / set / remove` |

## Differences to know

- User tokens are verified with our public keys (see the quick start), not CrazyGames' keys.
- The ad rules are ours: a midgame call inside the 3-minute cooldown resolves at once with `reason: 'cooldown'`, which the shim reports through `adError`.
- Instant multiplayer is not available; use invite links and party rooms instead.
- `data.clear()` is a no-op. Remove keys one by one.
