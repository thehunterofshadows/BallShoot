# Issue #10 - TV Mode aspect-ratio and dynamic viewport handling

**Status:** 🔄 In progress

## Implementation Plan

- [x] Review the existing #10 implementation (6fe45fd, 1be7d02, 3faacb7) against each acceptance criterion
- [x] Fix any gaps or defects found in the review (none found)
- [x] Run unit tests: `docker compose run --rm --no-deps test`
- [x] Run TV aspect matrix probe: `docker compose run --rm --no-deps screens node scripts/tv-probe.mjs`
- [x] Run desktop/mobile screens regression: `docker compose run --rm --no-deps screens`
- [ ] 🔄 **Rebuild dev with** `./rebuild.sh` and record the deployed `?v=` hash
- [ ] Review the final diff, commit referencing #10, and push `dev`
