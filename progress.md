# Issue #1 — Co-op teamwork: setup assists and team chains

**Status:** ✅ Complete

## Implementation Plan

- [x] Review issue, AGENTS.md, server/game.js, coop-bubbles.js and tests
- [x] Add shared `TEAM` constants + pure `teamPlay()` rules, mirrored verbatim in server and client
- [x] Server: apply team rules in `resolveBatch` (assist/rescue/drop bonuses, stats, events, chain-contribution stat, chain timeout constant)
- [x] Client local: same rules in `resolveBatch`, team callouts, dual-colour bursts, new SFX
- [x] Client HUD: TEAM CHAIN ×N badge with shrinking ring, next-player pulse, handoff flash
- [x] Client online: render team events from server (no client-side bonus inference)
- [x] Summaries: team totals first, then per-player rows incl. chain contributions
- [x] Tests: assist symmetry, board bubbles, same player, one bonus per shot, chain, rescue/drop metadata, solo/battle unchanged, mirror guard
- [x] Run `docker compose run --rm --no-deps test` (88/88 pass)
- [x] Browser smoke check of local team feedback (Playwright, no page errors; badge/assist layout fixed)
- [x] Update CHANGELOG, `./rebuild.sh`, review diff, commit and push

## Notes

- Team system is active only for Co-op Clear with exactly two humans (local bots never give or receive credit). Endless, Solo, Battle and 3-4 player rooms keep the old behaviour.
- "Placed before the shot" uses bubble placement time vs. shot fire time, so a teammate bubble that lands while your shot is in flight does not count.
- Rescue qualification is evaluated at the original rescue point (after any miss-triggered ceiling descent) so solo rescue timing is unchanged.
- `TEAM` tunables are code constants, not exposed in the settings UI (per issue).
