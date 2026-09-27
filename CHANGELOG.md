# Changelog

## Unreleased

- **TV Mode for the couch** (#7). *Controller-first navigation:* the d-pad and stick move
  focus spatially (sideways along a row, up / down between rows, wrapping vertically), each
  screen opens on its default (Local play, Resume, Save…) and returning from the drawer
  restores the previous focus; **A** confirms and **B** / Escape always go back one step, with
  a letter-labelled button legend along the bottom of the safe area. Room codes and initials
  take arcade-style character entry. Controllers keep a stable slot; a disconnect releases
  that launcher's holds, pauses local play and shows a toast, and a reconnect never counts an
  already-held button as a press. *Couch legibility:* TV type is its own table (`hudType`,
  `menuType`) with minimums of 28 px for the HUD and 30 px for menus (at 1080p), heavy
  weights, near-opaque plates and darker menu greys; focus adds a ▶ marker, selected choices a
  ✓, and warnings a ⚠ symbol or solid plate, so no state is colour-only. *Screen Fit:* a new
  calibration screen (home, pause or settings) shows corner marks on the safe edges and moves
  all edges or each edge from 0–10% with a live preview, Reset (5% default), Save and Cancel;
  it persists in `bt_prefs.screenFit` and drives the HUD, corner buttons, cards, drawer,
  prompts and toast, while the stage art keeps the full viewport and the field scales without
  distortion. All values live in the `TV` block (`screenFit`, `fit`, `minHudFontPx`,
  `minMenuFontPx`, `hudType`, `menuType`, `controllerNavigation`, `promptH`).

- New **TV / couch Display Mode** (#6). A Display setting — **Auto / Desktop / TV** on the
  home card, the pause card and the settings panel, saved with the device prefs — switches
  presentation only; rules, world and input streams are unchanged. TV composes the game on a
  fixed **1920×1080 logical stage** scaled whole into the viewport, so 1080p, 1440p and 4K
  show the same picture and 21:9 / 4:3 screens pillar- or letterbox instead of stretching.
  Critical UI stays inside a 5% **safe area**; the new stage art and the playfield bleed
  past it. **Two-player co-op gets its own layout**: a full-height centred playfield framed by
  team score and round (with the row-push countdown) across the top, Team Power, and one
  large card per player with their loaded and next bubbles and live status (Ready,
  Reloading, HURRY UP!). The canvas co-op HUD and sound log step aside; secondary details
  (miss meter, tuning, per-player stats) only show once play stops. Menus, the settings
  drawer and corner buttons scale by `menuScale` with a thick gold focus ring. **Gamepads**
  (standard mapping) now work everywhere: pad *n* drives the *n*th human launcher (stick /
  d-pad aim, A or RT fire, X or LB pass, Y or RB Team Power, Start pause, Back settings), and
  in menus the stick moves focus, left/right steps pickers and sliders, A presses and B backs
  out. TV prefers fullscreen: an obvious **Play fullscreen** button, plus a one-time request
  on the clicks that start play; a refusal or leaving fullscreen keeps TV mode. Auto picks TV
  for a large near-16:9 screen driven by a gamepad or no pointer. All tuning lives in one
  `TV` block (`safeArea`, `hudScale`, `menuScale`, `playfieldScale`, `hideSecondaryHud`,
  `preferFullscreen`), and future modes add a `TV_LAYOUTS` spec (3-4 player co-op and Battle
  already use generic ones). `scripts/tv-probe.mjs` checks the composition in Chromium.

- Co-op Clear levels now play like **Puzzle Bobble** (#5). The four dense walls became **52
  named rounds** in five tiers, drawn as small symmetric pictures with open space, stems to
  cut and bank-shot pockets: rounds 1-10 use three colours, 11-22 four, 23-34 five (new
  **purple**) and 35-52 six (new **orange**); The Vault, Chandeliers, The Canyon and Hive
  Bridge return reworked as the late set-pieces. Levels are now `{ name, drop, rows }` in one
  `levels` block that is byte-identical in `coop-bubbles.js` and `server/game.js`, and both
  Level pickers are generated from it. Rows gain placed specials: **stone** `#` never
  matches, pops or feels a bomb and only clears by falling; **star** `*` pops every bubble of
  the colour of a shot that lands beside it; **rainbow** `+` joins any colour's group without
  bridging two colours. The ceiling now drops every `drop` shots for that round (10 → 6),
  scaled by Shot pressure (8 = as authored, 0 = off; custom boards use the setting), still
  one shot tighter per colour cleared, and the pack shakes and ticks for the last two shots
  before it drops. Clearing a round pays a **time bonus** — 5,000 inside 15 s, sliding to 0
  at 120 s — shown on its own line on the level card. A new **Hurry-up** setting (default 8
  s, 0 = off, side panel and lobby) warns **HURRY UP!** with a countdown 5 s before an idle
  human launcher auto-fires at its current angle; firing, aiming or passing resets it, and
  bots, Battle boards and a running Team Power are exempt. Online the server owns all of it
  (`hurry` / auto `launch` events, `timeBonus` and `secs` on `level_cleared` and the level
  summary); the timing rules live in a mirrored `pace-rules` block. Custom levels accept
  `P O # * +`. Leaderboard buckets and room validation follow the new level count, so
  `clear` scores saved against the old level 0-3 now sit under rounds 1-4.

- Two-player Co-op Clear gets a shared **Team Power** meter and its first power, **SYNERGY
  BURST** (#3). The meter fills only from the teamwork events the co-op rules already
  resolve, once per event and never per bubble: setup assist +15, alternating team-chain
  handoff +10, team rescue +25, team drop +10 / huge team drop +20. A clear with no teammate
  involvement adds nothing, the meter caps at 100, does not fill while a power runs, and
  carries into the next level. At 100 it reads **TEAM POWER READY** and either human can
  fire it with **Q** or the TEAM POWER pad button, which turns rainbow when ready. Nothing
  fires it automatically, and bots never do. The first request empties the meter, so two
  presses at once fire one burst. For 8 seconds both loaded bubbles become rainbows, shots
  add no pressure or misses, the ceiling holds and a running rescue countdown stops; all
  of it resumes from where it stopped. The meter becomes the burst's countdown, both
  launchers wear a matching rainbow ring, a rainbow arc links them, the board edges pulse
  in both players' colours, and the burst has its own sound. Online the server owns the
  charge, the check and the effect: the client sends `{ type: "team_power" }` with nothing
  else in it and renders `team_power_charge` / `team_power_ready` / `team_power_activated`
  / `team_power_ended`, and snapshots carry the meter and the burst timer for rejoins. The
  rules live in one `power-rules` block (`TEAM_POWER` tunables, `POWERS` definitions) that
  is byte-identical in `server/game.js` and `coop-bubbles.js`, so another power is a new
  `POWERS` entry. Solo, Endless, Battle and 3-4 player rooms have no Team Power.

- Two-player Co-op Clear gets a **PASS** (#2): either human can swap the two players'
  *current* bubbles in one step — "send me your red". It is a swap, not a gift, so the bubble
  economy is untouched and both launchers stay loaded; the `next` bubbles never move, and a
  bomb or rainbow travels with its bubble. One 5-second cooldown (`PASS.cooldown`) is shared
  by the pair, so two presses at the same moment still make a single swap. A pass is not a
  shot: shots, misses, pressure, score and the chain are unaffected. Online the server is the
  authority — the client sends `{ type: "pass" }` with no bubble in it, the server's
  `requestPass()` validates and swaps, and the client animates the resulting `pass` event
  rather than predicting it; snapshots carry `passCd` so a rejoin shows the right cooldown.
  The rules live in one `pass-rules` block that is byte-identical in `server/game.js` and
  `coop-bubbles.js`. Controls: the new PASS pad button (touch and mouse; it sits in the
  corner on your launcher's side, clear of FIRE, and shows the cooldown as a shrinking wedge
  and a seconds count), **E** online and for local P2, **/** for local P3 and **I** for local
  P4. A pass arcs each bubble to the partner over a streak in the giver's colour, pulses both
  launcher rings, pops a small **PASS!** and plays a swoosh; pressing early only clicks and
  shakes the button. Solo, Endless, Battle and 3-4 player rooms have no PASS.

- Two-player Co-op Clear now scores teamwork (#1). Every bubble remembers who placed it and
  when, and a shot that clears or drops bubbles your teammate placed *before* you fired is a
  **TEAM ASSIST**: +100 to the team, once per resolving shot however many of their bubbles go
  with it, an assist on the setup player's line, and a burst in both players' colours. If that
  shot also clears the danger line it is a **TEAM RESCUE** (+250 on top of the usual +500), and
  a cut that drops 5+ / 10+ bubbles with the teammate's among them is a **TEAM DROP** /
  **HUGE TEAM DROP** (+150 / +300). Starting-board bubbles, your own bubbles, and a teammate
  bubble that landed while your shot was in the air never count. The chain gets a proper HUD:
  **TEAM CHAIN ×N** with a countdown ring in the colour of the player whose clear keeps it
  alive, and a flash on every handoff. The rules sit in one `teamPlay()` block that is
  byte-identical in `server/game.js` and `coop-bubbles.js` (a test holds them equal); online
  the server decides every bonus and the client only renders its `team_play` / `team_chain`
  events. The tunables live in `TEAM`. Level and end cards lead with a team total row and add
  shots and chain contributions per player. Solo, Battle, Endless and 3-4 player rooms get no
  team events and score exactly as before.

- Aiming ramps in, so a tap is a nudge and a hold is a sweep. One flat rate could not do both
  jobs the barrel has: at the default speed the whole arc crosses in a second, which makes the
  shortest tap a thumb can manage about fifteen degrees — several bubble columns. There was
  nothing to aim with, only overshoot and correct, and that is what the cannon "snapping
  between positions" actually was. A fresh press now turns at a quarter speed and eases up to
  the full setting once you have held it long enough to mean a sweep; turning back counts as a
  new press, so the correction at the end of a sweep starts fine again. A 110 ms tap moves
  about one column instead of eight, and a full sweep still takes about a second and a quarter.
  This is a ramp in, not momentum: release still stops the barrel on that frame.
- Removed the swap button. A player shoots the colour they were dealt — the queue is a
  constraint to play around, not one to reorder. The `next` preview stays, so you can still
  plan the shot after this one. The keyboard swap keys (`S`, `↓`, `I`) are gone with it.
- Fixed the settings gear doing nothing once a match started. Two separate faults. Joining a
  room set an inline `display:none` on the panel, which outranks the stylesheet rule that
  opens it, so the gear still toggled but nothing ever appeared — and that is exactly where a
  player most wants it, because the aim scheme is the one control a room does not set for
  them. The panel now stays open online and narrows to what genuinely belongs to the device;
  everything the host owns is hidden rather than shown as a lie, since snapshots overwrite it
  every 50 ms anyway. Separately, the chrome sat below `.overlay` in the stacking order, so
  the gear was unclickable behind pause, game over, level complete and the tutorial. The gear
  and the online bar now sit above the cards. The panel also gained a close button and an
  Escape handler — until now the only way out was finding the gear again underneath it.
- A cleared level is an intermission instead of a cut. The run stops on a scoreboard showing
  the clear bonus, the running score, what is up next, and a row per player. Online the next
  level does not start until every connected player has hit Continue: the card shows how many
  are ready, a player who disconnects is never waited on, and a 60-second backstop means one
  player walking away cannot freeze the room. Previously the server emitted `level_cleared`
  and reset into the next board in the same tick, so nobody saw anything at all.
- FIRE now wins the touch. The aim halves are transparent overlays covering the bottom half of
  the board, so a thumb landing a few pixels off FIRE turned the launcher instead of shooting.
  One capture-phase router on the pad decides every press in a declared order — an exact hit
  first, then near misses, where FIRE outranks everything within a halo that scales with the
  board and the FIRE size setting.
- The launcher carries no momentum: let go and it stops on that frame. A coast past where you
  stopped costs the one-degree correction this game is won on. Both aim modes go through one
  integrator, and it is byte-identical to the server's.
- Fixed online aiming feeling stepped. The client predicted at a hardcoded 2.4× while the
  server integrated at the room's aim speed, and every 50 ms snapshot overwrote the angle
  outright. Prediction now uses the room's setting and runs the same integrator the server
  does — byte-identical, and guarded by a test — so a hold is pure prediction and the server
  lands exactly where the barrel already is when the finger lifts. Only an idle launcher is
  reconciled, and other players' barrels interpolate rather than teleporting between snapshots.
- Touch tint and FIRE size join aim speed as room settings: the host sets one set of controls
  for everyone in the lobby, and leaving hands each device its own saved values back.
- Added a second way to aim on touch screens. `Touch aiming: Where I press` replaces the two
  halves with a surface over the whole board: the cannon points wherever you press and follows
  a drag exactly, the way a stylus port aims, and FIRE still shoots. Online it ships an
  absolute angle at the server's own snapshot rate rather than two held directions. Which
  scheme you like is a device preference, so unlike the rest of the control feel it is never
  overridden by a room.
- Added `scripts/touch-controls-probe.mjs`, which drives the pad with real touch events in a
  mobile browser. Synthetic mouse input does not go through touch-action or gesture handling,
  so it cannot see the two bugs that actually broke drag-to-aim: the aim surface was missing
  `touch-action:none`, and the pointer was captured to the pad, which is `pointer-events:none`
  on touch layouts. Either one made the browser cancel the pointer one move into a drag.

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
