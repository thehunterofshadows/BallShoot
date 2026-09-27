# Issue #8 - TV Mode: low-latency input/render architecture with animation guardrails

**Status:** 🔄 In progress

## Implementation Plan

- [x] Review issue #8, AGENTS.md and the frame loop, input, fire/recoil, audio, asset and DOM-sync code
- [x] Frame pipeline: fresh input (gamepad poll) → bounded-step simulation → visual FX → render → DOM HUD sync; `simSteps` pure helper, no 60 Hz assumptions or caps
- [x] Keep cosmetic state off the sim path: flight trails sampled by time (not per step), recoil/shake stay presentation-only
- [x] Preload/decode gameplay sprites and fonts; interactive-latency Web Audio context warmed on first gesture
- [x] Dev perf overlay (`?perf` / F9): presented FPS + estimated display Hz, frame time, input→render, sim time/step rate, render time
- [x] AGENTS.md "Gameplay Responsiveness" guardrails
- [x] Tests: refresh-independent aim/flight/falling at 60/120/144 Hz, step helper, cadence estimator, pipeline order, no fixed-60 caps
- [x] Run `docker compose run --rm --no-deps test`
- [ ] 🔄 **Rebuild with `./rebuild.sh` and validate 60 Hz vs 120 Hz presentation in headless Chromium**
- [ ] Update CHANGELOG and README
- [ ] Review final diff, commit referencing #8 and push `dev`
