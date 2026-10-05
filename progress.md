# Issue #18 - Server-backed player profiles

**Status:** ✅ Complete

## Implementation Plan

- [x] Review issue #18, AGENTS.md, server (scores/server.js), and local play flow in `coop-bubbles.js`
- [x] Add shared `coop-profiles.js` rules (name validation, stat schema, round-result validation, pair keys, on-screen keyboard layout/navigation)
- [x] Add `server/profiles.js` store (profiles, lifetime stats, campaign progress, pair stats, idempotent round IDs, atomic JSON persistence)
- [x] Add `/profiles` HTTP routes in `server/server.js`, nginx proxy, Dockerfile/compose/index.html wiring for the shared module
- [x] Track per-player round stats in local play (attributed score, popped, biggest pop, best chain, bombs, Fusion, time)
- [x] Add per-player Player Select overlay (Existing / New / Guest) with independent pad cursors, on-screen keyboard, physical keyboard ownership
- [x] Show profile names / Guest in launcher labels and TV cards
- [x] Submit end-of-round results with retry queue and save warning; never for Guests
- [x] Add main-menu Player Stats screen with stats, campaign progress, partners, rename, and confirmed delete
- [x] Add tests for store, HTTP API, shared rules, and client wiring
- [x] Add browser probe `scripts/profiles-probe.mjs` and route existing probes through Player Select as Guests
- [x] Run Docker test suite (`docker compose run --rm --no-deps test`) — 268/268 pass
- [x] Update CHANGELOG/README docs
- [x] Rebuild environment (`./rebuild.sh`) and report build stamp — `2026-10-05 16:40 UTC`, `coop-bubbles.js?v=fa49dae0cc74`
- [x] Review diff, commit, and push

## Notes

- Profiles cover local play (Co-op Clear, Endless, local Battle). Online rooms keep their per-room display name; attributing server-authoritative online rounds to profiles is a follow-up.
- Local rounds are simulated in the browser, so the server bounds and validates each round's deltas (caps, shares ≤ team score, idempotent round id) and derives all totals itself; it cannot prove a local round was played honestly.
- Pre-existing probe failures, reproduced on the base commit and unrelated to this change: `tv-probe` field-aspect checks (2P now uses the 16/15 board), `touch-controls-probe` point-to-aim checks, and `theme-probe` deck check.
