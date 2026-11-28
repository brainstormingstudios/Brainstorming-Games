/*
 * Neon Rift.io: the arena simulation. Runs on the server (a Durable Object per arena), which makes
 * every decision: movement, shots, hits, scores. Players only send what they press, so nobody can
 * cheat by changing their own game. Plain JavaScript with no Cloudflare parts, so tests run it.
 */

export const WORLD = 2600;
export const TICK = 1 / 20;
export const MAX_HUMANS = 12;
export const MIN_SHIPS = 10;
const ORB_TARGET = 260;
const POWER_MAX = 4;

export const STATS = ['dmg', 'rate', 'speed', 'hp', 'regen', 'range'];
export const STAT_MAX = 7;
export const LEVEL_MAX = 45;

/** Guns: barrels as [angle offset, side offset], with the shot's numbers. */
export const CLASSES = {
  blaster: { tier: 0, cd: 0.36, dmg: 10, speed: 640, life: 0.85, r: 6, pierce: 1, barrels: [[0, 0]] },
  twin: { tier: 1, cd: 0.3, dmg: 8, speed: 660, life: 0.85, r: 6, pierce: 1, barrels: [[0, -9], [0, 9]] },
  sniper: { tier: 1, cd: 0.85, dmg: 34, speed: 1050, life: 1.05, r: 7, pierce: 2, barrels: [[0, 0]] },
  gunner: { tier: 1, cd: 0.15, dmg: 5, speed: 620, life: 0.75, r: 5, pierce: 1, spread: 0.14, barrels: [[0, 0]] },
  hydra: { tier: 2, cd: 0.42, dmg: 9, speed: 650, life: 0.85, r: 6, pierce: 1, barrels: [[-0.36, 0], [-0.18, 0], [0, 0], [0.18, 0], [0.36, 0]] },
  rail: { tier: 2, cd: 1.05, dmg: 72, speed: 1500, life: 0.95, r: 8, pierce: 5, barrels: [[0, 0]] },
  storm: { tier: 2, cd: 0.13, dmg: 6, speed: 700, life: 0.8, r: 5, pierce: 1, spread: 0.08, barrels: [[0, -8], [0, 8]] },
  octo: { tier: 2, cd: 0.5, dmg: 10, speed: 620, life: 0.8, r: 6, pierce: 1, barrels: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i * Math.PI / 4, 0]) },
};
export const CLASS_CHOICES = { 1: ['twin', 'sniper', 'gunner'], 2: ['hydra', 'rail', 'storm', 'octo'] };
export const CLASS_LEVEL = { 1: 8, 2: 18 };

export const POWERS = ['shield', 'triple', 'speed', 'damage'];
const POWER_TIME = { shield: 6, triple: 9, speed: 9, damage: 9 };

const BOT_NAMES = ['Nova', 'Blaze', 'Volt', 'Rogue', 'Viper', 'Orbit', 'Pixel', 'Comet', 'Raptor', 'Zenith', 'Glitch', 'Turbo', 'Shadow', 'Falcon', 'Echo', 'Drift', 'Spark', 'Titan', 'Frost', 'Nitro', 'Laser', 'Storm', 'Bolt', 'Ace'];

export const xpFor = (level) => Math.floor(10 + level * 9 + level * level * 1.3);
export const radiusFor = (level) => 18 + Math.min(level, LEVEL_MAX) * 0.42;
/** Top speed in units per second. Bigger ships are a little slower. */
export const speedFor = (p) => (250 + p.stats.speed * 14) * (1 - Math.min(p.level, LEVEL_MAX) * 0.004) * (p.power === 'speed' ? 1.45 : 1);
export const maxHpFor = (p) => Math.round((100 + p.level * 4) * (1 + p.stats.hp * 0.15));

/** A small random generator with a seed, so the server and every player build the same rocks. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeRocks(seed) {
  const r = rng(seed);
  const rocks = [];
  let tries = 0;
  while (rocks.length < 16 && tries++ < 400) {
    const rock = { x: 200 + r() * (WORLD - 400), y: 200 + r() * (WORLD - 400), r: 45 + r() * 75 };
    if (rocks.some((o) => Math.hypot(o.x - rock.x, o.y - rock.y) < o.r + rock.r + 160)) continue;
    if (Math.hypot(rock.x - WORLD / 2, rock.y - WORLD / 2) < 220) continue;
    rocks.push({ x: Math.round(rock.x), y: Math.round(rock.y), r: Math.round(rock.r) });
  }
  return rocks;
}

/** Only letters, numbers, spaces and _ in names, 2–14 long; anything else becomes a guest name. */
export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[^A-Za-z0-9_ ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  return s.length >= 2 ? s : `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class ArenaSim {
  constructor(seed = Math.floor(Math.random() * 1e9), random = Math.random) {
    this.seed = seed;
    this.random = random;
    this.rocks = makeRocks(seed);
    this.players = new Map();
    this.bullets = [];
    this.orbs = new Map();
    this.powers = [];
    this.nextId = 1;
    this.time = 0;
    this.out = this.freshOut();
    this.powerT = 8;
    this.leaderId = 0;
    while (this.orbs.size < ORB_TARGET) this.spawnOrb();
  }

  freshOut() {
    return { bullets: [], hits: [], orbsAdd: [], orbsDel: [], events: [], powersChanged: false, rosterChanged: false };
  }

  /** What the tick produced, for sending; starts a new list. */
  takeOut() {
    const o = this.out;
    this.out = this.freshOut();
    return o;
  }

  id() { return this.nextId++; }
  rand(a, b) { return a + this.random() * (b - a); }

  freeSpot(radius) {
    for (let i = 0; i < 40; i++) {
      const x = this.rand(150, WORLD - 150), y = this.rand(150, WORLD - 150);
      if (this.rocks.some((k) => Math.hypot(k.x - x, k.y - y) < k.r + radius + 30)) continue;
      let near = false;
      for (const p of this.players.values()) if (p.alive && Math.hypot(p.x - x, p.y - y) < 420) { near = true; break; }
      if (!near || i > 30) return { x, y };
    }
    return { x: WORLD / 2, y: WORLD / 2 };
  }

  spawnOrb(x, y, v) {
    const value = v ?? (this.random() < 0.06 ? 10 : this.random() < 0.25 ? 3 : 1);
    let px = x, py = y;
    if (px == null) {
      const s = this.freeSpot(10);
      px = s.x; py = s.y;
    }
    const orb = { id: this.id(), x: Math.round(clamp(px, 20, WORLD - 20)), y: Math.round(clamp(py, 20, WORLD - 20)), v: value };
    this.orbs.set(orb.id, orb);
    this.out.orbsAdd.push([orb.id, orb.x, orb.y, orb.v]);
    return orb;
  }

  addPlayer(name, bot = false) {
    const p = {
      id: this.id(), name: cleanName(name), bot, color: Math.floor(this.random() * 8),
      x: 0, y: 0, vx: 0, vy: 0, a: 0, hp: 100, maxHp: 100, level: 1, xp: 0, score: 0, kills: 0, streak: 0, bestStreak: 0,
      stats: { dmg: 0, rate: 0, speed: 0, hp: 0, regen: 0, range: 0 }, points: 0, cls: 'blaster', tier: 0,
      input: { mx: 0, my: 0, a: 0, fire: false }, cd: 0, boostCd: 0, boostT: 0, power: null, powerT: 0, shieldT: 0,
      sinceHurt: 99, alive: false, respawnT: 0, lastHitBy: 0, emote: -1, emoteT: 0, joinedAt: this.time, diedAt: 0,
      ai: bot ? { t: 0, target: 0, wander: this.rand(0, Math.PI * 2), skill: this.rand(0.5, 1), retarget: 0 } : null,
    };
    this.players.set(p.id, p);
    this.spawn(p);
    this.out.rosterChanged = true;
    return p;
  }

  removePlayer(id) {
    if (this.players.delete(id)) this.out.rosterChanged = true;
  }

  spawn(p) {
    const s = this.freeSpot(30);
    Object.assign(p, {
      x: s.x, y: s.y, vx: 0, vy: 0, level: 1, xp: 0, score: 0, kills: 0, streak: 0, points: 0, cls: 'blaster', tier: 0,
      stats: { dmg: 0, rate: 0, speed: 0, hp: 0, regen: 0, range: 0 }, cd: 0.5, boostCd: 0, boostT: 0,
      power: null, powerT: 0, shieldT: 3, sinceHurt: 99, alive: true, lastHitBy: 0,
    });
    p.maxHp = maxHpFor(p);
    p.hp = p.maxHp;
  }

  humans() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }

  /** Keeps the arena lively: bots fill up to MIN_SHIPS and leave as people arrive. */
  balanceBots() {
    const total = this.players.size, humans = this.humans();
    if (humans === 0) return;
    if (total < MIN_SHIPS) this.addPlayer(BOT_NAMES[Math.floor(this.random() * BOT_NAMES.length)] + Math.floor(this.rand(1, 99)), true);
    else if (total > MIN_SHIPS) {
      // Remove a dead (or the weakest) bot so a person's place is free.
      let pick = null;
      for (const p of this.players.values()) if (p.bot && (!pick || (!p.alive && pick.alive) || p.score < pick.score)) pick = p;
      if (pick) this.removePlayer(pick.id);
    }
  }

  // ---------- Input from a player ----------
  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    const mx = clamp(Number(msg.mx) || 0, -1, 1), my = clamp(Number(msg.my) || 0, -1, 1);
    const len = Math.hypot(mx, my);
    p.input.mx = len > 1 ? mx / len : mx;
    p.input.my = len > 1 ? my / len : my;
    const a = Number(msg.a);
    if (Number.isFinite(a)) p.input.a = a;
    p.input.fire = !!msg.f;
  }
  boost(id) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.boostCd > 0) return;
    p.boostCd = 3.5;
    p.boostT = 0.22;
    const len = Math.hypot(p.input.mx, p.input.my);
    const dx = len > 0.1 ? p.input.mx / len : Math.cos(p.input.a), dy = len > 0.1 ? p.input.my / len : Math.sin(p.input.a);
    p.vx = dx * speedFor(p) * 2.6;
    p.vy = dy * speedFor(p) * 2.6;
    this.out.events.push(['boost', p.id]);
  }
  upgrade(id, stat) {
    const p = this.players.get(id);
    if (!p || p.points <= 0 || !STATS.includes(stat) || p.stats[stat] >= STAT_MAX) return;
    p.stats[stat]++;
    p.points--;
    if (stat === 'hp') { const old = p.maxHp; p.maxHp = maxHpFor(p); p.hp += p.maxHp - old; }
  }
  chooseClass(id, cls) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const def = CLASSES[cls];
    if (!def || def.tier !== p.tier + 1 || p.level < CLASS_LEVEL[def.tier]) return;
    p.cls = cls;
    p.tier = def.tier;
    this.out.events.push(['class', p.id, cls]);
  }
  respawn(id) {
    const p = this.players.get(id);
    if (p && !p.alive && this.time - p.diedAt >= 2) this.spawn(p);
  }
  emote(id, e) {
    const p = this.players.get(id);
    if (!p || !p.alive || p.emoteT > 0) return;
    const n = Number(e);
    if (!(n >= 0 && n <= 5)) return;
    p.emote = n;
    p.emoteT = 2.5;
  }

  // ---------- One step ----------
  tick(dt = TICK) {
    this.time += dt;
    for (const p of this.players.values()) {
      if (p.bot) this.think(p, dt);
      if (p.alive) this.movePlayer(p, dt);
      else if (p.bot && this.time - p.diedAt > 3) this.spawn(p);
      if (p.emoteT > 0 && (p.emoteT -= dt) <= 0) p.emote = -1;
    }
    this.collidePlayers();
    for (const p of this.players.values()) if (p.alive) this.fire(p, dt);
    this.moveBullets(dt);
    this.eatOrbs();
    this.updatePowers(dt);
    this.updateLeader();
    if (Math.floor(this.time) !== Math.floor(this.time - dt)) this.balanceBots();
  }

  movePlayer(p, dt) {
    const top = speedFor(p);
    if (p.boostT > 0) p.boostT -= dt;
    else {
      const k = Math.min(1, dt * 7);
      p.vx += (p.input.mx * top - p.vx) * k;
      p.vy += (p.input.my * top - p.vy) * k;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.a = p.input.a;
    const r = radiusFor(p.level);
    p.x = clamp(p.x, r, WORLD - r);
    p.y = clamp(p.y, r, WORLD - r);
    for (const k of this.rocks) {
      const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy), min = k.r + r;
      if (d < min && d > 0.01) { p.x = k.x + (dx / d) * min; p.y = k.y + (dy / d) * min; }
    }
    p.cd -= dt;
    if (p.boostCd > 0) p.boostCd -= dt;
    if (p.shieldT > 0) p.shieldT -= dt;
    if (p.power && (p.powerT -= dt) <= 0) p.power = null;
    p.sinceHurt += dt;
    if (p.sinceHurt > 4 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.012 * (1 + p.stats.regen * 0.55) * dt * 4);
  }

  collidePlayers() {
    const list = [...this.players.values()].filter((p) => p.alive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = radiusFor(a.level) + radiusFor(b.level);
        if (d < min && d > 0.01) {
          const push = (min - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        }
      }
    }
  }

  fire(p, dt) {
    if (!p.input.fire || p.cd > 0) return;
    const def = CLASSES[p.cls];
    p.cd = def.cd * (1 - p.stats.rate * 0.075);
    const r = radiusFor(p.level);
    const dmg = def.dmg * (1 + p.stats.dmg * 0.13) * (p.power === 'damage' ? 2 : 1) * (1 + (p.level - 1) * 0.012);
    const speed = def.speed * (1 + p.stats.range * 0.08);
    const life = def.life * (1 + p.stats.range * 0.06);
    const extra = p.power === 'triple' ? [-0.22, 0, 0.22] : [0];
    for (const [off, side] of def.barrels) {
      for (const ex of extra) {
        const a = p.a + off + ex + (def.spread ? this.rand(-def.spread, def.spread) : 0);
        const sx = Math.cos(p.a + Math.PI / 2) * side, sy = Math.sin(p.a + Math.PI / 2) * side;
        const b = {
          id: this.id(), owner: p.id, x: p.x + Math.cos(a) * r + sx, y: p.y + Math.sin(a) * r + sy,
          vx: Math.cos(a) * speed + p.vx * 0.3, vy: Math.sin(a) * speed + p.vy * 0.3,
          r: def.r, dmg, life, pierce: def.pierce, hit: [],
        };
        this.bullets.push(b);
        this.out.bullets.push([b.id, b.owner, Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy), b.r, Math.round(b.life * 100)]);
      }
    }
    // A little kick back makes heavy guns feel heavy.
    const kick = def.dmg > 30 ? 90 : 18;
    p.vx -= Math.cos(p.a) * kick;
    p.vy -= Math.sin(p.a) * kick;
    void dt;
  }

  moveBullets(dt) {
    const alive = [...this.players.values()].filter((p) => p.alive);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let gone = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > WORLD || b.y > WORLD;
      if (!gone) for (const k of this.rocks) if (Math.hypot(b.x - k.x, b.y - k.y) < k.r + b.r) { gone = true; this.out.hits.push([b.id, 0]); break; }
      if (!gone) {
        for (const p of alive) {
          if (p.id === b.owner || !p.alive || b.hit.includes(p.id)) continue;
          const rr = radiusFor(p.level) + b.r;
          if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < rr * rr) {
            b.hit.push(p.id);
            this.hurt(p, b.dmg, b.owner, b.vx, b.vy);
            this.out.hits.push([b.id, p.id]);
            if (--b.pierce <= 0) { gone = true; break; }
          }
        }
      }
      if (gone) { const last = this.bullets.pop(); if (i < this.bullets.length) this.bullets[i] = last; }
    }
  }

  hurt(p, dmg, by, vx, vy) {
    if (p.shieldT > 0 || p.power === 'shield') { this.out.events.push(['block', p.id]); return; }
    p.hp -= dmg;
    p.sinceHurt = 0;
    p.lastHitBy = by;
    const sp = Math.hypot(vx, vy) || 1;
    p.vx += (vx / sp) * Math.min(160, dmg * 4);
    p.vy += (vy / sp) * Math.min(160, dmg * 4);
    this.out.events.push(['dmg', p.id, Math.round(dmg)]);
    if (p.hp <= 0) this.kill(p, by);
  }

  kill(p, by) {
    p.alive = false;
    p.hp = 0;
    p.diedAt = this.time;
    const killer = this.players.get(by);
    const wasLeader = p.id === this.leaderId && this.players.size > 2;
    // The wreck spills part of its XP as orbs.
    const spill = Math.min(60, 6 + Math.floor(p.level * 1.6));
    for (let i = 0; i < spill; i++) {
      const a = this.rand(0, Math.PI * 2), d = this.rand(10, 70 + p.level * 3);
      this.spawnOrb(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, i % 6 === 0 ? 10 : 3);
    }
    let bonus = 0;
    if (killer && killer.alive) {
      killer.kills++;
      killer.streak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      bonus = 50 + Math.floor(p.score * 0.25) + (wasLeader ? 500 : 0);
      killer.score += bonus;
      this.gainXp(killer, 12 * p.level);
      killer.hp = Math.min(killer.maxHp, killer.hp + killer.maxHp * 0.15);
    }
    this.out.events.push(['kill', by || 0, p.id, killer ? killer.streak : 0, wasLeader ? 1 : 0, bonus]);
    p.streak = 0;
  }

  gainXp(p, v) {
    p.xp += v;
    p.score += v;
    while (p.level < LEVEL_MAX && p.xp >= xpFor(p.level)) {
      p.xp -= xpFor(p.level);
      p.level++;
      p.points++;
      const old = p.maxHp;
      p.maxHp = maxHpFor(p);
      p.hp += p.maxHp - old;
      this.out.events.push(['level', p.id, p.level]);
    }
    if (p.level >= LEVEL_MAX) p.xp = Math.min(p.xp, xpFor(p.level));
  }

  eatOrbs() {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const reach = radiusFor(p.level) + 26;
      for (const o of this.orbs.values()) {
        const dx = o.x - p.x;
        if (dx > reach || dx < -reach) continue;
        const dy = o.y - p.y;
        if (dy > reach || dy < -reach || dx * dx + dy * dy > reach * reach) continue;
        this.orbs.delete(o.id);
        this.out.orbsDel.push([o.id, p.id]);
        this.gainXp(p, o.v);
      }
    }
    let n = 0;
    while (this.orbs.size < ORB_TARGET && n++ < 12) this.spawnOrb();
  }

  updatePowers(dt) {
    this.powerT -= dt;
    if (this.powerT <= 0 && this.powers.length < POWER_MAX) {
      this.powerT = this.rand(10, 16);
      const s = this.freeSpot(20);
      this.powers.push({ id: this.id(), kind: POWERS[Math.floor(this.random() * POWERS.length)], x: Math.round(s.x), y: Math.round(s.y) });
      this.out.powersChanged = true;
    }
    for (let i = this.powers.length - 1; i >= 0; i--) {
      const w = this.powers[i];
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const rr = radiusFor(p.level) + 22;
        if ((w.x - p.x) ** 2 + (w.y - p.y) ** 2 < rr * rr) {
          p.power = w.kind;
          p.powerT = POWER_TIME[w.kind];
          this.powers.splice(i, 1);
          this.out.powersChanged = true;
          this.out.events.push(['power', p.id, w.kind]);
          break;
        }
      }
    }
  }

  updateLeader() {
    let best = null;
    for (const p of this.players.values()) if (p.alive && (!best || p.score > best.score)) best = p;
    const id = best && best.score > 0 ? best.id : 0;
    if (id !== this.leaderId) { this.leaderId = id; this.out.events.push(['leader', id]); }
  }

  // ---------- Bots ----------
  think(p, dt) {
    if (!p.alive) return;
    const ai = p.ai;
    ai.retarget -= dt;
    // Spend points and pick classes like a player would.
    if (p.points > 0) {
      const order = ['dmg', 'rate', 'speed', 'hp', 'range', 'regen'];
      const s = order.find((k, i) => p.stats[k] < STAT_MAX && this.random() < 0.55 + i * 0.05) || order.find((k) => p.stats[k] < STAT_MAX);
      if (s) this.upgrade(p.id, s);
    }
    const next = CLASS_CHOICES[p.tier + 1];
    if (next && p.level >= CLASS_LEVEL[p.tier + 1]) this.chooseClass(p.id, next[Math.floor(this.random() * next.length)]);

    if (ai.retarget <= 0) {
      ai.retarget = this.rand(0.4, 0.9);
      let target = null, bestD = 560 * 560;
      for (const o of this.players.values()) {
        if (o === p || !o.alive || (o.bot && this.random() < 0.35)) continue;
        const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
        if (d < bestD) { bestD = d; target = o; }
      }
      ai.target = target ? target.id : 0;
    }
    const t = this.players.get(ai.target);
    let mx = 0, my = 0, fire = false, aim = p.a;
    if (t && t.alive) {
      const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
      const def = CLASSES[p.cls];
      const lead = d / (def.speed * (1 + p.stats.range * 0.08));
      const ex = t.x + t.vx * lead * ai.skill, ey = t.y + t.vy * lead * ai.skill;
      aim = Math.atan2(ey - p.y, ex - p.x) + this.rand(-0.18, 0.18) * (1.3 - ai.skill);
      fire = d < 520;
      const weak = p.hp < p.maxHp * 0.3 && t.hp > p.hp;
      const keep = def.dmg > 30 ? 420 : 260;
      if (weak) { mx = -dx / d; my = -dy / d; if (p.boostCd <= 0 && this.random() < 0.05) this.boost(p.id); }
      else if (d > keep + 60) { mx = dx / d; my = dy / d; }
      else if (d < keep - 60) { mx = -dx / d; my = -dy / d; }
      // Strafe sideways so shots are harder to land.
      const side = Math.sin(this.time * 1.3 + p.id) > 0 ? 1 : -1;
      mx += (-dy / d) * side * 0.7; my += (dx / d) * side * 0.7;
    } else {
      // No one near: collect orbs or power-ups, or wander.
      let goal = null, bestD = 700 * 700;
      for (const w of this.powers) { const d = (w.x - p.x) ** 2 + (w.y - p.y) ** 2; if (d < bestD) { bestD = d; goal = w; } }
      if (!goal) {
        let c = 0;
        for (const o of this.orbs.values()) {
          if (++c > 120) break;
          const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2 - o.v * 3000;
          if (d < bestD) { bestD = d; goal = o; }
        }
      }
      if (goal) { const dx = goal.x - p.x, dy = goal.y - p.y, d = Math.hypot(dx, dy) || 1; mx = dx / d; my = dy / d; aim = Math.atan2(dy, dx); }
      else { ai.wander += this.rand(-0.3, 0.3); mx = Math.cos(ai.wander); my = Math.sin(ai.wander); aim = ai.wander; }
    }
    // Steer away from the edges.
    if (p.x < 200) mx += 1; if (p.x > WORLD - 200) mx -= 1;
    if (p.y < 200) my += 1; if (p.y > WORLD - 200) my -= 1;
    const len = Math.hypot(mx, my) || 1;
    p.input.mx = mx / Math.max(1, len);
    p.input.my = my / Math.max(1, len);
    p.input.a = aim;
    p.input.fire = fire;
  }

  // ---------- What players are sent ----------
  roster() {
    return [...this.players.values()].map((p) => [p.id, p.name, p.color, p.bot ? 1 : 0]);
  }
  /** Every ship, compact: id, x, y, aim, hp%, level, class, flags, emote. */
  snapshot() {
    const ships = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const flags = (p.shieldT > 0 || p.power === 'shield' ? 1 : 0) | (p.boostT > 0 ? 2 : 0) | (p.id === this.leaderId ? 4 : 0) | (p.power === 'triple' ? 8 : 0) | (p.power === 'speed' ? 16 : 0) | (p.power === 'damage' ? 32 : 0);
      ships.push([p.id, Math.round(p.x), Math.round(p.y), Math.round(p.a * 100) / 100, Math.round((p.hp / p.maxHp) * 100), p.level, p.cls, flags, p.emote]);
    }
    return ships;
  }
  /** The private part only the player sees. */
  me(id) {
    const p = this.players.get(id);
    if (!p) return null;
    const next = CLASS_CHOICES[p.tier + 1];
    return {
      alive: p.alive, hp: Math.round(p.hp), maxHp: p.maxHp, level: p.level, xp: Math.floor(p.xp), next: xpFor(p.level), points: p.points,
      stats: p.stats, score: Math.floor(p.score), kills: p.kills, streak: p.streak, boostCd: Math.max(0, Math.round(p.boostCd * 10) / 10),
      cls: p.cls, choose: next && p.level >= CLASS_LEVEL[p.tier + 1] ? next : null, power: p.power, powerT: Math.ceil(p.powerT),
      vx: Math.round(p.vx), vy: Math.round(p.vy), speed: Math.round(speedFor(p)),
    };
  }
  leaderboard() {
    return [...this.players.values()].sort((a, b) => b.score - a.score).slice(0, 10).map((p) => [p.id, Math.floor(p.score)]);
  }
}
