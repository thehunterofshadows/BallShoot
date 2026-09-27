# Issue #6 - TV Mode: couch display system and 2-player co-op layout

**Status:** ✅ Complete

## Implementation Plan

- [x] Review issue #6, AGENTS.md and the layout, render, HUD, input, fullscreen and settings code
- [x] Centralized `TV` config + pure helpers: `resolveDisplayMode`, `tvStage` (1920×1080 logical, letterbox, safe area), `TV_LAYOUTS` (coop2, coop, battle) and `tvLayoutKey`
- [x] Display Mode setting (Auto / Desktop / TV) on the home card, pause card and side panel, persisted in `bt_prefs`
- [x] TV stage in `measure`/`relayout`: `.tvMode` class, stage sizing, playfield rect, world height pinned to the layout, 16:9 background art
- [x] TV HUD (DOM, logical px × hudScale): team score, round, row push, Team Power, P1/P2 cards with large loaded/next bubbles; secondary info only when not in active play; canvas co-op HUD and sfx log suppressed in TV
- [x] Larger canvas launcher labels / next preview in TV
- [x] Couch menus: cards, drawer and chrome scaled by menuScale, strong focus states, larger rows
- [x] Fullscreen: obvious TV fullscreen action, request only on user gestures, TV survives exit
- [x] Gamepad support: per-human aim/fire/pass/power/pause in play, focus navigation + A/B in menus
- [x] Tests: `tests/tv-mode.test.js` (mode resolution, 1080p/4K composition, safe area, non-16:9, layouts, persistence/wiring)
- [x] Run `docker compose run --rm --no-deps test` (147/147 pass)
- [x] Update CHANGELOG and README
- [x] Rebuild with `./rebuild.sh` (build `2026-09-27 17:49 UTC`, `coop-bubbles.js?v=323ca309f2df`) and check TV mode in headless Chromium at 1080p, 4K, 21:9 and 4:3 (`scripts/tv-probe.mjs`: identical logical composition, all critical UI in the safe area, no page errors) plus the desktop screenshot matrix (unchanged)
- [x] Review the final diff, commit referencing #6 and push `dev`

## Notes

- Battle keeps its own canvas HUD strip in TV; it gets the stage, safe-area chrome, menu scaling and controllers but no dedicated framing yet (`TV_LAYOUTS.battle`). 3-4 player co-op uses the generic `coop` layout.
- Auto picks TV only when a large near-16:9 screen has a gamepad connected or no pointer; browsers only report a gamepad after its first button press.
- Gamepad input is not a browser user gesture, so fullscreen is only requested from clicks/taps/keys (the Play fullscreen button, choosing TV, or the clicks that start play).
