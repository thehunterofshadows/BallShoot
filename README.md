# BallShoot — Bubble Together

A cooperative and competitive multiplayer bubble-shooter with shared combos,
private battle boards, special bubbles, optional local bots, and live cross-device rooms.

## Playing online

Choose **Create online room**, enter a display name, and share the generated
three-digit code. Co-op rooms support two to four people; Battle rooms support
two to eight. The host chooses every lobby setting and starts the match. Co-op
players share one server-authoritative field, while Battle gives each person a
private field.

Every few shots the field pushes down a row, and the ceiling comes with it. The
threshold tightens as colours disappear from the board, so endgames accelerate on
their own. Hosts tune it with the **Shot pressure** slider; `0` turns it off.

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
- `server/server.js` — HTTP health endpoint and WebSocket protocol adapter
- `support.js` — generated browser runtime
- `thumbnail.webp` — original preview image

Nginx serves the browser app and proxies same-origin `/ws` connections to the
`gameserver` service over their shared network namespace. Only Nginx has an
address on the external `edge` network; the game server listens on loopback with
no published ports.
