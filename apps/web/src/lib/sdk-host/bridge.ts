'use client';

import {
  AdRules,
  createAdsenseH5Provider,
  createHouseProvider,
  withFallback,
  createMockProvider,
  detectAdblock,
  noneProvider,
  parseRequest,
  PROTOCOL,
  PROTOCOL_VERSION,
  type AdProvider,
  type BgUser,
  type GameSettings,
  type HelloResult,
  type HostEventName,
  type HostEvents,
  type MethodName,
  type Methods,
  type ParsedRequest,
  type RoomInfo,
} from '@brainstorming/sdk/host';
import { localizePath, type Locale } from '@/i18n/config';
import { ADSENSE_CLIENT, INGAME_AD_PROVIDER, PLAY_ORIGIN } from '@/lib/config';
import { requestLogin } from '@/lib/auth/loginPrompt';
import { canPersonaliseAds } from '@/lib/ads/consent';
import { HOUSE_AD } from '@/lib/ads/houseAd';
import { getRepo } from '@/lib/data';
import { onTopic } from '@/lib/data/bus';
import { local } from '@/lib/data/local';
import type { SessionUser } from '@/lib/data/repo';
import type { EventType, GameSummary } from '@/lib/data/types';
import { track } from '@/lib/events/client';
import { getPrefs } from '@/lib/prefs';
import { activePlan } from '@/lib/domain/premium';
import { celebrate } from './celebrate';

const LAST_MIDGAME_KEY = 'bg.ads.lastMidgame';
const RESERVED_PARAMS = new Set(['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'bg_site']);

export interface HostLogEntry {
  at: number;
  direction: 'in' | 'out';
  method: string;
  detail: string;
}

export interface HostContext {
  game: Pick<GameSummary, 'id' | 'slug' | 'status' | 'versionId'>;
  sessionId: string;
  locale: Locale;
  /** The element that holds the iframe; ads, banners and celebrations are drawn over it. */
  container: HTMLElement;
  /** Private preview: ads use the mock provider with the normal rules, and calls are logged. */
  preview?: boolean;
  /** Preview test settings: keep the normal break-ad limits, and show test ads at all. */
  previewOptions?: { limitMidgame: boolean; testAds: boolean };
  onLog?: (entry: HostLogEntry) => void;
  onRoom?: (room: RoomInfo) => void;
}

export interface ClipVideo {
  blob: Blob;
  width: number;
  height: number;
}

export interface HostBridge {
  /** Whether the game's SDK has connected (Clip & share needs it). */
  connected(): boolean;
  /** Asks the game to record the next `seconds` of play. Rejects with a reason code. */
  requestClip(seconds: number): Promise<ClipVideo>;
  /** The last context the game set with `BG.game.setContext`, for bug reports. */
  context(): Record<string, unknown> | null;
  /** Whether the game reports gameplay itself (then playtime comes from the SDK). */
  usesGameplayEvents(): boolean;
  gameplaySeconds(): number;
  progress(): number | null;
  destroy(): void;
}

export function toBgUser(user: SessionUser | null): BgUser | null {
  if (!user || !user.username) return null;
  return { id: user.id, username: user.username, avatarUrl: null };
}

function currentSettings(user: SessionUser | null): GameSettings {
  const prefs = getPrefs();
  const restricted = user ? user.isMinor && user.consent !== 'granted' : false;
  return {
    muteAudio: false,
    disableChat: prefs.schoolSafe || restricted || !user,
    lowData: prefs.lowData,
    schoolSafe: prefs.schoolSafe,
  };
}

function inviteParams(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(window.location.search)) {
    if (!RESERVED_PARAMS.has(k) && /^[A-Za-z0-9_-]{1,32}$/.test(k)) out[k] = v.slice(0, 128);
  }
  return out;
}

function makeProvider(layer: () => HTMLElement, preview: boolean): AdProvider {
  if (preview || INGAME_AD_PROVIDER === 'mock') return createMockProvider({ container: layer });
  if (INGAME_AD_PROVIDER === 'adsense-h5' && ADSENSE_CLIENT) {
    // A break Google cannot fill shows our own promo instead of nothing.
    return withFallback(createAdsenseH5Provider({ client: ADSENSE_CLIENT, personalised: canPersonaliseAds() }), createHouseProvider({ container: layer, ad: HOUSE_AD }));
  }
  // Our own promo in ad breaks, until an ad network is approved.
  if (INGAME_AD_PROVIDER === 'house') return createHouseProvider({ container: layer, ad: HOUSE_AD });
  return noneProvider;
}

/**
 * Connects the page to the game in `frame`. Only messages from that iframe's window and the
 * play origin are accepted, each is validated, and replies go back to the play origin only.
 */
export function attachHost(frame: HTMLIFrameElement, ctx: HostContext): HostBridge {
  const { game, sessionId } = ctx;
  const ids = { gameId: game.id, versionId: game.versionId, sessionId };
  const lastMidgame = Number(local.get<number>(LAST_MIDGAME_KEY, 0)) || Number.NEGATIVE_INFINITY;
  const testing = ctx.preview ? (ctx.previewOptions ?? { limitMidgame: true, testAds: true }) : null;
  const rules = new AdRules({
    spark: !ctx.preview && game.status === 'spark',
    enabled: testing ? testing.testAds : INGAME_AD_PROVIDER !== 'none',
    // A preview starts fresh: the player's real ad history does not apply to a test run.
    lastMidgameAt: testing ? Number.NEGATIVE_INFINITY : lastMidgame,
    ignoreMidgameLimits: testing ? !testing.limitMidgame : false,
  });
  const applyPremium = (u: SessionUser | null) => rules.setPremium(activePlan(u?.premium));
  const started = Date.now();
  let gameContext: Record<string, unknown> | null = null;
  let progress: number | null = null;
  let user: SessionUser | null = null;
  let playSession: Promise<string | null> | null = null;
  let destroyed = false;

  // Ads and banners are drawn in a layer over the frame (never over the rest of the page).
  const layer = document.createElement('div');
  layer.setAttribute('data-ad-layer', '');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5';
  ctx.container.appendChild(layer);
  const adLayer = () => {
    layer.style.pointerEvents = 'auto';
    return layer;
  };
  const provider = makeProvider(adLayer, Boolean(ctx.preview));
  const banners = new Map<string, HTMLElement>();

  const log = (direction: HostLogEntry['direction'], method: string, detail: unknown) => {
    ctx.onLog?.({ at: Date.now(), direction, method, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) ?? '' });
  };

  // Each game has its own origin: talk only to the origin of the build this frame was given. If
  // the game navigates its frame somewhere else, that page gets nothing and is not listened to.
  const frameOrigin = (): string => {
    try {
      return new URL(frame.getAttribute('src') ?? '', window.location.href).origin;
    } catch {
      return PLAY_ORIGIN;
    }
  };
  const post = (message: Record<string, unknown>) => {
    if (!destroyed) frame.contentWindow?.postMessage({ p: PROTOCOL, v: PROTOCOL_VERSION, ...message }, frameOrigin());
  };
  const emit = <E extends HostEventName>(name: E, data: HostEvents[E]) => {
    post({ kind: 'evt', name, data });
    log('out', `event:${name}`, data);
  };
  const event = (type: EventType, payload: Record<string, unknown> = {}) => track(type, { ...ids, payload });

  const setAdPlaying = (playing: boolean) => {
    emit('ad-state', { playing });
    emit('settings', { ...currentSettings(user), muteAudio: playing });
    if (!playing) layer.style.pointerEvents = 'none';
  };

  let connected = false;
  let clipToken = 0;
  const clipWaiters = new Map<number, { resolve: (v: ClipVideo) => void; reject: (e: Error) => void; timer: number }>();

  const handlers: { [M in MethodName]: (params: Methods[M]['params']) => Promise<Methods[M]['result']> } = {
    'clip.result': async ({ token, ok, mime, data, width, height, reason }) => {
      const w = clipWaiters.get(token);
      if (!w) return null;
      clipWaiters.delete(token);
      window.clearTimeout(w.timer);
      if (ok && data) w.resolve({ blob: new Blob([data], { type: mime.split(';')[0] || 'video/webm' }), width, height });
      else w.reject(new Error(reason ?? 'error'));
      return null;
    },
    hello: async () => {
      connected = true;
      const result: HelloResult = {
        gameId: game.id,
        versionId: game.versionId,
        settings: currentSettings(user),
        user: toBgUser(user),
        inviteParams: inviteParams(),
        gameUrl: `${window.location.origin}${localizePath(`/game/${game.slug}`, ctx.locale)}`,
        spark: !ctx.preview && game.status === 'spark',
        preview: Boolean(ctx.preview),
      };
      return result;
    },
    'game.event': async ({ name }) => {
      if (name === 'gameplay_start') {
        rules.gameplayStart();
        for (const id of rules.bannersToHide()) {
          const slot = banners.get(id);
          if (slot) {
            provider.hideBanner(slot);
            slot.remove();
          }
          banners.delete(id);
        }
      }
      if (name === 'gameplay_stop') rules.gameplayStop();
      const payload: Record<string, unknown> = { sdk: true, t: Math.round(rules.gameplayTime() / 1000) };
      if (name === 'loading_stop') payload.ms = Date.now() - started;
      event(name, payload);
      return null;
    },
    'game.celebrate': async () => {
      celebrate(ctx.container);
      return null;
    },
    'game.progress': async ({ pct }) => {
      progress = pct;
      return null;
    },
    'game.context': async ({ context }) => {
      gameContext = context;
      return null;
    },
    'game.room': async (room) => {
      ctx.onRoom?.(room);
      return null;
    },
    'ad.midgame': async () => {
      const reason = rules.checkMidgame();
      if (reason) return { shown: false, reason };
      event('ad_requested', { kind: 'midgame' });
      rules.adStarted();
      setAdPlaying(true);
      event('ad_started', { kind: 'midgame' });
      const outcome = await provider.showMidgame().catch(() => 'error' as const);
      setAdPlaying(false);
      if (outcome === 'error') {
        rules.adFailed();
        event('ad_error', { kind: 'midgame' });
        return { shown: false, reason: 'error' };
      }
      rules.midgameDone();
      local.set(LAST_MIDGAME_KEY, rules.lastMidgame);
      event('ad_finished', { kind: 'midgame', outcome });
      return { shown: true };
    },
    'ad.rewarded': async () => {
      // Max members get the reward straight away, no video.
      if (rules.instantRewards) {
        event('rewarded_granted', { premium: true });
        return { rewarded: true, reason: 'premium' };
      }
      const reason = rules.checkRewarded();
      if (reason) return { rewarded: false, reason };
      event('ad_requested', { kind: 'rewarded' });
      rules.adStarted();
      setAdPlaying(true);
      event('ad_started', { kind: 'rewarded' });
      const outcome = await provider.showRewarded().catch(() => 'error' as const);
      setAdPlaying(false);
      if (outcome === 'error') {
        // The reward never fires on an error.
        rules.adFailed();
        event('ad_error', { kind: 'rewarded' });
        return { rewarded: false, reason: 'error' };
      }
      rules.rewardedDone();
      event('ad_finished', { kind: 'rewarded', outcome });
      if (outcome === 'finished') event('rewarded_granted');
      return { rewarded: outcome === 'finished' };
    },
    'ad.banner': async ({ containerId, size, rect }) => {
      const reason = rules.checkBanner(containerId);
      if (reason) return { shown: false, reason };
      const frameBox = frame.getBoundingClientRect();
      const box = ctx.container.getBoundingClientRect();
      const slot = banners.get(containerId) ?? document.createElement('div');
      slot.style.cssText = `position:absolute;left:${frameBox.left - box.left + rect.x}px;top:${frameBox.top - box.top + rect.y}px;width:${Math.max(rect.width, 1)}px;min-height:${Math.max(rect.height, 1)}px;display:flex;justify-content:center;pointer-events:auto`;
      layer.appendChild(slot);
      const shown = await provider.showBanner(slot, size).catch(() => false);
      if (!shown) {
        slot.remove();
        return { shown: false, reason: 'unavailable' };
      }
      banners.set(containerId, slot);
      rules.bannerShown(containerId);
      event('ad_started', { kind: 'banner', size });
      return { shown: true };
    },
    'ad.hideBanner': async ({ containerId }) => {
      const slot = banners.get(containerId);
      if (slot) {
        provider.hideBanner(slot);
        slot.remove();
      }
      banners.delete(containerId);
      rules.bannerHidden(containerId);
      return null;
    },
    'ad.adblock': () => detectAdblock(),
    'user.get': async () => toBgUser(user),
    'user.token': async () => {
      if (!user) return null;
      const repo = await getRepo();
      return repo.auth.gameToken(game.id);
    },
    'user.login': async () => {
      const signedIn = await requestLogin();
      return toBgUser(signedIn);
    },
    'data.get': async ({ key }) => (await getRepo()).saves.get(game.id, key),
    'data.set': async ({ key, value }) => {
      await (await getRepo()).saves.set(game.id, key, value);
      return null;
    },
    'data.remove': async ({ key }) => {
      await (await getRepo()).saves.remove(game.id, key);
      return null;
    },
    'lb.submit': async ({ board, score }) => {
      if (!user) return { accepted: false };
      const repo = await getRepo();
      playSession ??= repo.scores.startSession(game.id, game.versionId).catch(() => null);
      const session = await playSession;
      if (!session) return { accepted: false };
      return repo.scores.submit(game.id, board, score, session).catch(() => ({ accepted: false }));
    },
    'lb.top': async ({ board, limit, friends }) => (await getRepo()).scores.top(game.id, board, { limit, friends, period: 'all' }),
    'quests.track': async ({ event: name, value }) => {
      if (user) await (await getRepo()).quests.track(name, value).catch(() => {});
      return null;
    },
  };

  const onMessage = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || e.origin !== frameOrigin() || e.origin === window.location.origin) return;
    const req: ParsedRequest | null = parseRequest(e.data);
    if (!req) return;
    if (req.params === undefined) {
      post({ kind: 'res', id: req.id, ok: false, error: 'invalid params' });
      log('in', req.method, 'rejected: invalid params');
      return;
    }
    log('in', req.method, req.params);
    const handler = handlers[req.method] as (p: unknown) => Promise<unknown>;
    handler(req.params).then(
      (result) => {
        post({ kind: 'res', id: req.id, ok: true, result: result ?? null });
        log('out', req.method, result ?? null);
      },
      (err: unknown) => {
        post({ kind: 'res', id: req.id, ok: false, error: err instanceof Error ? err.message : 'error' });
        log('out', req.method, `error: ${String(err)}`);
      },
    );
  };
  window.addEventListener('message', onMessage);

  // Keep the game informed about the player and their settings.
  const refreshUser = () =>
    void getRepo()
      .then((repo) => repo.auth.session())
      .then((next) => {
        const changed = (next?.id ?? null) !== (user?.id ?? null);
        user = next;
      applyPremium(next);
        if (changed) emit('auth', toBgUser(user));
        emit('settings', currentSettings(user));
      })
      .catch(() => {});
  refreshUser();
  const offSession = onTopic('session', refreshUser);
  const onStorage = (e: StorageEvent) => {
    if (e.key === 'bg.prefs') emit('settings', currentSettings(user));
  };
  window.addEventListener('storage', onStorage);

  return {
    connected: () => connected,
    requestClip(seconds) {
      if (!connected) return Promise.reject(new Error('no-sdk'));
      const token = ++clipToken;
      return new Promise<ClipVideo>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          clipWaiters.delete(token);
          reject(new Error('timeout'));
        }, (seconds + 20) * 1000);
        clipWaiters.set(token, { resolve, reject, timer });
        emit('clip-start', { seconds, token });
      });
    },
    context: () => gameContext,
    usesGameplayEvents: () => rules.usedGameplayEvents,
    gameplaySeconds: () => rules.gameplayTime() / 1000,
    progress: () => progress,
    destroy() {
      destroyed = true;
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      offSession();
      layer.remove();
    },
  };
}
