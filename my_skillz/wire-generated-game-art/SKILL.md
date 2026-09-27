---
name: wire-generated-game-art
description: Turn generated ChatGPT/image assets into production-ready Bubble Together game assets, move binary files into the BallShoot repo on Mini, wire them into canvas rendering without changing gameplay, make sure Docker/Nginx serves them, visually verify screenshots, then commit and push the scoped change. Use whenever asked to use, wire in, replace, import, or hook up generated game art such as bubbles, icons, launchers, characters, effects, or other 2D sprites.
argument-hint: "[asset description and what it should replace/use]"
---

# Wire Generated Game Art into Bubble Together

Request: $ARGUMENTS

Use this skill when the user has generated or supplied visual game art and wants it to become a real runtime asset in Bubble Together.

Repository:
`/home/justin/projects/BallShoot`

Primary game renderer:
`coop-bubbles.js`

Runtime asset root:
`assets/`

Always read `AGENTS.md` first and inspect the current branch/worktree before editing. The live repository is authoritative.

## Core rule

Treat this as an **asset + rendering integration** task, not a gameplay rewrite.

Preserve:
- bubble/game physics
- scoring
- multiplayer authority
- input behavior
- collision geometry
- existing special-bubble semantics

Only change gameplay when the user explicitly asks.

## 1. Inspect before touching the asset

First inspect:

1. The generated/supplied image at full resolution.
2. Current game art/rendering for the thing being replaced.
3. Existing `assets/` layout and naming conventions.
4. Every render path where the old visual appears.
5. `Dockerfile` and Nginx/static packaging so new files will actually ship.

For Bubble Together bubbles specifically, check:
- main board bubbles
- current launcher bubble
- next bubble
- fired/in-flight bubbles
- falling bubbles
- Battle mini-board bubbles
- rainbow special
- bomb special

Do not replace only the obvious main-board path and leave stale flat/procedural art elsewhere.

## 2. Prepare game-ready sprite files

If the source is a sprite sheet, split/crop it into individual runtime sprites.

Prefer:
- transparent background
- square files for circular/sprite assets
- consistent dimensions
- enough transparent padding for glows/fuses/details
- WebP with alpha for browser runtime art when quality remains acceptable

Keep normal color variants visually identical except for color.

Special assets may need more padding. Example: the Bubble Together bomb fuse extends beyond the round body, so its draw box should be slightly larger than a normal bubble without changing collision radius.

Verify that transparency is real alpha. Do not assume an image that *looks* transparent actually is.

If source-quality originals are worth preserving, keep them separately from optimized runtime files. Do not ship huge source sheets when small runtime sprites are sufficient.

## 3. Move binary assets onto Mini safely

Preferred path when both machines can see the file:
- use `rsync -av` or `scp`
- verify file size/hash after transfer

When the generated image exists only in ChatGPT's working/container filesystem and cannot be copied directly to Mini, use GitHub as the binary bridge instead of forcing binary data through a text-only remote write:

1. Optimize/crop the runtime file first.
2. Base64-encode the binary locally.
3. Use GitHub's Git data API / connector to create a binary blob with `encoding: base64`.
4. Add the blob to a tree based on the current `dev` tree.
5. Create a commit with the current `dev` HEAD as parent.
6. Fast-forward the `dev` ref.
7. On Mini run `git pull --ff-only origin dev`.
8. Verify the files exist and are valid images.

This is the reliable fallback for generated binary art.

Do **not** paste a large base64 binary through a normal text-file writer and assume it survived intact.

## 4. Wire sprites through one rendering path

Prefer one central renderer instead of duplicating image drawing everywhere.

For Bubble Together bubbles, the successful pattern is:

- define a key -> asset URL map
- preload each file with `new Image()`
- choose the sprite key from either the normal bubble kind or the special type
- draw the image from `drawBubble(...)`
- keep the old procedural/vector drawing as a loading/failure fallback

Conceptually:

```js
const BUBBLE_SPRITE_URLS = {
  R: 'assets/bubbles/red.webp',
  Y: 'assets/bubbles/yellow.webp',
  G: 'assets/bubbles/green.webp',
  B: 'assets/bubbles/blue.webp',
  rainbow: 'assets/bubbles/rainbow.webp',
  bomb: 'assets/bubbles/bomb.webp',
};
```

Then `drawBubble(...)` should:

1. derive the sprite key
2. check `img.complete && img.naturalWidth`
3. `drawImage(...)` when ready
4. otherwise use the existing procedural drawing

This gives instant fallback on slow/failed image loads and avoids a blank game.

## 5. Keep visual size separate from collision size

Do not change `R`, collision math, grid spacing, snap logic, or physics just because the art has highlights or padding.

The image may draw slightly outside the collision circle.

For the glossy Bubble Together bubble set, the useful starting point was approximately:
- normal/rainbow visual box: `rad * 2.12`
- bomb visual box: `rad * 2.35`

Those values are presentation only. Re-check them visually for a new asset set rather than treating them as universal constants.

## 6. Reuse the central renderer everywhere

After updating the main drawing function, search for manual circles/flat-color fallbacks that still bypass it.

For bubble art, replace manual rendering in:
- Battle mini previews
- current loaded bubble
- flight previews
- falling previews
- any other small preview that is large enough for the sprite to read

Use the same `drawBubble(...)` call so the visual language is consistent.

Tiny particles/sparks do not need full sprites.

## 7. Make sure the runtime image contains the files

A correct source tree is not enough. Confirm the container actually serves the assets.

For BallShoot, if the web image does not already copy the asset tree, add the appropriate Dockerfile copy, for example:

```dockerfile
COPY assets /usr/share/nginx/html/assets/
```

Rebuild after changing runtime files.

Then verify an asset directly, for example:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://dev-ballshoot.fireorbooty.com/assets/bubbles/red.webp
```

Expected: HTTP 200 and an image content type.

## 8. Validate both behavior and appearance

Run the project gate:

```bash
./rebuild.sh
```

The rebuild already runs the automated test suite. Do not treat passing unit tests as sufficient for an art change.

Also run the screenshot matrix:

```bash
docker compose run --rm --no-deps screens
```

Then inspect at least the desktop screenshot at full resolution and, when the change affects small-screen readability, inspect one narrow/mobile screenshot too.

For art integration, explicitly check:
- no background rectangle around sprites
- transparent edges look clean
- adjacent bubbles do not visually overlap too much
- highlight direction is consistent
- launcher/next bubbles match the board
- special bubbles are immediately readable
- bomb fuse/details are not clipped
- no fallback flat circles remain in obvious views

If the screenshot is wrong, fix it before handoff.

## 9. Git handoff and concurrent-agent safety

Follow `AGENTS.md` for the normal repository handoff.

Before committing:
- inspect `git diff`
- inspect `git status --short`
- make sure new runtime assets are tracked
- do not accidentally absorb unrelated active-agent work

The automated watcher may have `progress.md` modified for another issue. If that file was already dirty before this task, do not overwrite or rewrite its contents merely to make the tree clean. Keep the asset commit scoped and report the pre-existing watcher change.

Push the current `dev` branch after a successful scoped commit.

## 10. Final report

Keep the user-facing report concise. Include:
- which assets were added
- where they were wired
- whether Docker/static serving changed
- automated test result
- screenshot/visual verification result
- deployed build stamp when runtime code changed
- commit hash
- any unrelated pre-existing worktree change intentionally left untouched

## Bubble Together reference implementation

The glossy bubble integration that established this workflow used:

`assets/bubbles/red.webp`
`assets/bubbles/yellow.webp`
`assets/bubbles/green.webp`
`assets/bubbles/blue.webp`
`assets/bubbles/rainbow.webp`
`assets/bubbles/bomb.webp`

It wired those files through `drawBubble(...)`, reused that renderer in Battle previews, added `assets/` to the Nginx Docker image, ran 118 tests, ran the 18-shot screenshot matrix, visually checked the desktop render, and verified the served WebP endpoint.

Use that pattern as the baseline, but always inspect the current code before assuming exact line numbers or asset paths.
