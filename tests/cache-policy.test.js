'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const documentShell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const nginx = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8');

test('browser assets receive content-derived versions during the image build', () => {
  assert.match(documentShell, /support\.js\?v=__SUPPORT_VERSION__/);
  assert.match(documentShell, /coop-bubbles\.js\?v=__GAME_VERSION__/);
  assert.match(dockerfile, /sha256sum \/usr\/share\/nginx\/html\/support\.js/);
  assert.match(dockerfile, /sha256sum \/usr\/share\/nginx\/html\/coop-bubbles\.js/);
  assert.match(dockerfile, /s\/__SUPPORT_VERSION__\/\$\{support_version\}\/g/);
  assert.match(dockerfile, /s\/__GAME_VERSION__\/\$\{game_version\}\/g/);
});

test('the loaded build identifies itself on screen', () => {
  const game = fs.readFileSync(path.join(root, 'coop-bubbles.js'), 'utf8');
  assert.match(game, /const BUILD_STAMP = '__BUILD_STAMP__'/);
  assert.match(game, /class="buildTag">\$\{BUILD_LABEL\}/);
  // Stamped before the cache-busting hash is taken, so the ?v= changes every build.
  const stampAt = dockerfile.indexOf('s/__BUILD_STAMP__/');
  const hashAt = dockerfile.indexOf('sha256sum /usr/share/nginx/html/coop-bubbles.js');
  assert.ok(stampAt > -1 && hashAt > stampAt, 'stamp must be applied before hashing');
});

test('HTML is never cached while JavaScript must be revalidated', () => {
  assert.match(nginx, /location = \/ \{[\s\S]*?Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always/);
  assert.match(nginx, /location = \/index\.html \{[\s\S]*?Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always/);
  assert.match(nginx, /location ~\* \\.js\$ \{[\s\S]*?Cache-Control "no-cache, must-revalidate" always/);
});
