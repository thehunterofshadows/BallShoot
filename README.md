# BallShoot — Bubble Together

A cooperative and competitive multiplayer bubble-shooter with shared combos,
private battle boards, special bubbles, optional local bots, and live cross-device rooms.

## Playing online

Choose **Create online room**, enter a display name, and share the generated
three-digit code. Co-op rooms support two to four people; Battle rooms support
two to eight. The host chooses every lobby setting and starts the match. Co-op
players share one server-authoritative field, while Battle gives each person a
private field.

Aim with the arrow keys or the touch halves and fire; you shoot the colour you were dealt,
with the `next` preview for planning. In Co-op Clear, **PASS** swaps your loaded bubble
with the adjacent teammate to the left or right. Use the left/right PASS buttons or
controller LB/RB; on a keyboard use the player's pass key (`E`, `/`, or `I`), with Shift
for left. Online players can use `E` for right and `R` for left. Either direction reaches
the same partner in two-player play. `next` bubbles stay put, specials travel with their
bubble, and a shared 5-second cooldown follows each pass.

Setup assists, chain handoffs, team rescues and team drops fill one shared **Team Power**
meter. Three players can earn a **TRIPLE ASSIST** when two teammates set up one clear, and
three distinct clearers in one live chain earn **TRIO CHAIN**. At 100%, any teammate presses
`Q`, controller Y, or TEAM POWER for **SYNERGY BURST**: every loaded bubble turns rainbow
while shot pressure, the ceiling and any rescue countdown hold for 8 seconds. On round 35,
three or more players also meet a three-plate lock: each distinct player must land a shot
beside it to open the star. The plate colors show who has contributed.

The late set pieces add co-op board objects for two or more human players. **The Vault**
stays classic. **Chandeliers** has shielded bubbles: one player breaks the shell and a
teammate clears the exposed bubble within six seconds for a setup bonus. **The Canyon**
has linked locks: different players hit the two targets within five seconds to remove
the stone barrier. **Hive Bridge** has two-plate armor that needs hits from different
players and a dark pressure node that adds at most four blocked cells, one every four
team shots until cleared. Object completions award one team bonus and fill Team Power;
rings and plates show the current state. Solo, custom levels and Battle omit these
objects. Online object state survives reconnects. If only one player remains connected
for ten seconds, required objects allow that player to finish without a co-op bonus.

Co-op Clear plays 52 Puzzle Bobble–style rounds as a chain: clearing one carries your score
and stats into the next, pays an accuracy bonus plus a **time bonus** (the full 5,000 inside
15 seconds, sliding to nothing at two minutes), and only the last round ends the run. The
rounds are small pictures in five tiers — three colours at first, then four, five (+purple)
and six (+orange) — and later ones place **stones** (`#`, never pop, only fall), **stars**
(`*`, a shot beside one clears its whole colour) and **rainbows** (`+`, join any colour's
group). The custom level editor accepts the same characters.

Local **two-player** Co-op Clear plays on its own double-width board: one continuous 16/15
staggered field (the classic board is 11/10) with the launchers at the quarter points and no
territories — either player can shoot, bank or cut anywhere. The whole field is always on
screen at one uniform scale; the camera never follows aim, shots or drops, and only a window,
fullscreen or display change re-fits it. Rounds 1–12 are redrawn for it (Open Hands, Twin
Towers, Center Cut, Crossfire, The Bridge, Bank Exchange, Two Keys, Domino Drop, Hanging
Garden, Crossed Supports, Shared Rescue, Grand Canopy) with slower ceiling pacing for two
shooters; later rounds keep their classic pictures centred on the wide board. Solo, three-
and four-player, the Wide 4× field, Battle and online rooms keep the classic board.

Beating
the top-20 board prompts for three initials; the table lives on the game server, so it is
shared across devices and survives a restart. It is not authenticated — treat it as an
arcade cabinet, not a record.

Every few shots the field pushes down a row, and the ceiling comes with it. Each round sets
its own pace (10 shots early, down to 6 at the end), the pack shakes for the last two shots
before it goes, and the threshold tightens as the round's colours disappear from the board.
With three or four active humans, shot and miss thresholds rise moderately so additional
shooters do not push the shared board down at the two-player rate. Hosts scale it with
the **Shot pressure** slider (8 plays rounds as authored; `0` turns it off). A player who sits on a loaded launcher is told
**HURRY UP!** and then fires at whatever angle they hold; the **Hurry-up** setting is the
idle limit in seconds (default 8, `0` off). Bots and Battle boards are exempt.

**Display** (home card, pause card or settings) chooses **Auto**, **Desktop** or **TV**, and is
remembered on the device. The default browser layout paints the theme across the full
viewport with cover cropping, while its content sits inside a bounded safe area (5% of
each edge, from 24px to 80px on larger screens). Compact touch screens keep their tighter
spacing. The playfield still sizes independently of the background. TV remains an optional
couch layout on a fixed 16:9 stage: a big centred field,
score and round across the top, a large card per player in two-player co-op,
launcher-aligned names, previews and statuses with no extra panels in three-player co-op,
and bigger, controller-friendly menus, with critical UI inside a 5% overscan-safe margin. Wide (pillarbox)
and tall (letterbox) viewports bleed the theme art into extra space outside the stage rather
than showing flat colour bars. Forced TV enforces a 960×540 minimum viewport (stage scale 0.5)
to guarantee HUD legibility; smaller windows show a prompt with Fullscreen and Use Desktop
actions and pause offline play without resetting match state. Auto mode includes hysteresis
(staying TV within aspect 1.2–3.6) to avoid flip jitter, and TV↔Desktop switches during an
active offline match lock gameplay geometry (`H`, danger line) so resizing never alters play.
Use **Play fullscreen** for the full effect; leaving fullscreen keeps TV mode. Gamepads work in every
display mode: stick or d-pad aims, A fires, LB passes left, RB or X passes right,
Y fires Team Power, Start pauses, Back opens settings, and in menus the stick moves focus, A presses and B backs out. Auto chooses TV
for a large widescreen with a gamepad connected.

In TV mode every menu works from the couch: the d-pad or stick moves focus to the nearest
control in that direction (up / down wrap), each screen opens on a sensible default, **A**
confirms and **B** always goes back one step (cancel, close, resume) — the keyboard mirrors
it with the arrow keys, Enter and Escape — and a button legend runs along the bottom. Room
codes and high-score initials can be entered arcade-style (up / down picks a character).
Controllers keep their player slot; if one disconnects its launcher stops turning and local
play pauses until it is back. **Screen Fit…** (home, pause or settings) calibrates overscan:
move all edges or each edge in or out until the four corner marks are visible, then Save
(Reset returns to the 5% default). It is saved on the device and every score, name, prompt
and menu stays inside it; the background still fills the screen and the field only scales.
Check the default safe area and TV layout with `docker compose run --rm --no-deps screens node scripts/safe-area-probe.mjs`,
`docker compose run --rm --no-deps screens node scripts/tv-probe.mjs`, and
`docker compose run --rm --no-deps screens node scripts/trio-probe.mjs`.

In Battle, clearing six or more bubbles charges a junk attack. Pick a living
opponent within six seconds or the server chooses one automatically. Empty fields
refill with a score bonus, eliminated players spectate, and the last player alive
wins. Unexpected disconnects leave a board alive and idle for reconnection;
choosing **Leave** forfeits that board immediately.

Online rooms are deliberately ephemeral. A refresh or short network interruption
reclaims the same launcher automatically, but rebuilding or restarting the game
server closes active rooms. Room codes are invitations, not passwords.

## Automated GitHub Watcher

An external watcher polls this repository's GitHub Issues. New issues enter
`0_intake` automatically and move through questions, design, approved development,
and Dev completion. Humans use `/design`, `/answered`, `/dev`, `/done`, `/block`,
`/review`, and `/reset-intake` in issue comments. The reserved workflow labels are
`0_intake`, `1_questions`, `2_design`, `3_development`, `4_dev_done`,
`human_review`, `blocked`, `dev_active`, and `z_quota_reached`.

Approved work is committed directly to `dev` as
`fix: implement issue #N [agent]`; run `git pull origin dev` to sync. Promotion to
`main` and production is human-gated through `promote.sh`.

## Environments

- Dev: `https://dev-ballshoot.fireorbooty.com` from the repository root on `dev`
- Prod: `https://ballshoot.fireorbooty.com` from
  `/home/justin/run/BallShoot-prod` on `main`

Everything builds, runs, and validates in Docker. The browser app is served by
Nginx over internal HTTP port 80; Cloudflare provides public HTTPS through the
shared host tunnel.

## Commands

```bash
./setup.sh
./rebuild.sh
docker compose run --rm --no-deps test
docker compose run --rm --no-deps screens  # device-shape screenshots -> ./screenshots
./promote.sh --dry-run
./promote.sh --confirm  # only after explicit human approval
```

`setup.sh` creates the Prod worktree and starts isolated Dev and Prod Compose
projects. `rebuild.sh` validates first and refuses to rebuild on failure.
`screens` renders the game at nine device shapes — including Galaxy Z Fold cover and
inner panels, a Flip cover panel, and phone landscape — and fails on horizontal
overflow. It needs network egress because `support.js` boots React from a CDN.
`docker compose run --rm --no-deps screens node scripts/theme-probe.mjs` renders the
fantasy-arcade cabinet (2/3/4 players, wide, 1560-tall, battle, danger, TV and a run with
every theme image blocked) to `./screenshots/theme` and fails if any of the seven
`assets/theme/` images is not loaded or the two-socket deck lands on the wrong layout.

### Responsiveness and diagnostics

Every presented frame reads the freshest input (controllers are polled in the frame), steps
the simulation, renders the newest state and only then updates DOM HUD pieces. Rendering
follows the browser's `requestAnimationFrame` cadence with no 60 FPS cap; the simulation
runs in equal steps of at most 1/120 s, so gameplay speed is the same at 60, 120 or 144 Hz.
Add `?perf` to the URL (or press **F9**) for a diagnostics overlay: presented FPS and the
refresh it matches, frame time, input → render, simulation time and step rate, and render
time. `?sim=240` changes the simulation step bound for comparison.
`docker compose run --rm --no-deps screens node scripts/refresh-probe.mjs` drives the game
loop at 60, 120 and 144 Hz and checks the gameplay clock, aim and shot travel match.

## Source layout

- `index.html` — document shell
- `coop-bubbles.js` — game component, local simulation, online client, input, and rendering
- `server/game.js` — authoritative bubble-board simulation
- `server/battle.js` — private-board battle orchestration, attacks, and placements
- `server/lobbies.js` — room membership, settings, reconnect, and host lifecycle
- `server/scores.js` — leaderboard buckets, validation, and JSON-file persistence
- `server/server.js` — HTTP health endpoint and WebSocket protocol adapter
- `support.js` — generated browser runtime
- `thumbnail.webp` — original preview image

Nginx serves the browser app and proxies same-origin `/ws` and `/scores` requests to the
`gameserver` service over their shared network namespace. Only Nginx has an
address on the external `edge` network; the game server listens on loopback with
no published ports.
