/**
 * @brainstorming/sdk: connect an HTML5 game to Brainstorming Games.
 *
 * ```ts
 * import BG from '@brainstorming/sdk';
 * await BG.init();
 * BG.game.loadingStart();
 * // ... load assets
 * BG.game.loadingStop();
 * BG.game.gameplayStart();
 * ```
 *
 * The SDK works in three environments:
 * - `brainstorming`: inside the Brainstorming Games player. Calls go to the page around the game.
 * - `local`: on localhost. Mock ads, console logging and a debug overlay.
 * - `disabled`: anywhere else. Every method resolves safely and the SDK warns once.
 *
 * @packageDocumentation
 */
import { createLocalHandlers, type LocalHandlers } from './local';
import { createDebugOverlay } from './overlay';
import {
  DEFAULT_SETTINGS,
  PROTOCOL,
  PROTOCOL_VERSION,
  SDK_VERSION,
  isProtocolMessage,
  type AdResult,
  type BgUser,
  type Environment,
  type GameEventName,
  type GameSettings,
  type HelloResult,
  type HostEvents,
  type LeaderboardTop,
  type Methods,
  type MethodName,
  type RewardedResult,
  type RoomInfo,
  type ClipResult,
} from './protocol';

export type {
  AdResult,
  AdSkipReason,
  BgUser,
  Environment,
  GameSettings,
  LeaderboardEntry,
  LeaderboardTop,
  RewardedResult,
  RoomInfo,
} from './protocol';
export { SDK_VERSION } from './protocol';

const HANDSHAKE_MS = 2500;
const CALL_TIMEOUT_MS = 20_000;
/** Ads wait for the player; they get a much longer timeout. */
const LONG_CALLS: MethodName[] = ['ad.midgame', 'ad.rewarded', 'user.login'];

type Listener<T> = (value: T) => void;

let environment: Environment = 'disabled';
let initPromise: Promise<void> | null = null;
let hello: HelloResult | null = null;
let settings: GameSettings = { ...DEFAULT_SETTINGS };
let currentUser: BgUser | null = null;
let local: LocalHandlers | null = null;
let debugLog: ((line: string) => void) | null = null;
let warned = false;
let parentOrigin = '';
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
const settingsListeners = new Set<Listener<GameSettings>>();
const authListeners = new Set<Listener<BgUser | null>>();
const adStateListeners = new Set<Listener<{ playing: boolean }>>();

function isLocalHost(): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost|.+\.local)$/.test(location.hostname) || location.protocol === 'file:';
}

/** Where the page around the game lives. The player passes it as `bg_site`. */
function candidateParentOrigin(): string {
  try {
    const fromParam = new URLSearchParams(location.search).get('bg_site');
    if (fromParam) return new URL(fromParam).origin;
  } catch {
    // ignore a malformed value
  }
  const ancestors = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors && ancestors.length > 0) return ancestors[0]!;
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    // ignore
  }
  return '';
}

function onMessage(event: MessageEvent): void {
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  const msg = event.data;
  if (!isProtocolMessage(msg)) return;
  if (msg.kind === 'res') {
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error ?? 'error'));
  } else if (msg.kind === 'evt') {
    const name = msg.name as keyof HostEvents;
    if (name === 'settings') {
      settings = { ...DEFAULT_SETTINGS, ...(msg.data as GameSettings) };
      settingsListeners.forEach((l) => l(settings));
    } else if (name === 'auth') {
      currentUser = (msg.data as BgUser | null) ?? null;
      authListeners.forEach((l) => l(currentUser));
    } else if (name === 'ad-state') {
      adStateListeners.forEach((l) => l(msg.data as { playing: boolean }));
    } else if (name === 'clip-start') {
      const { seconds, token } = msg.data as { seconds: number; token: number };
      void recordClip(Math.max(3, Math.min(30, Number(seconds) || 15)), Number(token) || 1);
    }
  }
}

function post<M extends MethodName>(method: M, params: Methods[M]['params'], timeout: number): Promise<Methods[M]['result']> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${method}`));
    }, timeout);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    window.parent.postMessage({ p: PROTOCOL, v: PROTOCOL_VERSION, kind: 'req', id, method, params }, parentOrigin);
  });
}

const DISABLED_RESULTS: { [M in MethodName]?: Methods[M]['result'] } = {
  'ad.midgame': { shown: false, reason: 'disabled' },
  'ad.rewarded': { rewarded: false, reason: 'disabled' },
  'ad.banner': { shown: false, reason: 'disabled' },
  'ad.adblock': false,
  'lb.submit': { accepted: false },
  'lb.top': { entries: [], me: null },
  'user.get': null,
  'user.token': null,
  'user.login': null,
  'data.get': null,
};

async function call<M extends MethodName>(method: M, params: Methods[M]['params']): Promise<Methods[M]['result']> {
  if (!initPromise) {
    throw new Error('Call BG.init() before using the SDK.');
  }
  await initPromise;
  if (environment === 'brainstorming') {
    return post(method, params, LONG_CALLS.includes(method) ? 10 * 60_000 : CALL_TIMEOUT_MS);
  }
  if (environment === 'local' && local) {
    const result = await (local[method] as (p: unknown) => Promise<Methods[M]['result']>)(params);
    debugLog?.(`${method}(${JSON.stringify(params)}) → ${JSON.stringify(result)}`);
    return result;
  }
  if (!warned) {
    warned = true;
    console.warn('[Brainstorming SDK] Not running on Brainstorming Games or localhost: SDK calls do nothing.');
  }
  return (DISABLED_RESULTS[method] ?? null) as Methods[M]['result'];
}

/** Fire-and-forget calls never throw into game code. */
function send<M extends MethodName>(method: M, params: Methods[M]['params']): void {
  void call(method, params).catch((err: unknown) => {
    if (environment !== 'disabled') console.warn(`[Brainstorming SDK] ${method} failed`, err);
  });
}

async function handshake(): Promise<boolean> {
  if (window.parent === window) return false;
  parentOrigin = candidateParentOrigin();
  if (!parentOrigin || parentOrigin === 'null') return false;
  window.addEventListener('message', onMessage);
  try {
    hello = await post('hello', { version: SDK_VERSION }, HANDSHAKE_MS);
    settings = { ...DEFAULT_SETTINGS, ...hello.settings };
    currentUser = hello.user;
    return true;
  } catch {
    window.removeEventListener('message', onMessage);
    return false;
  }
}

/** Starts the SDK. Call it once, before anything else. Safe to call again. */
function init(): Promise<void> {
  initPromise ??= (async () => {
    if (await handshake()) {
      environment = 'brainstorming';
      return;
    }
    if (isLocalHost()) {
      environment = 'local';
      const overlay = createDebugOverlay();
      debugLog = overlay.log;
      local = createLocalHandlers(overlay.log);
      hello = await local.hello({ version: SDK_VERSION });
      overlay.log(`SDK ${SDK_VERSION} running in local mode (mock ads, local saves)`);
      return;
    }
    environment = 'disabled';
  })();
  return initPromise;
}

/**
 * Clip & share: records the game's largest visible canvas for `seconds` and sends the video to
 * the platform, which turns it into a vertical clip for the player to save or share. Nothing is
 * recorded unless the player presses the Clip button on the site. Games can opt out with
 * `BG.game.setClipsEnabled(false)` (for example on screens that show other players' names).
 */
let clipsEnabled = true;
let clipping = false;

function largestCanvas(): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  for (const c of Array.from(document.querySelectorAll('canvas'))) {
    const r = c.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea && r.width >= 120 && r.height >= 120) {
      best = c;
      bestArea = area;
    }
  }
  return best;
}

async function recordClip(seconds: number, token: number): Promise<void> {
  const reply = (r: Omit<ClipResult, 'token'>) => {
    if (environment === 'brainstorming') void post('clip.result', { token, ...r }, 30_000).catch(() => {});
  };
  const none = (reason: string) => reply({ ok: false, mime: '', data: null, width: 0, height: 0, reason });
  if (!clipsEnabled) return none('disabled');
  if (clipping) return none('busy');
  const canvas = largestCanvas();
  if (!canvas) return none('no-canvas');
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') return none('unsupported');
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) return none('unsupported');
  let stream: MediaStream;
  try {
    stream = canvas.captureStream(30);
  } catch {
    // A canvas that drew images from other sites without CORS cannot be recorded.
    return none('tainted');
  }
  clipping = true;
  try {
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.start(1000);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    recorder.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    const data = await new Blob(chunks, { type: mime.split(';')[0] }).arrayBuffer();
    reply({ ok: true, mime, data, width: canvas.width, height: canvas.height, reason: null });
  } catch {
    none('error');
  } finally {
    clipping = false;
  }
}

const gameEvent = (name: GameEventName) => send('game.event', { name });

/** The game module: loading and gameplay signals, celebrations, context and invites. */
const game = {
  /** The game started loading its assets. */
  loadingStart: () => gameEvent('loading_start'),
  /** Loading finished. The time between start and stop is your load time KPI. */
  loadingStop: () => gameEvent('loading_stop'),
  /** The player is playing. Drives real playtime KPIs and ad timing. */
  gameplayStart: () => gameEvent('gameplay_start'),
  /** Gameplay paused or ended (menus, game over, level end). Banners may only show now. */
  gameplayStop: () => gameEvent('gameplay_stop'),
  /** A big moment: the mascot pops in with a cyan confetti burst. */
  celebrate: () => send('game.celebrate', {}),
  /** Progress through the game, 0 to 100. */
  reportProgress: (pct: number) => send('game.progress', { pct: Math.max(0, Math.min(100, Number(pct) || 0)) }),
  /** Context attached to player bug reports (level, seed, build...). Keep it small. */
  setContext: (context: Record<string, unknown>) => send('game.context', { context }),
  clearContext: () => send('game.context', { context: null }),
  /** Player settings: mute, chat, low-data and school-safe flags. */
  get settings(): GameSettings {
    return { ...settings };
  },
  /** Called whenever settings change. Returns an unsubscribe function. */
  onSettingsChange(cb: Listener<GameSettings>): () => void {
    settingsListeners.add(cb);
    return () => settingsListeners.delete(cb);
  },
  /** Called when an ad starts (pause and mute your game) and ends. */
  onAdStateChange(cb: Listener<{ playing: boolean }>): () => void {
    adStateListeners.add(cb);
    return () => adStateListeners.delete(cb);
  },
  /** A link that opens this game with the given invite parameters. */
  inviteLink(params: Record<string, string | number>): string {
    const base = hello?.gameUrl ?? location.href.split('?')[0]!;
    const url = new URL(base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    return url.toString();
  },
  /** An invite parameter the player arrived with, or null. */
  getInviteParam(name: string): string | null {
    const fromHost = hello?.inviteParams?.[name];
    if (fromHost != null) return fromHost;
    return new URLSearchParams(location.search).get(name);
  },
  /** Tell the platform about a multiplayer room so friends can join from the site. */
  updateRoom: (room: RoomInfo) => send('game.room', room),
  /** Allow or block the player's Clip button (on by default). */
  setClipsEnabled(enabled: boolean): void {
    clipsEnabled = Boolean(enabled);
  },
};

/** The ad module. The platform enforces the ad rules; a refused call resolves quickly. */
const ad = {
  /**
   * A break between levels. At most one every 3 minutes, never in the first minute of gameplay.
   * Pause your game in `onStart` and resume in `onFinish`.
   */
  async midgame(callbacks: { onStart?: () => void; onFinish?: () => void } = {}): Promise<AdResult> {
    const off = game.onAdStateChange(({ playing }) => (playing ? callbacks.onStart?.() : undefined));
    try {
      const result = await call('ad.midgame', {});
      if (environment === 'local' && result.shown) callbacks.onStart?.();
      if (result.shown) callbacks.onFinish?.();
      return result;
    } catch {
      return { shown: false, reason: 'error' };
    } finally {
      off();
    }
  },
  /** An ad the player chose to watch. `rewarded` is true only if they watched it to the end. */
  async rewarded(callbacks: { onStart?: () => void } = {}): Promise<RewardedResult> {
    const off = game.onAdStateChange(({ playing }) => (playing ? callbacks.onStart?.() : undefined));
    try {
      return await call('ad.rewarded', {});
    } catch {
      return { rewarded: false, reason: 'error' };
    } finally {
      off();
    }
  },
  /** A banner in the element with `containerId`. Only while gameplay is stopped; 2 at most. */
  async showBanner({ containerId, size = '320x50' }: { containerId: string; size?: string }): Promise<AdResult> {
    const el = document.getElementById(containerId);
    if (!el) return { shown: false, reason: 'unavailable' };
    const r = el.getBoundingClientRect();
    try {
      return await call('ad.banner', { containerId, size, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
    } catch {
      return { shown: false, reason: 'error' };
    }
  },
  hideBanner(containerId: string): void {
    send('ad.hideBanner', { containerId });
  },
  /** Whether the player uses an ad blocker. Play is never blocked because of it. */
  async hasAdblock(): Promise<boolean> {
    try {
      return await call('ad.adblock', {});
    } catch {
      return false;
    }
  },
};

/** The user module. Guests are `null`. */
const user = {
  get: (): Promise<BgUser | null> => call('user.get', {}),
  /** A short-lived signed token (ES256 JWT) for your own server to verify. Null for guests. */
  getToken: (): Promise<string | null> => call('user.token', {}),
  onAuthChange(cb: Listener<BgUser | null>): () => void {
    authListeners.add(cb);
    return () => authListeners.delete(cb);
  },
  /** Asks the player to log in. Resolves with the user, or null if they did not. */
  promptLogin: (): Promise<BgUser | null> => call('user.login', {}),
};

/** Saves: in the cloud for signed-in players, on the device for guests (merged on login). */
const data = {
  get: <T = unknown>(key: string): Promise<T | null> => call('data.get', { key }) as Promise<T | null>,
  set: async (key: string, value: unknown): Promise<void> => {
    await call('data.set', { key, value });
  },
  remove: async (key: string): Promise<void> => {
    await call('data.remove', { key });
  },
};

/** Leaderboards. Scores are validated on the server. */
const leaderboard = {
  submit: (boardId: string, score: number): Promise<{ accepted: boolean }> =>
    call('lb.submit', { board: boardId, score }).catch(() => ({ accepted: false })),
  top: (boardId: string, options: { limit?: number; friends?: boolean } = {}): Promise<LeaderboardTop> =>
    call('lb.top', { board: boardId, limit: options.limit ?? 10, friends: options.friends ?? false }),
};

/** Quests: report actions that cross-game quests can count. */
const quests = {
  track: (eventName: string, value = 1) => send('quests.track', { event: eventName, value }),
};

export const BG = {
  init,
  get environment(): Environment {
    return environment;
  },
  version: SDK_VERSION,
  game,
  ad,
  user,
  data,
  leaderboard,
  quests,
};

export type BrainstormingSDK = typeof BG;
export default BG;
