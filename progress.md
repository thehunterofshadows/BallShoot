# Issue #5 - Puzzle Bobble–style levels

**Status:** ✅ Complete

## Implementation Plan

- [x] Review issue #5, AGENTS.md and the level, resolve, pressure, level-card and settings code paths
- [x] Shared mirrored blocks: `levels:begin/end` (`LEVEL_KINDS`, `{ name, drop, rows }` levels, cell parser) and `pace-rules:begin/end` (drop pace, time bonus, hurry-up) in client and server
- [x] Six colours: purple/orange palette + hue-shifted `purple.webp` / `orange.webp` made in Docker
- [x] Placed specials (stone `#`, star `*`, grid rainbow `+`) in client local/battle resolve and server resolve; stone drawing
- [x] Per-level ceiling pace (`level.drop` × pressure setting, colour countdown) + pre-drop shake and tick sfx
- [x] Clear-time bonus (`levelStartT`, own line on the level card, server `clearLevel`/summary)
- [x] Hurry-up auto-fire: `hurry` setting (side panel, lobby, server validation), idle timers, callout, auto-fire, server mirror
- [x] Level picker as generated `<select>` (side panel + lobby), level validation / score buckets / `bt_progress` use `LEVELS.length`, custom sanitizer accepts new characters
- [x] Author ~52 rounds in five tiers (3→6 colours, stones/stars/rainbows, reworked set-pieces last)
- [x] Tests: `tests/levels.test.js` (mirror, shape, connectivity, stones droppable, tier colours) + server behaviour (stone falls, star clears, time bonus, hurry auto-fire); update chain, pace and burst tests
- [x] Run `docker compose run --rm --no-deps test` (133/133 pass)
- [x] Update CHANGELOG and README
- [x] Rebuild the dev environment with `./rebuild.sh` (build `2026-09-27 17:34 UTC`, `coop-bubbles.js?v=6bd6c84f695b`) and check it in headless Chromium: 53 level options in both pickers, stones/stars/six colours render, pre-drop shake, HURRY UP! then auto-fire, time-bonus line, no page errors
- [x] Review the final diff, commit referencing #5 and push `dev`

## Notes

- Stone and star use procedural drawings (no sprite yet); purple/orange are hue-shifted from blue/red and can be replaced via `my_skillz/wire-generated-game-art`.
- Bots do not aim for stars deliberately, and hurry-up does not run on Battle boards.
- Leaderboard buckets are keyed by starting level index, so `clear` scores saved under old levels 0-3 now show under rounds 1-4.
