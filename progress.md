# Issue #3 - Co-op Team Power meter and Synergy Burst

**Status:** ✅ Complete

## Implementation Plan

- [x] Review issue #3, AGENTS.md and the co-op team/pass code paths
- [x] Add a `power-rules` block (TEAM_POWER tunables, POWERS definitions, charge-from-team-events, activation check) mirrored verbatim in `server/game.js` and `coop-bubbles.js`
- [x] Server: charge/active/timer state, charge from authoritative team events, `activateTeamPower(id)`, pressure/miss/rescue pause, events, snapshot fields, `{type:"team_power"}` protocol
- [x] Client local play: same state machine and charge rules, pause pressure/rescue while active
- [x] Client online: send request only, apply snapshot fields and render `team_power_*` events
- [x] Client HUD/controls: shared meter (fill / READY / SYNERGY BURST countdown), TEAM POWER pad button, Q key, activation FX + SFX
- [x] Tests in `tests/coop-power.test.js` (charge, cap, activation, duplicates, rainbow, pauses, snapshots, battle/solo) and update pad-order test
- [x] Run `docker compose run --rm --no-deps test` (118/118 pass)
- [x] Render the co-op HUD in a headless browser (desktop Q and touch button): no page errors; TEAM POWER moved to the corner opposite PASS so it clears the player's launcher
- [x] Update CHANGELOG and README
- [x] Rebuild the dev environment with `./rebuild.sh` (build `2026-09-26 22:36 UTC`, `?v=1579ca148a0c`)
- [x] Review the final diff, commit referencing #3 and push `dev`

## Notes

- Charge comes only from the existing team rules, which run for exactly two humans. A local
  one-human-plus-bot game therefore has no team events and no Team Power.
- The meter does not fill while a burst runs (`TEAM_POWER.chargeWhileActive`), and a burst
  also holds the miss meter, since misses are the other thing that drops the ceiling.
