# Issue #11 - Fantasy arcade theme: background, playfield, frame, launcher deck

**Status:** ✅ Complete

## Implementation Plan

- [x] Review issue #11, AGENTS.md, renderer (`render()`, `drawDanger`, launchers, battle minis) and theme assets
- [x] Centralize theme asset URLs + build-stamp cache-busted preloading (`THEME_SPRITES`)
- [x] Root fantasy-night background (screen-fixed, cover crop, darkened centre) with readable side UI
- [x] Playfield glass clipped to the field bounds (mirrored band repeat, no tall-view stretch) with procedural gradient fallback
- [x] Screen-fixed cabinet frame: 3-slice left/right rails, top marquee clear of `GRIDTOP0`, bottom frame
- [x] Launcher deck for aligned 2-player classic layout; frame-bottom fallback for 3/4 players / wide fields
- [x] Neon danger rail (brighter/pulsing only in danger) and dark-field legibility of labels/popups/callouts
- [x] Battle mini boards reuse glass/background where it reads cleanly
- [x] Add theme tests (all seven assets referenced/loaded, fallback, no geometry constants changed)
- [x] Run `docker compose run --rm --no-deps test` (175/175 pass)
- [x] Draft pass: inspect desktop + narrow/tall + 3/4-player + wide + battle shots; fix marquee/HUD overlap and launcher-name contrast
- [x] Run screenshot matrix + `scripts/theme-probe.mjs` and inspect
- [x] `./rebuild.sh`, HTTP-check theme WebPs (all 7: 200 + image/webp), report build stamp
- [x] Update CHANGELOG/README, review diff, commit and push

## Notes

- Rendering-only change: gameplay coordinates, collision, `GRIDTOP0`, `LAUNCH_Y`/`DANGER_Y` stay untouched.
- The deck and lower frame are drawn beneath live bubbles/guides (not above them as the issue's
  suggested layer order has it), because the deck's backrests reach above `DANGER_Y` and would
  otherwise hide danger-row bubbles and the aim-guide start. Launchers still draw on top.
- True browser fullscreen can't be driven headlessly; it only resizes `:host`, which now uses the
  same dark world colour. The TV layout and all non-fullscreen shapes were checked.
