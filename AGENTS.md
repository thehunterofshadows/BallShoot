# AGENTS.md — BallShoot

Read this file before changing the project. This repository is managed by an
external Automated GitHub Watcher; see that section below.

## Dev/Prod topology

- Dev is the repository root `/home/justin/projects/BallShoot` on `dev`.
- Prod is the real Git worktree `/home/justin/run/BallShoot-prod` on `main`.
- The watcher edits and commits directly in the clean root `dev` checkout as
  `fix: implement issue #N [agent]`. Humans must `git pull origin dev` to sync.
- All build, run, and validation work happens in Docker. Do not require host
  Node.js, npm, or other application dependencies.
- Set up both environments with `./setup.sh`.
- Rebuild the current environment with `./rebuild.sh`.
- Watcher test command: `docker compose run --rm --no-deps test`.
- Promotion is human-gated: run `./promote.sh --dry-run`, then only after explicit
  approval run `./promote.sh --confirm`.

## Required handoff

Before handing work back to the user, always:

1. Run `./rebuild.sh` so the running environment serves the change. Editing files
   is not delivering: the user tests the deployed container, and an unrebuilt
   environment still serves the previous bundle. This applies to every change to
   `index.html`, `coop-bubbles.js`, `support.js`, `nginx.conf`, `Dockerfile`, or
   anything under `server/`. Report the build stamp or `?v=` hash of what you
   deployed so the user can confirm they are looking at it.
2. Commit every change in the working tree, including untracked files, and push
   the current branch. Do not leave any local changes or commits unpushed.

## Project architecture

BallShoot serves the “Bubble Together” cooperative bubble-shooter as a static
browser application through Nginx on internal HTTP port 80.

- `index.html` is the document shell and loads `support.js`.
- `coop-bubbles.js` defines the `<coop-bubbles>` web component and owns game
  state, input, simulation, and canvas rendering.
- `support.js` is generated runtime support. Preserve the generated header and do
  not hand-edit it unless the runtime itself is intentionally being replaced.
- `thumbnail.webp` is the original project preview image.
- `Dockerfile`, `nginx.conf`, and `docker-compose.yml` are the runtime boundary.
- Dev and Prod use distinct Compose projects, images, and stable edge-network
  container names: `ballshoot-dev-web` and `ballshoot-prod-web`.
- Cloudflare terminates TLS. Keep the container HTTP-only, attached to external
  network `edge`, with no host 80/443 publication and no local cloudflared token.

When changing gameplay, keep authoritative state updates separate from rendering,
as documented at the top of `coop-bubbles.js`. Preserve multiplayer input streams
and the component lifecycle cleanup.

## Automated GitHub Watcher

An external watcher polls this repository's GitHub Issues. Opening an issue starts
intake and design automatically. It owns these reserved labels:

- Workflow: `0_intake` → `1_questions` → `2_design` → `3_development` → `4_dev_done`
- Auxiliary: `human_review`, `blocked`, `dev_active`, `z_quota_reached`

Humans control the lifecycle with issue comments:

- `/design` generates or refreshes a technical design.
- `/answered` continues after clarifying questions are answered.
- `/dev` approves the design and queues implementation.
- `/done` accepts the completed work.
- `/block` marks the issue blocked.
- `/review` requests human review.
- `/reset-intake` returns the issue to intake.

After `/dev`, the watcher implements in the root `dev` checkout, runs
`docker compose run --rm --no-deps test`, and commits successful work directly to
`dev`. Promotion to `main` and Prod always requires a human through `promote.sh`.
