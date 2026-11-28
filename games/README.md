# BS Originals

Games made by Brainstorming Studios. Each folder is a complete web build that loads the
Brainstorming SDK from its own folder (`bg-sdk.js`, added when the game is served or packed).

| Folder | Game |
| --- | --- |
| `project-homecoming` | Project Homecoming, a 3D space adventure (Three.js) |
| `brain-pairs` | Brain Pairs, a memory game |
| `orbit-dodge` | Orbit Dodge, a one-button arcade game |
| `sum-sprint` | Sum Sprint, 60 seconds of quick sums |
| `neon-rift` | Neon Rift.io, an online arena shooter (BS Kit + `workers/rooms`) |

`_kit/bs-kit.js` is **BS Kit**, the shared toolkit of the newer originals: drawing, game loop,
keyboard and touch input, particles, sounds made in the browser and a safe SDK wrapper. A game
that loads `bs-kit.js` gets its own copy when it is served or packed.

Open a kit game with `?debug=1` to see the frame rate. In the browser console, `__auto = true`
makes the computer play, `__god = true` stops damage, and `__ll.step(60)` fast-forwards a minute.

`originals.json` describes them. On a developer machine `npm run dev` serves them from the local
play origin and adds them to an empty catalogue. For the live site, run `npm run pack:originals`
and upload each zip from `.local/originals` through the developer portal with the first-party
studio account.
