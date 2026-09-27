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
with the `next` preview for planning. In two-player Co-op Clear either player can **PASS**
(`E`, or the PASS button) to swap both players' loaded bubbles — `next` bubbles stay put,
specials travel with their bubble, and a shared 5-second cooldown follows each pass.
Teamwork there also fills a shared **Team Power** meter (setup assists, chain handoffs, team
rescues and team drops — solo-style clears add nothing). At 100% either player presses `Q`
or the TEAM POWER button for **SYNERGY BURST**: both loaded bubbles turn rainbow and shot
pressure, the ceiling and any rescue countdown hold for 8 seconds.

Co-op Clear plays 52 Puzzle Bobble–style rounds as a chain: clearing one carries your score
and stats into the next, pays an accuracy bonus plus a **time bonus** (the full 5,000 inside
15 seconds, sliding to nothing at two minutes), and only the last round ends the run. The
rounds are small pictures in five tiers — three colours at first, then four, five (+purple)
and six (+orange) — and later ones place **stones** (`#`, never pop, only fall), **stars**
(`*`, a shot beside one clears its whole colour) and **rainbows** (`+`, join any colour's
group). The custom level editor accepts the same characters. Beating
the top-20 board prompts for three initials; the table lives on the game server, so it is
shared across devices and survives a restart. It is not authenticated — treat it as an
arcade cabinet, not a record.

Every few shots the field pushes down a row, and the ceiling comes with it. Each round sets
its own pace (10 shots early, down to 6 at the end), the pack shakes for the last two shots
before it goes, and the threshold tightens as the round's colours disappear from the board,
so endgames accelerate on their own. Hosts scale it with the **Shot pressure** slider (8 plays
rounds as authored; `0` turns it off). A player who sits on a loaded launcher is told
**HURRY UP!** and then fires at whatever angle they hold; the **Hurry-up** setting is the
idle limit in seconds (default 8, `0` off). Bots and Battle boards are exempt.

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
