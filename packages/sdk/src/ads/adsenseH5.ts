import type { AdOutcome, AdProvider } from './provider';

/**
 * Google's H5 Games Ads (Ad Placement API) adapter. Behind a flag: it needs an AdSense account
 * approved for H5 games ads. Only non-personalised ads are requested unless the host says the
 * player is a consenting adult.
 */
interface AdBreakArgs {
  type: 'start' | 'pause' | 'next' | 'browse' | 'reward' | 'preroll';
  name: string;
  beforeAd?: () => void;
  afterAd?: () => void;
  beforeReward?: (showAdFn: () => void) => void;
  adDismissed?: () => void;
  adViewed?: () => void;
  adBreakDone?: (info: { breakStatus: string }) => void;
}

type AdsByGoogle = unknown[] & { requestNonPersonalizedAds?: number };

declare global {
  interface Window {
    adsbygoogle?: AdsByGoogle;
    adBreak?: (args: AdBreakArgs) => void;
    adConfig?: (args: Record<string, unknown>) => void;
  }
}

export interface AdsenseH5Options {
  client: string;
  personalised: boolean;
  /** Test mode: Google shows test ads. */
  test?: boolean;
}

export function createAdsenseH5Provider({ client, personalised, test }: AdsenseH5Options): AdProvider {
  let ready: Promise<void> | null = null;
  const init = () =>
    (ready ??= new Promise<void>((resolve, reject) => {
      const w = window;
      w.adsbygoogle = w.adsbygoogle || ([] as unknown as AdsByGoogle);
      if (!personalised) w.adsbygoogle.requestNonPersonalizedAds = 1;
      w.adBreak = w.adConfig = function (o: unknown) {
        (w.adsbygoogle as unknown[]).push(o);
      };
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
      s.crossOrigin = 'anonymous';
      s.dataset.adFrequencyHint = '180s';
      if (test) s.dataset.adbreakTest = 'on';
      s.onload = () => {
        w.adConfig?.({ preloadAdBreaks: 'on', sound: 'on' });
        resolve();
      };
      s.onerror = () => reject(new Error('adsense blocked'));
      document.head.appendChild(s);
    }));

  const run = (type: 'next' | 'reward') =>
    new Promise<AdOutcome>((resolve) => {
      let outcome: AdOutcome = 'skipped';
      init()
        .then(() => {
          window.adBreak?.({
            type,
            name: type === 'reward' ? 'bg-rewarded' : 'bg-midgame',
            beforeReward: (showAdFn) => showAdFn(),
            adViewed: () => (outcome = 'finished'),
            adDismissed: () => (outcome = 'skipped'),
            afterAd: () => {
              if (type === 'next') outcome = 'finished';
            },
            adBreakDone: (info) => resolve(info.breakStatus === 'viewed' || outcome === 'finished' ? outcome : info.breakStatus === 'error' ? 'error' : outcome),
          });
        })
        .catch(() => resolve('error'));
    });

  return {
    name: 'adsense-h5',
    init,
    showMidgame: () => run('next'),
    showRewarded: () => run('reward'),
    // H5 games ads have no banner format; banners use the display adapter on the site instead.
    showBanner: async () => false,
    hideBanner: () => {},
  };
}
