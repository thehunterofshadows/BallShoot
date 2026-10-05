'use strict';

/* Player profiles: names, lifetime stats, per-campaign level progress and co-op pair
   history. This process is the source of truth; browsers only cache what it returns.

   Identity is a stable random id. Names are display data (unique, case-insensitive) and are
   never used as keys, so a rename keeps every record attached. Clients submit one round at a
   time, validated and capped by CoopProfiles.cleanRound; totals are only ever computed here,
   and a roundId already applied is acknowledged without being applied again, which makes
   retries and reconnect resubmits safe.

   Storage is the same shape as the leaderboard: in memory, flushed atomically to one JSON
   file on a short debounce; an unwritable path degrades to memory instead of failing. Like
   the leaderboard there is no authentication — this is couch identity, not an account. */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const P = require('../coop-profiles');
const { LEVELS, COOP2_LEVELS, CAMPAIGNS } = require('./game');

const WRITE_DEBOUNCE_MS = 250;
const MAX_PROFILES = 500;
const ROUND_MEMORY = 20_000; // applied roundIds remembered for de-duplication
const { fail } = P;

const levelCount = campaign => !CAMPAIGNS[campaign] ? 0 : campaign === 'coop2' ? COOP2_LEVELS.length : LEVELS.length;
const blankStats = rules => Object.fromEntries(Object.keys(rules).map(k => [k, 0]));

class Profiles {
  constructor(file = process.env.PROFILES_PATH || '') {
    this.file = file;
    this.writable = !!file;
    this.timer = null;
    this.hits = new Map();
    this.profiles = new Map(); // id -> { id, name, createdAt, updatedAt }
    this.stats = new Map();    // id -> lifetime counters/bests
    this.progress = new Map(); // id -> { campaign: { level: record } }
    this.pairs = new Map();    // pairKey -> { ids:[a,b], stats, levels:[ 'campaign:level' ] }
    this.rounds = new Map();   // roundId -> applied-at, oldest first
    this.load();
  }

  /* ---------- reads ---------- */
  findByName(name) {
    const key = P.nameKey(name);
    for (const p of this.profiles.values()) if (P.nameKey(p.name) === key) return p;
    return null;
  }
  get(id) {
    const p = this.profiles.get(String(id || ''));
    if (!p) throw fail('not_found', 'That player no longer exists.');
    return p;
  }
  summary(id) {
    const p = this.get(id), s = this.stats.get(id) || {};
    return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt,
      score: s.score || 0, rounds: s.rounds || 0, wins: s.wins || 0, levelsCompleted: this.completedCount(id) };
  }
  list() {
    return [...this.profiles.keys()].map(id => this.summary(id))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }
  completedCount(id) {
    let n = 0;
    for (const levels of Object.values(this.progress.get(id) || {})) for (const r of Object.values(levels)) if (r.completed) n++;
    return n;
  }
  campaignProgress(id) {
    const all = this.progress.get(id) || {}, out = {};
    for (const campaign of Object.keys(CAMPAIGNS)) {
      const levels = all[campaign] || {}, done = Object.keys(levels).filter(k => levels[k].completed).map(Number);
      out[campaign] = { name: CAMPAIGNS[campaign].name || campaign, total: levelCount(campaign), completed: done.length,
        highest: done.length ? Math.max(...done) : -1, levels: structuredClone(levels) };
    }
    return out;
  }
  partners(id) {
    const out = [];
    for (const pair of this.pairs.values()) {
      if (!pair.ids.includes(id)) continue;
      const other = this.profiles.get(pair.ids[0] === id ? pair.ids[1] : pair.ids[0]);
      if (other) out.push({ id: other.id, name: other.name, ...blankStats(P.PAIR), ...pair.stats, levelsTogether: pair.levels.length });
    }
    return out.sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name));
  }
  detail(id) {
    const s = this.summary(id);
    return { profile: { id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt },
      stats: { ...blankStats(P.LIFETIME), ...(this.stats.get(id) || {}), levelsCompleted: s.levelsCompleted },
      campaigns: this.campaignProgress(id), partners: this.partners(id) };
  }

  /* ---------- profile writes ---------- */
  rateLimit(address, bucket, max, windowMs = 60_000) {
    if (address === undefined) return;
    const now = Date.now(), key = bucket + ':' + String(address || 'unknown');
    const hits = (this.hits.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) throw fail('rate_limited', 'Too many requests. Try again shortly.');
    hits.push(now); this.hits.set(key, hits);
    if (this.hits.size > 4000) this.hits.clear();
  }
  create(rawName, address) {
    this.rateLimit(address, 'name', 20);
    const name = P.cleanName(rawName);
    if (this.findByName(name)) throw fail('name_taken', P.NAME_TAKEN);
    if (this.profiles.size >= MAX_PROFILES) throw fail('too_many', 'This server has reached its player limit.');
    const now = Date.now(), p = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
    this.profiles.set(p.id, p);
    this.stats.set(p.id, blankStats(P.LIFETIME));
    this.schedule();
    return this.summary(p.id);
  }
  rename(id, rawName, address) {
    this.rateLimit(address, 'name', 20);
    const p = this.get(id), name = P.cleanName(rawName), clash = this.findByName(name);
    if (clash && clash.id !== p.id) throw fail('name_taken', P.NAME_TAKEN);
    p.name = name; p.updatedAt = Date.now();
    this.schedule();
    return this.summary(p.id);
  }
  /* Removes the player and every record keyed by them, including pair history; the other
     player's own stats and progress are untouched. */
  remove(id) {
    const p = this.get(id);
    this.profiles.delete(p.id); this.stats.delete(p.id); this.progress.delete(p.id);
    for (const [k, pair] of this.pairs) if (pair.ids.includes(p.id)) this.pairs.delete(k);
    this.schedule();
    return { id: p.id };
  }

  /* ---------- round results ---------- */
  record(raw, address) {
    this.rateLimit(address, 'round', 120);
    const round = P.cleanRound(raw, levelCount);
    if (this.rounds.has(round.roundId)) return { duplicate: true, profiles: this.summariesFor(round.players) };
    // A profile deleted mid-round simply drops out; the rest of the team still saves.
    const players = round.players.filter(p => this.profiles.has(p.profileId));
    const now = Date.now();
    for (const p of players) {
      const id = p.profileId;
      this.stats.set(id, P.applyStats(P.LIFETIME, this.stats.get(id) || {}, round, [p]));
      if (round.level !== null) {
        const byCampaign = this.progress.get(id) || {}, levels = byCampaign[round.campaign] || (byCampaign[round.campaign] = {});
        const rec = levels[round.level] || (levels[round.level] = { completed: false, firstAt: null, bestScore: 0, bestSecs: null, clears: 0, attempts: 0 });
        rec.attempts++;
        if (round.won) {
          if (!rec.completed) { rec.completed = true; rec.firstAt = now; }
          rec.clears++;
          rec.bestScore = Math.max(rec.bestScore, round.teamScore);
          rec.bestSecs = rec.bestSecs === null ? round.secs : Math.min(rec.bestSecs, round.secs);
        }
        this.progress.set(id, byCampaign);
      }
      this.profiles.get(id).updatedAt = now;
    }
    for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j], key = P.pairKey(a.profileId, b.profileId);
      const pair = this.pairs.get(key) || { ids: [a.profileId, b.profileId].sort(), stats: {}, levels: [] };
      P.applyStats(P.PAIR, pair.stats, round, [a, b]);
      const lv = round.campaign + ':' + round.level;
      if (round.won && round.level !== null && !pair.levels.includes(lv)) pair.levels.push(lv);
      this.pairs.set(key, pair);
    }
    this.rounds.set(round.roundId, now);
    while (this.rounds.size > ROUND_MEMORY) this.rounds.delete(this.rounds.keys().next().value);
    this.schedule();
    return { duplicate: false, profiles: this.summariesFor(players) };
  }
  summariesFor(players) { return players.filter(p => this.profiles.has(p.profileId)).map(p => this.summary(p.profileId)); }

  /* ---------- persistence ---------- */
  toJSON() {
    return { version: 1, profiles: [...this.profiles.values()], stats: Object.fromEntries(this.stats),
      progress: Object.fromEntries(this.progress), pairs: Object.fromEntries(this.pairs), rounds: [...this.rounds] };
  }
  load() {
    if (!this.file) return;
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') this.writable = false; return; }
    let data;
    try { data = JSON.parse(raw) || {}; } catch (e) { return; } // corrupt: start empty, next flush replaces it
    const names = new Set();
    for (const p of Array.isArray(data.profiles) ? data.profiles : []) {
      try {
        const name = P.cleanName(p.name), key = P.nameKey(name), id = String(p.id || '');
        if (!id || names.has(key) || this.profiles.has(id)) continue;
        names.add(key);
        this.profiles.set(id, { id, name, createdAt: Number(p.createdAt) || 0, updatedAt: Number(p.updatedAt) || 0 });
      } catch (err) { /* drop an unreadable profile rather than the whole file */ }
    }
    const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    for (const id of this.profiles.keys()) {
      this.stats.set(id, { ...blankStats(P.LIFETIME), ...obj(obj(data.stats)[id]) });
      if (data.progress && data.progress[id]) this.progress.set(id, obj(data.progress[id]));
    }
    for (const [k, pair] of Object.entries(obj(data.pairs))) {
      if (!pair || !Array.isArray(pair.ids) || !pair.ids.every(id => this.profiles.has(id))) continue;
      this.pairs.set(k, { ids: pair.ids, stats: obj(pair.stats), levels: Array.isArray(pair.levels) ? pair.levels : [] });
    }
    for (const entry of Array.isArray(data.rounds) ? data.rounds : []) if (Array.isArray(entry)) this.rounds.set(String(entry[0]), Number(entry[1]) || 0);
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
      fs.writeFileSync(tmp, JSON.stringify(this.toJSON()));
      fs.renameSync(tmp, this.file); // atomic: a crash never leaves a half-written store
      return true;
    } catch (e) {
      this.writable = false;
      try { fs.unlinkSync(tmp); } catch (err) {}
      return false;
    }
  }
  close() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.flush(); }
}

module.exports = { Profiles, levelCount, MAX_PROFILES };
