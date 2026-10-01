# Issue #13 — 2P Co-op double-width board

**Status:** ✅ Complete

## Implementation Plan

- [x] Read issue #13, repository instructions, and the grid, level, camera, layout, and theme code
- [x] Add a reusable grid-profile (classic 11/10, coop2 16/15) and level-layout resolver in the mirrored levels block
- [x] Author 12 purpose-built `layouts.coop2` levels with tuned drop pacing; centre classic rows for rounds without one
- [x] Load the coop2 profile for local 2-player Co-op Clear (grid width, launchers at 25%/75%, objects)
- [x] Make the view width follow the profile: fixed full-field camera, uniform desktop/TV fit, renderer/HUD/theme/pointer use the view width
- [x] Add tests: 16/15 validation, cross-centre match/drop, cross-board shots, fixed camera, display fits, solo/Battle untouched
- [x] Run Docker tests (`docker compose run --rm --no-deps test`) — 212/212 pass
- [x] Rebuild Dev and capture screenshots at 1080p/4K/16:10/ultrawide (`scripts/coop2-probe.mjs`)
- [x] Update CHANGELOG/README, review diff, commit, and push

## Notes

- The 16/15 board applies to local Co-op Clear with exactly 2 player slots on the Classic field. Solo, 3–4 players, Wide 4×, Battle, and online rooms keep the 11/10 board. The level data and resolver are mirrored on the server, so rooms could adopt `coop2` later.
- Rounds 13–52 have no `coop2` layout yet. On the 2P board they use their classic rows, centred and paced ×1.3.
- The two-socket launcher deck does not fit the wider board, so 2P uses the bottom tray with the live launchers. In TV mode the side columns are narrower, so the round panel wraps and grows downward instead of clipping.
- Leaderboard buckets are still keyed by mode and round only, so 2P wide-board scores share a table with classic scores.
- The playtest questions in the issue (couch readability, pressure feel) still need real two-person sessions.
- Dev build: `coop-bubbles.js?v=31bd28ea040c` (2026-10-01 22:07 UTC).
