'use client';

import { useTranslations } from 'next-intl';
import { Play, X } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Mascot, cn } from '@brainstorming/ui';
import { GameCover } from '@/components/catalogue/GameCover';
import { MASCOT_NAME } from '@/lib/config';
import { getRepo } from '@/lib/data';
import { uuid } from '@/lib/data/local';
import type { GameSummary } from '@/lib/data/types';
import { track } from '@/lib/events/client';
import { estimateLoadSeconds, formatBytes, playUrl } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import type * as HostModule from '@/lib/sdk-host/bridge';
import type { HostBridge, HostLogEntry } from '@/lib/sdk-host/bridge';
import { useLocale } from '@/i18n/navigation';

export interface GameFrameHandle {
  toggleFullscreen: () => void;
  isPlaying: () => boolean;
  /** The context the game set through the SDK, for bug reports. */
  context: () => Record<string, unknown> | null;
}

export interface GameFrameProps {
  game: GameSummary;
  onFullscreenChange?: (on: boolean) => void;
  /** Override the build URL (private previews). */
  src?: string | null;
  /** Private preview: mock ads with the normal rules, and every SDK call is logged. */
  preview?: boolean;
  onSdkLog?: (entry: HostLogEntry) => void;
  /** Start without the Play button (previews and the QA console). */
  autoStart?: boolean;
}

type Phase = 'idle' | 'loading' | 'playing';

const LOADER_MAX_MS = 20_000;
const HEARTBEAT_MS = 15_000;

/**
 * The play area. It shows the cover and a Play button first, so nothing from the game loads
 * until the player asks for it. The game then runs in a sandboxed iframe on the play origin.
 * Display ads are never placed over or inside this element.
 */
export const GameFrame = forwardRef<GameFrameHandle, GameFrameProps>(function GameFrame(
  { game, onFullscreenChange, src, preview, onSdkLog, autoStart },
  ref,
) {
  const t = useTranslations('game');
  const locale = useLocale();
  const { lowData } = usePrefs();
  const bridge = useRef<HostBridge | null>(null);
  const logRef = useRef(onSdkLog);
  logRef.current = onSdkLog;
  const [phase, setPhase] = useState<Phase>('idle');
  const [immersive, setImmersive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const session = useRef<{ id: string; seconds: number; visibleSince: number | null; reported: number } | null>(null);
  const url = src === undefined ? playUrl(game) : src;
  const portrait = game.orientation === 'portrait';

  // Size and load estimate are only computed in the browser (they depend on the connection).
  useEffect(() => {
    if (!lowData) {
      setNotice(null);
      return;
    }
    const bytes = game.initialLoadBytes ?? game.sizeBytes;
    setNotice(t('lowDataNotice', { size: formatBytes(bytes), seconds: estimateLoadSeconds(bytes) }));
  }, [lowData, game.initialLoadBytes, game.sizeBytes, t]);

  /** Moves visible time into the session total and returns the total in seconds. */
  const settle = useCallback(() => {
    const s = session.current;
    if (!s) return 0;
    if (s.visibleSince != null) {
      s.seconds += (Date.now() - s.visibleSince) / 1000;
      s.visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
    }
    return s.seconds;
  }, []);

  const report = useCallback(
    (final: boolean) => {
      const s = session.current;
      if (!s) return;
      const visible = settle();
      // Games that report gameplay through the SDK get real playtime; others get visible time.
      const totalSeconds = bridge.current?.usesGameplayEvents() ? bridge.current.gameplaySeconds() : visible;
      const delta = totalSeconds - s.reported;
      s.reported = totalSeconds;
      if (delta >= 1 || final) {
        void getRepo().then((repo) => repo.player.recordPlay(game, delta, false));
      }
      if (final) {
        const ids = { gameId: game.id, versionId: game.versionId, sessionId: s.id };
        const synthetic = !bridge.current?.usesGameplayEvents();
        track('gameplay_stop', { ...ids, payload: { t: Math.round(totalSeconds), synthetic } });
        track('session_end', { ...ids, payload: { t: Math.round(totalSeconds) }, immediate: true });
        session.current = null;
      }
    },
    [game, settle],
  );

  const clickedAt = useRef(0);

  // The SDK host (message validation, ads, saves) is a large module that is only needed once
  // someone plays. It is fetched shortly after the page settles, and `start` waits for it, so
  // the iframe never exists before the host can answer the game's first message.
  const hostModule = useRef<typeof HostModule | null>(null);
  const loadHost = useCallback(
    () =>
      import('@/lib/sdk-host/bridge').then(
        (m) => (hostModule.current = m),
        () => null,
      ),
    [],
  );
  useEffect(() => {
    const id = window.setTimeout(() => void loadHost(), 1500);
    return () => window.clearTimeout(id);
  }, [loadHost]);
  const starting = useRef(false);

  const start = () => {
    if (!url || phase !== 'idle' || starting.current) return;
    starting.current = true;
    const id = uuid();
    session.current = { id, seconds: 0, visibleSince: null, reported: 0 };
    clickedAt.current = Date.now();
    if (!preview) {
      const ids = { gameId: game.id, versionId: game.versionId, sessionId: id };
      track('play_click', { ...ids, payload: { lowData }, immediate: true });
      track('loading_start', ids);
      void getRepo().then((repo) => repo.player.recordPlay(game, 0, true));
    }
    if (!preview && window.matchMedia('(max-width: 639px)').matches) setImmersive(true);
    void loadHost().then(() => setPhase('loading'));
  };

  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once on mount
  }, []);

  // The SDK host attaches as soon as the iframe exists, before the game sends its first message.
  useEffect(() => {
    if (phase !== 'loading' || !frame.current || bridge.current || !stage.current || !session.current || !hostModule.current) return;
    bridge.current = hostModule.current.attachHost(frame.current, {
      game,
      sessionId: session.current.id,
      locale,
      container: stage.current,
      preview,
      onLog: (entry) => logRef.current?.(entry),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one bridge per play session
  }, [phase]);

  useEffect(
    () => () => {
      bridge.current?.destroy();
      bridge.current = null;
    },
    [],
  );

  const onLoad = () => {
    const s = session.current;
    if (!s || phase === 'playing') return;
    if (!preview) {
      const ids = { gameId: game.id, versionId: game.versionId, sessionId: s.id };
      track('loading_stop', { ...ids, payload: { ms: Date.now() - clickedAt.current, synthetic: true } });
      track('gameplay_start', { ...ids, payload: { synthetic: true } });
    }
    s.visibleSince = Date.now();
    setPhase('playing');
    frame.current?.focus();
  };

  // Never leave the loader up forever if a game fails to fire `load`.
  useEffect(() => {
    if (phase !== 'loading') return;
    const id = window.setTimeout(onLoad, LOADER_MAX_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one timer per loading phase
  }, [phase]);

  // Friends see what you are playing (and can join your party).
  useEffect(() => {
    if (phase !== 'playing' || preview) return;
    const party = new URLSearchParams(window.location.search).get('party');
    void getRepo().then((repo) =>
      repo.social.setActivity({ gameId: game.id, gameSlug: game.slug, gameTitle: game.title, partyCode: party && /^[A-Za-z0-9]{4,6}$/.test(party) ? party.toUpperCase() : null }),
    );
    return () => void getRepo().then((repo) => repo.social.setActivity(null));
  }, [phase, preview, game.id, game.slug, game.title]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const onVisibility = () => {
      settle();
      if (document.visibilityState === 'hidden') report(false);
    };
    if (preview) return;
    const beat = window.setInterval(() => report(false), HEARTBEAT_MS);
    const onHide = () => report(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      report(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tied to the play phase only
  }, [phase]);

  const toggleFullscreen = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => setImmersive((v) => !v));
    } else {
      // iOS Safari has no element fullscreen: fill the viewport with CSS instead.
      setImmersive((v) => !v);
    }
  }, []);

  useEffect(() => {
    const onChange = () => onFullscreenChange?.(Boolean(document.fullscreenElement) || immersive);
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [immersive, onFullscreenChange]);

  useEffect(() => {
    if (!immersive) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setImmersive(false);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [immersive]);

  useImperativeHandle(
    ref,
    () => ({
      toggleFullscreen,
      isPlaying: () => phase === 'playing',
      context: () => bridge.current?.context() ?? null,
    }),
    [toggleFullscreen, phase],
  );

  return (
    <div
      ref={stage}
      data-testid="game-frame"
      data-phase={phase}
      className={cn(
        'flex items-center justify-center overflow-hidden bg-black',
        // Only one position utility at a time: with both, `relative` would win and collapse the
        // immersive (phone) frame to zero height.
        immersive
          ? 'fixed inset-0 z-[90] rounded-none'
          : 'relative aspect-video w-full rounded-card border border-border shadow-card',
      )}
    >
      <div
        className={cn(
          'relative h-full overflow-hidden',
          portrait && !immersive ? 'aspect-[9/16]' : 'w-full',
        )}
      >
        {phase === 'idle' ? (
          <>
            <GameCover
              game={game}
              asset={portrait ? (game.coverPortrait ?? game.cover) : game.cover}
              priority
              sizes="(min-width: 80rem) 60vw, 100vw"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy-950/45">
              {url ? (
                <button
                  type="button"
                  onClick={start}
                  data-testid="play-button"
                  aria-label={t('playLabel', { title: game.title })}
                  className="flex h-16 items-center gap-2.5 rounded-full bg-primary px-9 font-display text-2xl font-bold text-primary-fg shadow-glow transition-transform duration-200 ease-(--ease-spring) hover:scale-105 active:scale-95"
                >
                  <Play aria-hidden="true" className="size-7 fill-current" />
                  {t('play')}
                </button>
              ) : (
                <div className="rounded-card bg-navy-950/85 px-5 py-4 text-center text-white">
                  <p className="font-display text-lg font-semibold">{t('unavailableTitle')}</p>
                  <p className="text-sm text-white/80">{t('unavailableBody')}</p>
                </div>
              )}
              {notice && url ? (
                <p
                  data-testid="low-data-notice"
                  className="rounded-full bg-navy-950/85 px-3.5 py-1 text-sm font-bold text-white"
                >
                  {notice}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <iframe
              ref={frame}
              // The game is told which site frames it, so it can load the SDK from that site.
              src={
                url
                  ? `${url}${url.includes('?') ? '&' : '?'}bg_site=${encodeURIComponent(window.location.origin)}`
                  : undefined
              }
              title={t('frameTitle', { title: game.title })}
              onLoad={onLoad}
              // A different origin plus this sandbox keeps a game away from the site's storage,
              // cookies and DOM. The parent only ever talks to it through postMessage.
              sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups-to-escape-sandbox"
              allow="fullscreen; autoplay; gamepad"
              referrerPolicy="origin"
              data-testid="game-iframe"
              className="absolute inset-0 size-full border-0 bg-black"
            />
            {phase === 'loading' ? (
              <div
                role="status"
                data-testid="game-loading"
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy-950 text-center text-white"
              >
                <Mascot size={120} />
                <p className="font-display text-xl font-semibold">{t('loadingTitle', { name: MASCOT_NAME })}</p>
                <p className="text-sm text-white/75">{t('loadingHint')}</p>
              </div>
            ) : null}
          </>
        )}
      </div>
      {immersive ? (
        <button
          type="button"
          onClick={() => setImmersive(false)}
          aria-label={t('closeGame')}
          className="absolute top-2 left-2 z-10 flex size-10 items-center justify-center rounded-full bg-navy-950/80 text-white"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      ) : null}
    </div>
  );
});
