/**
 * bg-crazygames-shim.js: runs games written for the CrazyGames SDK v3 on Brainstorming Games.
 *
 * Load it after bg-sdk.js and remove the CrazyGames script tag:
 *   <script src="https://<site>/sdk/v1/bg-sdk.js"></script>
 *   <script src="https://<site>/sdk/v1/bg-crazygames-shim.js"></script>
 *
 * It defines `window.CrazyGames.SDK` with the same method names, each mapped onto `window.BG`.
 * Only behaviour that both platforms share is mapped; anything else resolves safely.
 */
import type BGType from './index';

type BG = typeof BGType;

interface AdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: { code: string; message: string }) => void;
}

declare global {
  interface Window {
    CrazyGames?: { SDK: unknown };
  }
}

function install(bg: BG) {
  const ready = bg.init();
  const after = <T>(fn: () => Promise<T> | T) => ready.then(fn);

  const SDK = {
    init: () => ready,
    get environment() {
      // CrazyGames calls these 'crazygames' | 'local' | 'disabled'.
      return bg.environment === 'brainstorming' ? 'crazygames' : bg.environment;
    },
    isQaTool: false,
    game: {
      loadingStart: () => after(() => bg.game.loadingStart()),
      loadingStop: () => after(() => bg.game.loadingStop()),
      gameplayStart: () => after(() => bg.game.gameplayStart()),
      gameplayStop: () => after(() => bg.game.gameplayStop()),
      happytime: () => after(() => bg.game.celebrate()),
      inviteLink: (params: Record<string, string>) => bg.game.inviteLink(params),
      getInviteParam: (name: string) => bg.game.getInviteParam(name),
      showInviteButton: (params: Record<string, string>) => bg.game.inviteLink(params),
      hideInviteButton: () => undefined,
      updateRoom: (room: { roomId: string; isJoinable: boolean; inviteParams?: Record<string, string> }) =>
        after(() => bg.game.updateRoom(room)),
      get settings() {
        const s = bg.game.settings;
        return { disableChat: s.disableChat, muteAudio: s.muteAudio };
      },
      addSettingsChangeListener: (cb: (s: { disableChat: boolean; muteAudio: boolean }) => void) =>
        bg.game.onSettingsChange((s) => cb({ disableChat: s.disableChat, muteAudio: s.muteAudio })),
      removeSettingsChangeListener: () => undefined,
      // Not supported on Brainstorming Games; resolved safely.
      isInstantMultiplayer: false,
    },
    ad: {
      async requestAd(type: 'midgame' | 'rewarded', callbacks: AdCallbacks = {}) {
        await ready;
        if (type === 'rewarded') {
          const r = await bg.ad.rewarded({ onStart: callbacks.adStarted });
          if (r.rewarded) callbacks.adFinished?.();
          else callbacks.adError?.({ code: r.reason ?? 'unfilled', message: 'No reward' });
          return;
        }
        const r = await bg.ad.midgame({ onStart: callbacks.adStarted });
        if (r.shown) callbacks.adFinished?.();
        else callbacks.adError?.({ code: r.reason ?? 'unfilled', message: 'No ad shown' });
      },
      hasAdblock: () => after(() => bg.ad.hasAdblock()),
    },
    banner: {
      requestBanner: (b: { id: string; width: number; height: number }) =>
        after(() => bg.ad.showBanner({ containerId: b.id, size: `${b.width}x${b.height}` })),
      requestResponsiveBanner: (id: string) => after(() => bg.ad.showBanner({ containerId: id })),
      clearBanner: (id: string) => bg.ad.hideBanner(id),
      clearAllBanners: () => undefined,
    },
    user: {
      getUser: () => after(() => bg.user.get()),
      getUserToken: () => after(() => bg.user.getToken()),
      showAuthPrompt: () => after(() => bg.user.promptLogin()),
      addAuthListener: (cb: (u: unknown) => void) => bg.user.onAuthChange(cb),
      removeAuthListener: () => undefined,
      get isUserAccountAvailable() {
        return bg.environment === 'brainstorming';
      },
      getSystemInfo: () => ({ countryCode: '', locale: navigator.language, device: { type: 'desktop' } }),
    },
    data: {
      getItem: (key: string) => after(() => bg.data.get(key)),
      setItem: (key: string, value: unknown) => after(() => bg.data.set(key, value)),
      removeItem: (key: string) => after(() => bg.data.remove(key)),
      clear: () => Promise.resolve(),
    },
  };
  window.CrazyGames = { SDK };
}

if (typeof window !== 'undefined') {
  if (window.BG) install(window.BG);
  else console.warn('[bg-crazygames-shim] Load bg-sdk.js before the shim.');
}
