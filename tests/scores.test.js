'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Scores, TOP_N } = require('../server/scores');

const tmpFile = name => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ballshoot-scores-')), name);

test('entries rank by score, break ties by arrival, and truncate to the top N', () => {
  const s = new Scores('');
  for (let i = 0; i < TOP_N + 5; i++) s.submit({ initials:'AB'+(i%10), score: i * 100, mode:'clear', level:0 });
  const rows = s.list('clear', 0);
  assert.equal(rows.length, TOP_N);
  assert.equal(rows[0].score, (TOP_N + 4) * 100, 'highest first');
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].score >= rows[i].score, 'descending');
  // A later run that ties an existing entry must not displace the earlier one.
  const top = rows[0].initials;
  s.submit({ initials:'ZZZ', score: rows[0].score, mode:'clear', level:0 });
  assert.equal(s.list('clear', 0)[0].initials, top);
});

test('buckets keep modes and levels apart', () => {
  const s = new Scores('');
  s.submit({ initials:'AAA', score:500, mode:'clear', level:0 });
  s.submit({ initials:'BBB', score:900, mode:'clear', level:1 });
  s.submit({ initials:'CCC', score:100, mode:'endless', level:0 });
  assert.deepEqual(s.list('clear', 0).map(e => e.initials), ['AAA']);
  assert.deepEqual(s.list('clear', 1).map(e => e.initials), ['BBB']);
  assert.deepEqual(s.list('endless', 0).map(e => e.initials), ['CCC']);
  // Endless and battle have no level axis, so any level lands in the same bucket.
  assert.equal(Scores.bucketKey('endless', 3), Scores.bucketKey('endless', 0));
  assert.notEqual(Scores.bucketKey('clear', 'custom'), Scores.bucketKey('clear', 0));
});

test('qualification tracks the weakest entry once the board is full', () => {
  const s = new Scores('');
  assert.equal(s.qualifies(1, 'clear', 0), true, 'an empty board takes anything');
  for (let i = 0; i < TOP_N; i++) s.submit({ initials:'AAA', score: 1000 + i, mode:'clear', level:0 });
  assert.equal(s.qualifies(999, 'clear', 0), false);
  assert.equal(s.qualifies(1000, 'clear', 0), false, 'matching the floor is not beating it');
  assert.equal(s.qualifies(5000, 'clear', 0), true);
});

test('submissions are validated and hostile input is rejected', () => {
  const s = new Scores('');
  assert.equal(Scores.cleanInitials(' ab '), 'AB');
  assert.equal(Scores.cleanInitials('a<b>c!!'), 'ABC', 'markup characters are stripped, not stored');
  assert.equal(Scores.cleanInitials('ABCDEFG'), 'ABC', 'truncated to three');
  for (const bad of ['', '  ', '!!!', null, undefined])
    assert.throws(() => Scores.cleanInitials(bad), /Initials/);
  for (const bad of [-1, 1.5, NaN, Infinity, 1e12, 'abc', null])
    assert.throws(() => s.submit({ initials:'AAA', score: bad, mode:'clear', level:0 }), /Score/);
  assert.throws(() => s.submit({ initials:'AAA', score:10, mode:'nope', level:0 }), /mode/i);
  assert.throws(() => s.submit({ initials:'AAA', score:10, mode:'clear', level:99 }), /level/i);
  assert.equal(s.list('clear', 0).length, 0, 'nothing invalid was stored');
});

test('a flood of submissions from one address is rate limited', () => {
  const s = new Scores('');
  for (let i = 0; i < 10; i++) s.submit({ initials:'AAA', score:i, mode:'clear', level:0 }, '1.2.3.4');
  assert.throws(() => s.submit({ initials:'AAA', score:99, mode:'clear', level:0 }, '1.2.3.4'), /Too many/);
  // A different client is unaffected.
  assert.ok(s.submit({ initials:'BBB', score:99, mode:'clear', level:0 }, '5.6.7.8'));
});

test('the table round-trips through its JSON file', () => {
  const file = tmpFile('scores.json');
  const a = new Scores(file);
  a.submit({ initials:'ADA', score:4200, mode:'clear', level:2 });
  a.submit({ initials:'BEN', score:900, mode:'battle', level:0 });
  assert.equal(a.flush(), true);
  const b = new Scores(file);
  assert.deepEqual(b.list('clear', 2).map(e => e.initials), ['ADA']);
  assert.equal(b.list('clear', 2)[0].score, 4200);
  assert.deepEqual(b.list('battle', 0).map(e => e.initials), ['BEN']);
  a.close(); b.close();
});

test('a corrupt or partly unreadable file never takes the server down', () => {
  const file = tmpFile('scores.json');
  fs.writeFileSync(file, 'not json at all');
  assert.equal(new Scores(file).list('clear', 0).length, 0, 'corrupt file starts empty');
  const mixed = tmpFile('mixed.json');
  fs.writeFileSync(mixed, JSON.stringify({ 'clear:0': [{ initials:'OK!', score:10 }, { initials:'', score:5 }, { initials:'BAD', score:-1 }] }));
  const s = new Scores(mixed);
  assert.deepEqual(s.list('clear', 0).map(e => e.initials), ['OK'], 'unreadable rows drop, the rest survive');
});

test('an unwritable path degrades to memory instead of failing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballshoot-scores-'));
  const s = new Scores(path.join(dir, 'scores.json'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(dir, 'now a file, so mkdir of the parent must fail');
  assert.equal(s.flush(), false);
  assert.equal(s.writable, false);
  // The board still works for the life of the process.
  s.submit({ initials:'AAA', score:10, mode:'clear', level:0 });
  assert.equal(s.list('clear', 0).length, 1);
});
