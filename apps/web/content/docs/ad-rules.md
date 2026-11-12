# Ad rules

Ads in games run only through the Brainstorming SDK. The platform applies these rules for every game, so you cannot break them by accident.

| Format | Rule | Refusal reason |
|---|---|---|
| Midgame | At most one every 3 minutes per player | `cooldown` |
| Midgame | Never in the first 60 seconds of gameplay | `cooldown` |
| Rewarded | Reward only when the ad finishes, never on an error | `error` |
| Rewarded | No two in a row: gameplay must start again in between | `chained` |
| Banner | At most 2 at once | `limit` |
| Banner | Only while gameplay is stopped (they close when gameplay starts) | `gameplay-active` |
| All | No ads during a Spark Launch | `spark` |

## Good placements

- A midgame ad after a level ends, before the next one starts.
- A rewarded ad offered on the game-over screen for a second chance, or in the shop for bonus coins.
- A banner on the main menu.

## Not allowed

- Ads from any other network, or another portal's SDK, inside your build.
- Showing a rewarded ad without the player choosing it.
- Hiding the close button, or placing buttons where the ad appears.
- Blocking play when an ad blocker is detected.

## Pausing and muting

While an ad plays your game receives `BG.game.onAdStateChange({ playing: true })` and `settings.muteAudio` becomes true. Pause your loop and audio, then resume when `playing` is false again.
