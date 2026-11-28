import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module shared with the Cloudflare Worker
import { ArenaSim, CLASS_LEVEL, MIN_SHIPS, WORLD, cleanName, makeRocks, rng, xpFor } from '../../workers/rooms/sim.mjs';
// @ts-expect-error plain JS module (the Worker entry)
import { originAllowed } from '../../workers/rooms/index.mjs';

type Sim = InstanceType<typeof ArenaSim>;
const run = (sim: Sim, seconds: number) => { for (let i = 0; i < seconds * 20; i++) sim.tick(1 / 20); };

describe('Neon Rift arena', () => {
  it('fills the arena with bots that fight, die, respawn and keep everything in bounds', () => {
    const sim: Sim = new ArenaSim(42, rng(7));
    const me = sim.addPlayer('Hayaan', false);
    run(sim, 120);
    expect(sim.players.size).toBe(MIN_SHIPS);
    let kills = 0;
    for (const p of sim.players.values()) {
      kills += p.kills;
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(WORLD);
    }
    expect(kills).toBeGreaterThan(0);
    expect(sim.orbs.size).toBeGreaterThan(200);
    expect(sim.me(me.id)).toMatchObject({ level: expect.any(Number) });
  });

  it('makes room for people by removing bots', () => {
    const sim: Sim = new ArenaSim(1, rng(1));
    sim.addPlayer('a', false);
    run(sim, 12);
    expect(sim.players.size).toBe(MIN_SHIPS);
    for (let i = 0; i < 4; i++) sim.addPlayer(`p${i}`, false);
    run(sim, 6);
    expect(sim.players.size).toBe(MIN_SHIPS);
    expect(sim.humans()).toBe(5);
  });

  it('ignores impossible input: huge moves, unknown stats, classes too early', () => {
    const sim: Sim = new ArenaSim(3, rng(3));
    const p = sim.addPlayer('x', false);
    sim.setInput(p.id, { mx: 999, my: -999, a: 1, f: 1 });
    expect(Math.hypot(p.input.mx, p.input.my)).toBeLessThanOrEqual(1.0001);
    sim.upgrade(p.id, '__proto__');
    sim.upgrade(p.id, 'dmg');
    expect(p.stats.dmg).toBe(0);
    sim.chooseClass(p.id, 'rail');
    expect(p.cls).toBe('blaster');
    sim.gainXp(p, Array.from({ length: CLASS_LEVEL[1] }, (_, i) => xpFor(i + 1)).reduce((a, b) => a + b, 0));
    expect(p.level).toBeGreaterThanOrEqual(CLASS_LEVEL[1]);
    sim.chooseClass(p.id, 'rail');
    expect(p.cls).toBe('blaster');
    sim.chooseClass(p.id, 'sniper');
    expect(p.cls).toBe('sniper');
    sim.upgrade(p.id, 'dmg');
    expect(p.stats.dmg).toBe(1);
  });

  it('gives kill rewards and lets a dead player respawn only after a short wait', () => {
    const sim: Sim = new ArenaSim(5, rng(5));
    const a = sim.addPlayer('a', false), b = sim.addPlayer('b', false);
    b.shieldT = 0;
    sim.hurt(b, 1e6, a.id, 1, 0);
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(1);
    sim.respawn(b.id);
    expect(b.alive).toBe(false);
    run(sim, 2.1);
    sim.respawn(b.id);
    expect(b.alive).toBe(true);
  });

  it('cleans names and builds the same rocks from the same seed', () => {
    expect(cleanName('<b>Hi</b>!!')).toBe('bHib');
    expect(cleanName('x')).toMatch(/^Guest\d{4}$/);
    expect(cleanName('a'.repeat(40))).toHaveLength(14);
    expect(makeRocks(9)).toEqual(makeRocks(9));
  });

  it('only lets our own game pages connect', () => {
    const env = { ALLOWED_ORIGINS: 'https://bg-play.brainstorming-games.workers.dev', ALLOW_DEV: '0', GAMES_DOMAIN: '' };
    expect(originAllowed('https://bg-play.brainstorming-games.workers.dev', env)).toBe(true);
    expect(originAllowed('https://evil.example', env)).toBe(false);
    expect(originAllowed('http://localhost:4100', env)).toBe(false);
    expect(originAllowed('http://g-abc.localhost:4100', { ...env, ALLOW_DEV: '1' })).toBe(true);
    expect(originAllowed(null, env)).toBe(false);
  });
});
