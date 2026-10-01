# Issue #4 — Co-op level objects

**Status:** ✅ Complete

## Implementation Plan

- [x] Read issue #4, repository instructions, and the relevant level, resolution, snapshot, and rendering paths
- [x] Define and validate reusable objects on the four named authored levels
- [x] Implement server-owned object interactions, timers, rewards, snapshots, and disconnect fallback
- [x] Render object states and events with compact first-use guidance
- [x] Add focused object, level transition, reconnect, and fallback tests; update player documentation
- [x] Run Docker validation, rebuild Dev, and inspect the deployed build
- [x] Review the final diff, complete this checklist, commit, and push issue #4

## Notes

- The Vault, Chandeliers, The Canyon, and Hive Bridge are existing late-round set pieces (rounds 47–50); their order and names remain intact.
- Object hits consume the shot. Linked barriers open if their targets fall, so a detached lock cannot strand the board.
- Dev build: `coop-bubbles.js?v=9815ceb5965e`, `coop-objects.js?v=358e10dfc276` (2026-10-01 15:46 UTC).
