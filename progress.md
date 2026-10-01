# Issue #10 - TV Mode aspect-ratio and dynamic viewport handling

**Status:** ✅ Complete

## Implementation Plan

- [x] Review the existing #10 implementation (6fe45fd, 1be7d02, 3faacb7) against each acceptance criterion
- [x] Fix any gaps or defects found in the review (none found)
- [x] Run unit tests: `docker compose run --rm --no-deps test` (182/182 pass)
- [x] Run TV aspect matrix probe: `docker compose run --rm --no-deps screens node scripts/tv-probe.mjs` (1080p/1440p/4K, 16:10, 2560x1080, 3440x1440, 4:3, arbitrary sizes, resize and fullscreen all pass)
- [x] Run desktop/mobile screens regression: `docker compose run --rm --no-deps screens` (18 shots)
- [x] Rebuild dev with `./rebuild.sh` (game `?v=2fb270016755`, support `?v=ae4f0ac84496`)
- [x] Review the final diff, commit referencing #10, and push `dev`

## Notes

- Minimum usable TV viewport is 960×540 (stage scale 0.5). Below it, forced TV shows a notice and pauses offline play; Auto falls back to Desktop.
- CHANGELOG and README TV section were already updated in 6fe45fd.
