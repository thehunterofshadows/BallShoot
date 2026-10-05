# Issue #18 - Server-backed player profiles

**Status:** 🔄 In progress

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
- [ ] 🔄 **Rebuild environment (`./rebuild.sh`) and report build stamp**
- [ ] Review diff, commit, and push
