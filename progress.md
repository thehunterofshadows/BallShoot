# Issue #8 - TV Mode: low-latency input/render architecture with animation guardrails

**Status:** ✅ Complete

## Implementation Plan

- [x] Review issue #8, AGENTS.md and the frame loop, input, fire/recoil, audio, asset and DOM-sync code
- [x] Frame pipeline: fresh input (gamepad poll) → bounded-step simulation → visual FX → render → DOM HUD sync; `simSteps` pure helper, no 60 Hz assumptions or caps
- [x] Keep cosmetic state off the sim path: flight trails sampled by time (not per step), recoil/shake stay presentation-only
- [x] Preload/decode gameplay sprites and fonts; interactive-latency Web Audio context warmed on first gesture
- [x] Dev perf overlay (`?perf` / F9): presented FPS + estimated display Hz, frame time, input→render, sim time/step rate, render time
- [x] AGENTS.md "Gameplay Responsiveness" guardrails
- [x] Tests: refresh-independent aim/flight/falling at 60/120/144 Hz, step helper, cadence estimator, pipeline order, no fixed-60 caps (`tests/frame-pipeline.test.js`; AGENTS.md mounted into the test service)
- [x] Run `docker compose run --rm --no-deps test` (169/169 pass)
- [x] Rebuild with `./rebuild.sh` (build `2026-09-27 18:13 UTC`, `coop-bubbles.js?v=b2f368412b76`) and validate 60/120/144 Hz via `scripts/refresh-probe.mjs` (clock, aim sweep and shot travel match; fire launches before the next frame; overlay tracks vsynced vs unlimited cadence)
- [x] Update CHANGELOG and README
- [x] Review final diff, commit referencing #8 and push `dev`

## Notes

- Simulation bound is 120 Hz: it cuts the 60-vs-144 Hz divergence of gravity motion from ~9 units to ~1; shots were already distance-subdivided. `?sim=240` is available for comparison only.
- Real 120/144 Hz hardware presentation was not available here; headless Chromium validated on a controlled rAF clock plus vsynced/unlimited cadence. A check on a physical high-refresh display is still worthwhile.
- Frames longer than 100 ms (tab switch, stall) are dropped rather than fast-forwarded.
