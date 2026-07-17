# BallShoot — Bubble Together

A cooperative multiplayer bubble-shooter with shared combos, assists, special
bubbles, multiple arenas, optional local bot teammates, and live cross-device rooms.

## Playing online

Choose **Create online room**, enter a display name, and share the generated
three-digit code. Two to four people can join from separate devices. The host
chooses every lobby setting and starts the match; each device then controls one
launcher against the same server-authoritative field.

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
./promote.sh --dry-run
./promote.sh --confirm  # only after explicit human approval
```

`setup.sh` creates the Prod worktree and starts isolated Dev and Prod Compose
projects. `rebuild.sh` validates first and refuses to rebuild on failure.

## Source layout

- `index.html` — document shell
- `coop-bubbles.js` — game component, local simulation, online client, input, and rendering
- `server/game.js` — authoritative online simulation
- `server/lobbies.js` — room membership, settings, reconnect, and host lifecycle
- `server/server.js` — HTTP health endpoint and WebSocket protocol adapter
- `support.js` — generated browser runtime
- `thumbnail.webp` — original preview image

Nginx serves the browser app and proxies same-origin `/ws` connections to the
`gameserver` service over their shared network namespace. Only Nginx has an
address on the external `edge` network; the game server listens on loopback with
no published ports.
