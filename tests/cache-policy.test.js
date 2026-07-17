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

test('HTML is never cached while JavaScript must be revalidated', () => {
  assert.match(nginx, /location = \/ \{[\s\S]*?Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always/);
  assert.match(nginx, /location = \/index\.html \{[\s\S]*?Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always/);
  assert.match(nginx, /location ~\* \\.js\$ \{[\s\S]*?Cache-Control "no-cache, must-revalidate" always/);
});
