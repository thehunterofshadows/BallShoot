# Changelog

## Unreleased

- Made the playfield fill any screen shape. The field stays 640 wide and 11 columns,
  so every authored level is unchanged, but the world height now adapts to the device
  between 1080 and 1560 virtual units: foldable cover panels and 21:9 phones gain real
  playfield instead of letterbox bars (a Galaxy Z Fold cover screen goes from 66% to
  92-99% of its height). Wide screens clamp to the original 1080 and letterbox, so no
  shape gets less runway than before and desktop geometry is untouched.
- Online rooms take the world height from the host as a validated room setting, so
  every player in a match shares one danger line regardless of their device.
- Replaced the viewport-width breakpoint with a measured layout pass: the settings
  panel and aim controls now appear whenever there is room beside the board, which
  reclaims phone landscape and the unfolded Fold inner screen instead of leaving 77%
  of the screen as empty gradient.
- Scaled on-canvas chrome and overlay cards to the board rather than the page, and
  inset the HUD from the measured corner buttons so score and miss meter stay legible
  on narrow boards.
- Added a Docker-only screenshot matrix (`docker compose run --rm --no-deps screens`)
  covering nine device shapes including Fold cover, Fold inner, and Flip cover panels.
- Added Puzzle Bobble style shot pressure: every few shots the whole field slides
  down one row and the wall stagger alternates, with the shot threshold tightening
  as colours leave the board. Tunable per room (`Shot pressure`, 0 disables) and
  active in Clear, Endless, and Battle for both local and online play.
- Fixed opponent Battle previews rendering with the wrong row stagger after a
  ceiling drop.
- Added local Battle mode against up to seven bots with private fields, junk
  attacks, target selection, elimination, spectating, and placements.
- Added server-authoritative online Battle rooms for two to eight named players,
  including reconnectable idle boards and explicit-leave forfeits.
- Added invite-only three-digit online co-op lobbies for two to four named players.
- Added a server-authoritative WebSocket simulation with synchronized settings,
  inputs, scoring, effects, pause/restart controls, and wide-field play.
- Added automatic seat reconnection, disconnected-launcher idling, host transfer,
  locked in-progress rosters, and return-to-lobby rematches.
- Preserved the original same-device Local mode and bot teammates.
- Added Docker-only game-server, lobby, deterministic co-op/Battle simulation,
  browser contract, and multi-client protocol tests.
- Imported the original Bubble Together browser-game prototype from `BallShoot.zip`.
- Added Docker-only static serving and validation.
- Added isolated Dev/Prod worktree scripts and shared Cloudflare edge-network wiring.
- Documented the centralized GitHub Watcher lifecycle and human-gated promotion.
