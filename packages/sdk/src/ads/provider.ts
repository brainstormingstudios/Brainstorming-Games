/** What happened to one ad request. */
export type AdOutcome = 'finished' | 'skipped' | 'error';

/**
 * An ad network adapter. The rules (cooldowns, Spark, chaining) are enforced before a provider
 * is ever called; a provider only shows ads.
 */
export interface AdProvider {
  readonly name: 'mock' | 'adsense-h5' | 'none';
  init(): Promise<void>;
  showMidgame(): Promise<AdOutcome>;
  showRewarded(): Promise<AdOutcome>;
  /** Shows a banner in `slot` (an element the provider may fill). Resolves false if nothing shows. */
  showBanner(slot: HTMLElement, size: string): Promise<boolean>;
  hideBanner(slot: HTMLElement): void;
}

export const noneProvider: AdProvider = {
  name: 'none',
  init: async () => {},
  showMidgame: async () => 'error',
  showRewarded: async () => 'error',
  showBanner: async () => false,
  hideBanner: () => {},
};

/**
 * Best-effort ad-block detection: a bait element that blockers hide, plus a request to the ad
 * script host. Never used to block play; the game is only told.
 */
export async function detectAdblock(doc: Document = document): Promise<boolean> {
  const bait = doc.createElement('div');
  bait.className = 'adsbox ad-banner textads banner-ads pub_300x250';
  bait.setAttribute('aria-hidden', 'true');
  bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:2px;height:2px;';
  doc.body.appendChild(bait);
  await new Promise((r) => setTimeout(r, 60));
  const hidden =
    bait.offsetHeight === 0 || bait.offsetParent === null || getComputedStyle(bait).display === 'none';
  bait.remove();
  if (hidden) return true;
  try {
    await fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
    });
    return false;
  } catch {
    return true;
  }
}
