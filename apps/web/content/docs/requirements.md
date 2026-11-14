# Requirements

## The build

- An HTML5 or WebGL build in a `.zip` with `index.html` at the root (one wrapping folder is fine).
- Relative paths only: `assets/hero.png`, never `/assets/hero.png`. Games are served from a sub-folder.
- At most 250 MB and 1,500 files. Files over 25 MB may not load on every host.
- Allowed file types: HTML, JS, CSS, JSON, images (PNG, JPG, WebP, AVIF, GIF, SVG), audio (MP3, OGG, WAV, M4A), video (MP4, WebM), fonts, WebAssembly, glTF, KTX2, Basis and engine data files (`.data`, `.unityweb`, `.pck`, `.bin`, `.br`, `.gz`).
- No executables, symbolic links or server code.

## Performance

- Gameplay must start within 20 seconds on a mid-range phone. Under 10 seconds keeps far more players.
- Keep the first download small: load later levels after `gameplayStart`.

## Content

- Suitable for ages 12 and over (PEGI 12 or equivalent).
- Your own original work, with licences for every asset.
- English text available (other languages welcome too).
- No external ads, trackers, other portals' SDKs or external logins.
- No real-money gambling, entry fees, cash prizes or paid random rewards.

## For Full Launch

- The Brainstorming SDK with `loadingStart`, `loadingStop`, `gameplayStart` and `gameplayStop`.
- If the game saves progress: save through `BG.data` so progress follows the player's account.
