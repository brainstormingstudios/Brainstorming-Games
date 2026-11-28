# BS Originals: filling every genre

The site has 13 genres. Four already have a BS Original: Adventure (Project Homecoming), Puzzle
(Brain Pairs), Arcade (Orbit Dodge) and Word & Trivia (Sum Sprint). Nine are still empty. The plan
fills them in two batches, so every genre ends up with at least one strong game of our own.

All games are original: our own names, art, sounds and rules. The look is glowing neon art drawn by
code, punchy sound made in the browser, and touch controls built in from day one.

## Batch 1: 5 games (3 multiplayer, 2 single-player)

| # | Game | Genre | Players | In one line |
| --- | --- | --- | --- | --- |
| 1 | **Neon Rift.io** | .io | Online, up to 20 | Huge neon arena: shoot, grow your ship, steal kills, climb the live top-10 |
| 2 | **Wreck Rally** | Racing & Driving | Online, 2–6 | 3-lap races with rockets, mines and nitro; wrecking rivals beats passing them |
| 3 | **Super Over Showdown** | Sports (Made in India, 2-Player) | Online 1 v 1 | Quick cricket: bat 6 balls, then bowl 6, timing shots for sixes |
| 4 | **Last Light** | Action | Single | Survive 15 minutes against huge monster swarms; an upgrade every level, a boss every 5 minutes |
| 5 | **Kila Defense** | Strategy (Made in India) | Single | Defend an Indian fort with towers, heroes and upgrades across 30 waves |

### 1. Neon Rift.io (.io)
- Join a live arena at once: no lobby, just play.
- Shooting other ships and collecting orbs makes your ship bigger and stronger; you choose
  upgrades (fire rate, speed, shield, extra guns).
- Live top-10 board; the leader glows and is worth bonus points.
- Bots keep the arena full when few people are online.

### 2. Wreck Rally (Racing & Driving)
- 6 cars and 5 tracks: city, desert, ice, volcano, space station.
- Pick-ups: homing rocket, mine, oil slick, shield, nitro.
- Modes: Race (3 laps) and Arena wreck (last car driving).

### 3. Super Over Showdown (Sports)
- Online 1 v 1: each player bats one over and bowls one over; the higher score wins.
- Batting: pick the shot direction and time the swing. Bowling: choose the line, length, speed
  or spin.
- Teams with Indian city names, stadium crowd sounds, and a quick tournament mode against the
  computer.

### 4. Last Light (Action)
- Weapons fire on their own while you dodge through swarms; 20 weapons that evolve when combined.
- Unlock heroes and maps with coins earned in runs.
- Revive once per run with a rewarded ad (Premium players revive without the ad).

### 5. Kila Defense (Strategy)
- Build archer, cannon, fire and freeze towers on the fort walls, and upgrade each tower 3 times.
- Heroes with special powers; elephants, war chariots and flying enemies.
- 30 waves over 3 forts, with a star rating for each level.

## Batch 2: the last 4 genres

| Game | Genre | Players | In one line |
| --- | --- | --- | --- |
| **Sky Ace** | Shooting | Single | Jet fighter shoot-'em-up with bullet storms and giant bosses |
| **Carrom Clash** | Card & Board (Made in India, 2-Player) | Online 1 v 1 | Flick-and-pocket board game with online matches and friend invites |
| **Chai Tycoon** | Simulation | Single | Grow a chai stall into a city-wide café chain: staff, menu, prices |
| **Galaxy Miner** | Clicker & Idle | Single | Tap to mine planets, hire robots, keep earning while you are away |

After both batches all 13 genres have a BS Original, and the 2-Player and Made in India
collections have several.

## Same in every game
- Platform hooks: SDK progress saves, leaderboards, achievements, the Clip button, and invite
  links. Ads only between matches or levels, never in the middle of play.
- Brain Points buy only looks (skins, trails, victory poses), so nobody can pay to win.

## How the multiplayer works (free, no card)
- A small Cloudflare Worker with Durable Objects (free plan) runs the rooms and matchmaking.
- Players connect directly to each other (WebRTC), so fast games do not use up free limits. If a
  direct connection fails, the Worker passes the messages on at a lower rate. The .io arena goes
  through the Worker at a low update rate and smooths movement between updates.
- Bots fill empty seats, so a match starts within seconds.
- Kid-safe: no typed chat, only quick emotes. Names are Brainstorming usernames.
- Fair play: the host or the Worker checks moves; impossible speeds and hits are refused.

## Build order

Done: shared kit (`games/_kit/bs-kit.js`) and Last Light (`games/last-light`).

1. Shared kit (`games/_kit`): drawing, input including touch sticks, particles, sound and the
   SDK hook-up.
2. Last Light: single-player, so it proves the kit without a server.
3. Kila Defense.
4. Multiplayer Worker and Super Over Showdown: 1 v 1 turns, the easiest online game.
5. Wreck Rally.
6. Neon Rift.io.
7. Batch 2.

Each game goes live on its own through the developer portal (`npm run pack:originals`), and only
after the owner says OK.
