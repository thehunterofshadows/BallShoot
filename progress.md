# Issue #2 — Co-op: 2-player Pass Bubble

**Status:** ✅ Complete

## Implementation Plan

- [x] Review issue, AGENTS.md, server/game.js, server/server.js, coop-bubbles.js and tests
- [x] Add shared `PASS` constants + pure `passPair()`/`passSwap()` rules, mirrored verbatim in server and client
- [x] Server: `passCd` state, `requestPass(id)`, cooldown tick, `pass` event, snapshot field; `pass` protocol message
- [x] Client local: `requestPass(i)` with the same rules, cooldown tick, E / `/` / I keys
- [x] Client online: send `pass`, never predict the swap, render the server `pass` event, sync cooldown from snapshots
- [x] Client presentation: arcing bubbles tinted by sender, launcher ring pulse, PASS! popup, swoosh + muted-click SFX
- [x] PASS pad button: visible only when a pass is possible, cooldown ring, flash on pass, shake when not ready, never under FIRE
- [x] Tests: P1/P2 swap, next unchanged, specials intact, cooldown start/reject, simultaneous requests, non-co-op / disconnected rejected, snapshot, no side effects, mirror guard, protocol
- [x] Run `docker compose run --rm --no-deps test` (100/100 pass)
- [x] Browser smoke check of local PASS (Playwright touch layout: tap swaps, E refused on cooldown then swaps, no page errors)
- [x] Update CHANGELOG and README controls
- [x] `./rebuild.sh` (dev serves `coop-bubbles.js?v=aa54646cc5f9`, build 2026-09-26 22:27 UTC), review diff, commit and push

## Notes

- PASS exists only in Co-op Clear with exactly two humans; local bots never take part, and Endless, Solo, Battle and 3-4 player rooms are unchanged.
- Local keys: PASS button = first human (P1), E = P2, / = P3, I = P4. Online: E or the button, always for your own seat.
- The swap is authoritative immediately; the arc animation (0.45 s) is presentation only.
