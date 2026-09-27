# Issue #7 - TV Mode: controller navigation, couch readability, screen-fit calibration

**Status:** ✅ Complete

## Implementation Plan

- [x] Review issue #7, AGENTS.md and the existing TV block, gamepad/menu code, TV CSS and prefs
- [x] Centralized config: `TV.screenFit` per-edge defaults (5%), fit range, `minHudFontPx`/`minMenuFontPx`, HUD/menu type tables, `controllerNavigation`; pure helpers `normalizeScreenFit`, fit-aware `tvStage`/`tvLayout`, `spatialPick`
- [x] Screen Fit persisted in `bt_prefs`; relayoutTv applies it to HUD slots, corner buttons, menus, drawer, prompts
- [x] Screen Fit calibration overlay (corner markers, all/per-edge, live preview, reset, save/cancel) reachable from home, pause and settings
- [x] Controller navigation: spatial d-pad/stick focus, default selection per screen, consistent A/B (+ Escape), stable pad slots, disconnect/reconnect handling (release holds, auto-pause, toast), controller prompt bar
- [x] Couch legibility: TV type table applied to HUD and menus, stronger contrast, non-colour state cues (focus marker, selected segments, warnings)
- [x] Tests in `tests/tv-mode.test.js` for fit normalization, calibrated layouts, typography minimums, spatial nav, pad slots/disconnect, persistence/wiring
- [x] Run `docker compose run --rm --no-deps test` (160/160 pass)
- [x] Rebuild with `./rebuild.sh` (build `2026-09-27 18:05 UTC`, `coop-bubbles.js?v=9e9340040661`) and check TV in headless Chromium via `scripts/tv-probe.mjs` (default at 1080p/4K/21:9/4:3 plus a calibrated 4K fit and the Screen Fit screen) and the desktop screenshot matrix
- [x] Update CHANGELOG and README
- [x] Review final diff, commit referencing #7 and push `dev`

## Notes

- Screen Fit is capped at 10% per edge; at that inset every layout still fits (cards shrink before overlapping the power/pad rows).
- The optional display-name field and the custom-level editor still need a keyboard; room codes and initials support controller character entry.
