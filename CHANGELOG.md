# Changelog

## Unreleased

- Shortened aim guides are now a fixed-length stub off the barrel instead of a share of the
  flight path. A percentage grew and shrank with how far the shot had to travel, which
  leaked the very distance information the setting withholds and left the shortest guide
  nearly invisible on close targets. `Short` reaches about two rows, `Tiny` about two
  bubbles, at any target distance; the settings are relabelled `Full path` / `Short` /
  `Tiny` to match (the stored values are unchanged, so existing rooms are unaffected).
- Leaving an online room now restores your saved aim speed. Snapshots merge the room's
  settings into the client's, so the host's value used to stick to every local game that
  followed.
- Aim speed is now tunable (`Aim speed`, 0.6×–6×, default 2.4× as before) in both the local
  settings panel and the online lobby, since online aiming is integrated on the server.
- The blue tint the mobile aim halves show while held is tunable (`Touch tint`, 0–30%,
  default 2.5% as before), and `0` is now genuinely off: the browser's own tap highlight
  was painting a second blue wash over ours, and the pressed arrow ink now switches off
  with the tint.
- The FIRE button is resizable (`FIRE size`, 0.6×–2.2×). Padding, label, and corner radius
  scale together so the tap target grows with the look, and the swap button slides outward
  with it rather than being overlapped. These three are device feel preferences rather
  than match rules, so they persist in `localStorage` instead of resetting with the game.

- Added a bubble swap. `S` / `↓` / `I` per launcher, or the `⇄` touch button, exchanges the
  loaded bubble with the on-deck one. It is gated on the same reload timer as firing, so it
  is never a free re-roll, and it costs neither a shot nor shot pressure.
- Co-op Clear now chains the four authored levels instead of stopping at the first. Score
  and per-player stats carry forward, each clear pays an accuracy and miss-headroom bonus,
  and only the last level ends the run. Custom levels still end where they always did. The
  miss meter deliberately does not carry: a fresh full board plus a nearly-full meter would
  descend immediately.
- Deepened scoring. Pops pay superlinearly, so one 12-bubble cut beats four hurried 3s;
  drops pay a cascade multiplier when a shot severs several clusters at once; and the chain
  multiplier now builds in solo play, where previously it was permanently ×1 because it
  required a second clearer.
- Added a server-hosted arcade leaderboard. `GET`/`POST /scores`, top 20 per mode and
  level, persisted to a Docker volume. Qualifying runs prompt for three initials on the
  game-over card. Served over HTTP rather than the room socket so offline Local play can
  post too, and every call fails soft — an unreachable server never blocks the card.
  Submission is unauthenticated and therefore forgeable; validation and per-IP rate
  limiting bound the damage, but the table is a wall of initials, not an audited record.
- Fixed the server missing the client's rule that filling 60% of the miss meter resets the
  chain multiplier, which made online chains more forgiving than local ones.

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
