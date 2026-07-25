'use strict';

/* Arcade-style high score table.
   Buckets are keyed by (mode, level) so "The Vault" and "Endless" keep separate boards.
   The whole table lives in memory and is flushed to a single JSON file on a debounce;
   if that path is unwritable the server still runs, it just forgets on restart.

   NOTE: submission is deliberately unauthenticated — anyone who can reach the endpoint
   can post any score. Validation and rate limiting below bound the damage, but this is
   a wall of initials, not an audited record. Do not build anything on top of it that
   needs the numbers to be true. */

const fs = require('node:fs');
const path = require('node:path');

const TOP_N = 20;
const MAX_SCORE = 100_000_000;
const MODES = ['clear', 'endless', 'battle'];
const INITIALS = /^[A-Z0-9]{1,3}$/;
const WRITE_DEBOUNCE_MS = 750;

const fail = (code, message) => Object.assign(new Error(message), { code });

class Scores {
  constructor(file = process.env.SCORES_PATH || '') {
    this.file = file;
    this.buckets = new Map();
    this.writable = !!file;
    this.timer = null;
    this.hits = new Map();
    this.load();
  }

  /* ---------- keys + validation ---------- */
  static bucketKey(mode, level) {
    if (!MODES.includes(mode)) throw fail('bad_bucket', 'Unknown mode.');
    // Endless and battle have no level dimension; custom boards share one bucket.
    if (mode !== 'clear') return `${mode}:-`;
    if (level === 'custom') return `${mode}:custom`;
    const n = Number(level);
    if (!Number.isInteger(n) || n < 0 || n > 3) throw fail('bad_bucket', 'Unknown level.');
    return `${mode}:${n}`;
  }
  static cleanInitials(value) {
    const v = String(value == null ? '' : value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (!INITIALS.test(v)) throw fail('bad_initials', 'Initials must be 1-3 letters or digits.');
    return v;
  }
  static cleanScore(value) {
    // Number(null), Number('') and Number([]) are all 0, so reject anything that is not
    // plainly a number or a non-empty numeric string before coercing.
    if (typeof value !== 'number' && typeof value !== 'string') throw fail('bad_score', 'Score must be a number.');
    if (typeof value === 'string' && !value.trim()) throw fail('bad_score', 'Score must be a number.');
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > MAX_SCORE) throw fail('bad_score', 'Score out of range.');
    return n;
  }

  /* ---------- reads ---------- */
  list(mode, level) { return (this.buckets.get(Scores.bucketKey(mode, level)) || []).map(e => ({ ...e })); }
  /* A run qualifies while the board has room, or once it beats the weakest entry. */
  qualifies(score, mode, level) {
    const n = Scores.cleanScore(score), rows = this.buckets.get(Scores.bucketKey(mode, level)) || [];
    if (rows.length < TOP_N) return true;
    return n > rows[rows.length - 1].score;
  }

  /* ---------- writes ---------- */
  rateLimit(address, max = 10, windowMs = 60_000) {
    const now = Date.now(), key = String(address || 'unknown');
    const hits = (this.hits.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) throw fail('rate_limited', 'Too many submissions. Try again shortly.');
    hits.push(now); this.hits.set(key, hits);
    if (this.hits.size > 4000) this.hits.clear();
  }
  submit({ initials, score, mode, level }, address) {
    if (address !== undefined) this.rateLimit(address);
    const key = Scores.bucketKey(mode, level);
    const entry = { initials: Scores.cleanInitials(initials), score: Scores.cleanScore(score), at: Date.now() };
    const rows = this.buckets.get(key) || [];
    rows.push(entry);
    // Ties keep the earlier run ahead, so a repeat of the same score can't displace it.
    rows.sort((a, b) => b.score - a.score || a.at - b.at);
    rows.length = Math.min(rows.length, TOP_N);
    this.buckets.set(key, rows);
    this.schedule();
    return { rank: rows.indexOf(entry) + 1, entries: rows.map(e => ({ ...e })) };
  }

  /* ---------- persistence ---------- */
  load() {
    if (!this.file) return;
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); }
    catch (e) {
      // Missing file is the normal first-boot case; anything else means we cannot read
      // the volume, so fall back to memory rather than refusing to start.
      if (e.code !== 'ENOENT') this.writable = false;
      return;
    }
    try {
      const data = JSON.parse(raw);
      for (const [key, rows] of Object.entries(data || {})) {
        if (!Array.isArray(rows)) continue;
        const clean = [];
        for (const row of rows) {
          try {
            clean.push({ initials: Scores.cleanInitials(row?.initials), score: Scores.cleanScore(row?.score), at: Number(row?.at) || 0 });
          } catch (err) { /* drop unreadable rows rather than losing the whole file */ }
        }
        clean.sort((a, b) => b.score - a.score || a.at - b.at);
        clean.length = Math.min(clean.length, TOP_N);
        if (clean.length) this.buckets.set(key, clean);
      }
    } catch (e) { /* corrupt file: start empty, the next flush overwrites it */ }
  }
  schedule() {
    if (!this.writable || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, WRITE_DEBOUNCE_MS);
    this.timer.unref?.();
  }
  flush() {
    if (!this.writable) return false;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.buckets)));
      fs.renameSync(tmp, this.file); // atomic: readers never see a half-written table
      return true;
    } catch (e) {
      this.writable = false; // one failure is enough; keep serving from memory
      try { fs.unlinkSync(tmp); } catch (err) {}
      return false;
    }
  }
  close() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.flush(); }
}

module.exports = { Scores, TOP_N, MAX_SCORE, fail };
