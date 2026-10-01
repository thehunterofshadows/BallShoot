# Issue #10 - Progress

**Status:** Ready for review

## Implementation Plan

- [x] Add `TV.minViewport` (960×540), the Auto stay-aspect band [1.2, 3.6], the pure `tvTooSmall()` helper and `resolveDisplayMode(..., {current})` hysteresis inside the `tv-display` block; point `TV.auto.minW/minH` at `minViewport`
- [x] Split `relayoutTv()` into a cheap per-resize stage update (col size, `--tvS/--tvX/--tvY/--tvMenuK`, too-small state) and a layout rebuild (`tvLayout`, safe/type vars, `placeTvHud`) that runs only when layout key, player count, H or Screen Fit change
- [x] In TV mode, paint the theme `--worldBg` on `.root` so it fills the extra width/height, make the `.gameCol` stage background transparent with a soft edge, and keep the flat colour as the fallback layer
- [x] Lock world geometry across TV↔Desktop flips during an offline match (skip `setViewH`, stash `_deviceViewH`, apply on `resetGame` without carry / `returnHome`); online stays room-authoritative
- [x] Add the `.tvSmall` notice below the minimum viewport in forced TV (fixed-px text, Fullscreen and "Use Desktop layout" buttons, default controller focus, wired into `menuRoot`/prompts); on entry, pause local offline play and cancel Screen Fit; never reset; no auto-resume
- [x] Add a devicePixelRatio `matchMedia` change listener that calls `fit()` and re-arms, unbound in `disconnectedCallback`; call `measure()` from the fullscreen-change sync
- [x] Extend `tests/tv-mode.test.js`: stage math across the full aspect matrix, layout invariance, `tvTooSmall` boundaries, Auto hysteresis, geometry lock on a mid-match flip, no HUD rebuild on a size-only relayout, too-small pauses offline without reset and never pauses online, DPR listener cleanup; update the `.gameCol` background assertion
- [x] Extend `scripts/tv-probe.mjs` to the issue's full matrix plus arbitrary sizes, a live resize sequence (including below-minimum and back) asserting no reset and correct notice/pause, a fullscreen enter/exit check, and background paint outside the stage
- [x] Update the `tv-display` header comment, README TV section, CHANGELOG and `progress.md`
- [x] Run `docker compose run --rm --no-deps test` and `docker compose run --rm --no-deps screens node scripts/tv-probe.mjs` (plus the default `screens` matrix for desktop regressions) and confirm all pass
- [x] Run `./rebuild.sh`, report the deployed `?v=` hash / build stamp, commit all changes and push `dev`
- [ ] Codex independent QA
- [ ] Claude design-compliance review
- [ ] Finalize reviewed issue

## Notes

- ai-runner -multi mode: Claude designs, AGY implements, Codex independently tests.
- Correction pass (QA findings):
  - Fixed pause-lock in `coop-bubbles.js`: guarded `padStart()`, keyboard `p` handler, and `togglePause()` against unpausing when `tvTooSmall` notice is active. Offline play stays paused until the window is restored above 960x540.
  - Fixed DPR test in `tests/tv-mode.test.js`: component's own `setupDprListener()` and `disconnectedCallback()` are now directly exercised, verifying real listener attachment, `fit()` callback, re-arming on resolution change, and unbind cleanup.
  - Updated `scripts/tv-probe.mjs`: samples rendered pixels outside the stage across letterbox and pillarbox bars to verify theme background paint (opaque, non-flat `#070a22`, non-black art); verifies pause lock under `.tvSmall` and resume via Start after recovery.
- Validation:
  - `docker compose run --rm --no-deps test`: 182/182 tests passing.
  - `docker compose run --rm --no-deps screens node scripts/tv-probe.mjs`: All 10 aspect matrix and arbitrary resolutions passed (with bar pixel paint verified), 4K Screen Fit passed, live resize sequence passed (pause-lock under too-small verified, Start recovery verified), and fullscreen enter/exit verified.
  - `docker compose run --rm --no-deps screens`: 18 desktop and mobile device shape screenshots verified without horizontal overflow.
  - Deployed dev container: game version `?v=044154987f86` (support: `?v=ae4f0ac84496`).
