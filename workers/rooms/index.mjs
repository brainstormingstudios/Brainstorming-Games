/*
 * bg-rooms: the multiplayer server for BS Originals (Cloudflare Worker + Durable Objects, free plan).
 *
 *   wss://<host>/ws?room=q1&name=Ace   quick-play arenas q1..q8 (a full one closes with 4001)
 *   wss://<host>/ws?room=p-AB3K9        a private room, shared with an invite link
 *
 * One Durable Object per room runs the arena 20 times a second while people are in it and sleeps
 * when the last one leaves. Only game pages from our own play origin (and local development) may
 * connect. Players send only their buttons; the server decides everything else.
 */
/* global WebSocketPair */
import { ArenaSim, MAX_HUMANS, TICK, WORLD } from './sim.mjs';

const ROOM = /^(q[1-8]|p-[A-Z0-9]{5})$/;
const DEV_ORIGIN = /^http:\/\/((?:[a-z0-9-]+\.)*localhost|127\.0\.0\.1)(:\d+)?$/;

/** Whether a page from this origin may join. Exported for tests. */
export function originAllowed(origin, env) {
  if (!origin) return false;
  const allowed = String(env.ALLOWED_ORIGINS ?? '').split(/\s+/).filter(Boolean);
  if (allowed.includes(origin)) return true;
  // Game origins like https://g-<id>.games.example, when a games domain is set.
  const domain = String(env.GAMES_DOMAIN ?? '').toLowerCase();
  if (domain) {
    try {
      const host = new URL(origin).hostname;
      if (host.endsWith(`.${domain}`) && origin.startsWith('https://')) return true;
    } catch {
      return false;
    }
  }
  return env.ALLOW_DEV === '1' && DEV_ORIGIN.test(origin);
}

function text(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return text(200, 'Brainstorming Games rooms server');
    if (url.pathname !== '/ws') return text(404, 'Not found');
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return text(426, 'Expected a WebSocket');
    if (!originAllowed(request.headers.get('origin'), env)) return text(403, 'Not allowed');
    const room = url.searchParams.get('room') ?? '';
    if (!ROOM.test(room)) return text(400, 'Bad room');
    const stub = env.ARENA.get(env.ARENA.idFromName(room));
    return stub.fetch(request);
  },
};

export class Arena {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sim = new ArenaSim();
    this.clients = new Map(); // socket -> { pid, count, windowAt }
    this.timer = null;
    this.ticks = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    if (this.sim.humans() >= MAX_HUMANS) {
      server.close(4001, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const p = this.sim.addPlayer(url.searchParams.get('name'), false);
    const info = { pid: p.id, count: 0, windowAt: Date.now() };
    this.clients.set(server, info);
    server.send(JSON.stringify({
      t: 'welcome', id: p.id, room: url.searchParams.get('room'), world: WORLD, rocks: this.sim.rocks,
      orbs: [...this.sim.orbs.values()].map((o) => [o.id, o.x, o.y, o.v]), powers: this.sim.powers, roster: this.sim.roster(),
      tick: TICK,
    }));
    server.addEventListener('message', (e) => this.onMessage(server, info, e.data));
    const bye = () => this.leave(server);
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(ws, info, data) {
    // At most 40 messages a second; a client that floods is disconnected.
    const now = Date.now();
    if (now - info.windowAt > 1000) { info.windowAt = now; info.count = 0; }
    if (++info.count > 40) {
      if (info.count > 120) ws.close(4008, 'too many messages');
      return;
    }
    if (typeof data !== 'string' || data.length > 300) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const id = info.pid, sim = this.sim;
    switch (m.t) {
      case 'in': sim.setInput(id, m); break;
      case 'boost': sim.boost(id); break;
      case 'up': sim.upgrade(id, String(m.s)); break;
      case 'cls': sim.chooseClass(id, String(m.c)); break;
      case 'emote': sim.emote(id, m.e); break;
      case 'respawn': sim.respawn(id); break;
      case 'ping': ws.send(JSON.stringify({ t: 'pong', c: Number(m.c) || 0 })); break;
      default: break;
    }
  }

  leave(ws) {
    const info = this.clients.get(ws);
    if (!info) return;
    this.clients.delete(ws);
    this.sim.removePlayer(info.pid);
    if (this.clients.size === 0) this.stop();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), TICK * 1000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // An empty room starts fresh next time.
    this.sim = new ArenaSim();
  }

  step() {
    this.sim.tick(TICK);
    this.ticks++;
    const out = this.sim.takeOut();
    const msg = { t: 's', s: this.sim.snapshot() };
    if (out.bullets.length) msg.b = out.bullets;
    if (out.hits.length) msg.h = out.hits;
    if (out.orbsAdd.length) msg.oa = out.orbsAdd;
    if (out.orbsDel.length) msg.od = out.orbsDel;
    if (out.events.length) msg.e = out.events;
    if (out.powersChanged) msg.pw = this.sim.powers;
    if (out.rosterChanged) msg.r = this.sim.roster();
    if (this.ticks % 20 === 0) msg.lb = this.sim.leaderboard();
    const shared = JSON.stringify(msg).slice(0, -1);
    for (const [ws, info] of this.clients) {
      try {
        ws.send(`${shared},"me":${JSON.stringify(this.sim.me(info.pid))}}`);
      } catch {
        this.leave(ws);
      }
    }
  }
}
