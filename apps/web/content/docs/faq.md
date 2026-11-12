# FAQ

### How much does it cost?

Nothing. Publishing, the SDK, hosting and the pre-QA bot are free.

### How much do I earn?

70% of net ad revenue from our traffic, 85% from players you bring with your referral link, and 80% during an optional 60-day web-exclusive window after Rise Launch. Payouts are monthly from ₹2,000 or $25.

### Do I keep my rights?

Yes. You give us a non-exclusive licence to host and promote the game and can remove it at any time.

### Why is my Spark Launch ad-free?

So the KPIs measure the game, not the ads, and so players meet your game at its best. Ads start with Rise Launch.

### The pre-QA bot says gameplayStart never fired

Make sure you call `await BG.init()` first and `BG.game.gameplayStart()` when the player can act. If your game waits for a click on a title screen, call it after that click; the bot clicks the middle of the game once when it sees nothing happening.

### My game works locally but not in the preview

Check the pre-QA report for absolute paths (`/assets/...`). Games are served from a sub-folder, so every path must be relative.

### Can I update a live game?

Yes. Upload a new version: minor updates of Rise games that pass pre-QA go live automatically, everything else goes through a quick review. You can roll back to any approved version in one click.

### How do I see bug reports?

Players report bugs from the game page. Reports, with the context you set through `BG.game.setContext`, appear in the Feedback inbox.
