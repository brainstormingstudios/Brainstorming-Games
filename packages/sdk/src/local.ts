import { AdRules } from './adRules';
import { createMockProvider } from './ads/mock';
import { detectAdblock } from './ads/provider';
import { DEFAULT_SETTINGS, type LeaderboardTop, type Methods, type MethodName } from './protocol';

type Handler<M extends MethodName> = (params: Methods[M]['params']) => Promise<Methods[M]['result']>;
export type LocalHandlers = { [M in MethodName]: Handler<M> };

const STORE = 'bg-sdk:';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORE + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * The `local` environment (the game runs on localhost on its own): ads are the mock provider
 * with the real rules, saves go to localStorage, leaderboards live in memory, and every call is
 * logged to the console and the debug overlay.
 */
export function createLocalHandlers(log: (line: string) => void): LocalHandlers {
  const rules = new AdRules({ spark: false, enabled: true });
  const provider = createMockProvider({ container: () => document.body });
  const scores: { board: string; score: number }[] = [];
  const banners = new Map<string, HTMLElement>();

  return {
    hello: async () => ({
      gameId: 'local',
      versionId: null,
      settings: DEFAULT_SETTINGS,
      user: null,
      inviteParams: Object.fromEntries(new URLSearchParams(location.search)),
      gameUrl: location.href.split('?')[0]!,
      spark: false,
      preview: false,
    }),
    'game.event': async ({ name }) => {
      if (name === 'gameplay_start') {
        rules.gameplayStart();
        for (const id of rules.bannersToHide()) {
          const slot = banners.get(id);
          if (slot) provider.hideBanner(slot);
        }
      }
      if (name === 'gameplay_stop') rules.gameplayStop();
      return null;
    },
    'game.celebrate': async () => {
      log('celebrate (the mascot pops in with confetti on Brainstorming Games)');
      return null;
    },
    'game.progress': async () => null,
    'game.context': async () => null,
    'game.room': async () => null,
    'ad.midgame': async () => {
      const reason = rules.checkMidgame();
      if (reason) return { shown: false, reason };
      rules.adStarted();
      const outcome = await provider.showMidgame();
      if (outcome === 'error') {
        rules.adFailed();
        return { shown: false, reason: 'error' };
      }
      rules.midgameDone();
      return { shown: true };
    },
    'ad.rewarded': async () => {
      const reason = rules.checkRewarded();
      if (reason) return { rewarded: false, reason };
      rules.adStarted();
      const outcome = await provider.showRewarded();
      if (outcome === 'error') {
        rules.adFailed();
        return { rewarded: false, reason: 'error' };
      }
      rules.rewardedDone();
      return { rewarded: outcome === 'finished' };
    },
    'ad.banner': async ({ containerId, size }) => {
      const reason = rules.checkBanner(containerId);
      if (reason) return { shown: false, reason };
      const slot = document.getElementById(containerId);
      if (!slot) return { shown: false, reason: 'unavailable' };
      const shown = await provider.showBanner(slot, size);
      if (shown) {
        rules.bannerShown(containerId);
        banners.set(containerId, slot);
      }
      return shown ? { shown: true } : { shown: false, reason: 'unavailable' };
    },
    'ad.hideBanner': async ({ containerId }) => {
      const slot = banners.get(containerId);
      if (slot) provider.hideBanner(slot);
      banners.delete(containerId);
      rules.bannerHidden(containerId);
      return null;
    },
    'ad.adblock': () => detectAdblock(),
    'user.get': async () => null,
    'user.token': async () => null,
    'user.login': async () => {
      log('promptLogin: players log in on Brainstorming Games; locally there is no account');
      return null;
    },
    'data.get': async ({ key }) => read(`data:${key}`, null),
    'data.set': async ({ key, value }) => {
      localStorage.setItem(`${STORE}data:${key}`, JSON.stringify(value));
      return null;
    },
    'data.remove': async ({ key }) => {
      localStorage.removeItem(`${STORE}data:${key}`);
      return null;
    },
    'lb.submit': async ({ board, score }) => {
      scores.push({ board, score });
      return { accepted: true };
    },
    'lb.top': async ({ board, limit }): Promise<LeaderboardTop> => {
      const best = scores
        .filter((s) => s.board === board)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      const entries = best.map((s, i) => ({ rank: i + 1, name: 'You (local)', score: s.score, isMe: true }));
      return { entries, me: entries[0] ?? null };
    },
    'quests.track': async () => null,
    // Clips are recorded only inside the Brainstorming Games player.
    'clip.result': async () => null,
  };
}
