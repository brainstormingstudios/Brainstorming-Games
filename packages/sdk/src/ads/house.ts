import type { AdOutcome, AdProvider } from './provider';

const STYLE_ID = 'bg-house-ad-style';
const CSS = `
.bg-house-ad{position:absolute;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(4,6,12,.96);font:600 15px/1.4 system-ui,sans-serif;color:#fcfcfc;animation:bg-house-in .25s ease both}
@keyframes bg-house-in{from{opacity:0}to{opacity:1}}
.bg-house-ad video{max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;background:#000}
.bg-house-ad .bar{position:absolute;left:0;right:0;bottom:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;padding:0 12px}
.bg-house-ad a,.bg-house-ad button{border:0;border-radius:12px;padding:10px 16px;font:800 14px system-ui,sans-serif;cursor:pointer;text-decoration:none}
.bg-house-ad a{background:#00c0f0;color:#04131c}
.bg-house-ad button{background:rgba(255,255,255,.16);color:#fff;backdrop-filter:blur(6px)}
.bg-house-ad button.claim{background:#22c55e;color:#04130a}
.bg-house-ad button[disabled]{opacity:.6;cursor:default}
.bg-house-ad .tag{position:absolute;top:12px;left:12px;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.6);font-size:12px}
.bg-house-ad .progress{position:absolute;left:0;right:0;top:0;height:3px;background:rgba(255,255,255,.15)}
.bg-house-ad .progress i{display:block;height:100%;width:0;background:#00c0f0;transition:width .25s linear}
.bg-house-banner{display:flex;align-items:center;gap:10px;box-sizing:border-box;padding:6px;border-radius:8px;background:#0c1428;color:#fff;font:700 12px system-ui,sans-serif;text-decoration:none;overflow:hidden}
.bg-house-banner img{height:100%;aspect-ratio:16/9;object-fit:cover;border-radius:4px}
`;

export interface HouseAd {
  /** Promo video (MP4, any shape) and a still for when it cannot play. */
  video: string;
  poster: string;
  /** Where a click goes (opens in a new tab). */
  href: string;
  title: string;
  cta: string;
}

/** How long a break lasts before it can be skipped, and before a rewarded break pays out. */
export interface HouseTiming {
  /** Seconds before a normal break can be skipped. */
  skipAfter: number;
  /** Seconds a rewarded break must play before the reward can be claimed (0: at once). */
  rewardAfter: number;
}

export interface HouseProviderOptions {
  container: () => HTMLElement;
  /** The ads to rotate through; read at each break so the list can grow (for example BS Originals trailers). */
  ads: HouseAd[] | (() => HouseAd[]);
  /** Read at each break, so it follows the player's plan. Default: skip after 5 s, reward after 15 s. */
  timing?: HouseTiming | (() => HouseTiming);
}

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

const DEFAULT_TIMING: HouseTiming = { skipAfter: 5, rewardAfter: 15 };

/**
 * Our own ads: the Brainstorming Studios ad and BS Originals trailers, in rotation (never the same
 * one twice in a row). A normal break can be skipped after `skipAfter` seconds; a rewarded break
 * pays out once `rewardAfter` seconds have played (a Claim button appears) or the video ends.
 * Plays with sound, since the player chose the break; falls back to muted if the browser refuses.
 */
export function createHouseProvider({ container, ads, timing = DEFAULT_TIMING }: HouseProviderOptions): AdProvider {
  const list = () => (typeof ads === 'function' ? ads() : ads).filter((a) => a.video);
  const when = () => (typeof timing === 'function' ? timing() : timing);
  let last = -1;
  const pick = (): HouseAd | null => {
    const all = list();
    if (all.length === 0) return null;
    let i = Math.floor(Math.random() * all.length);
    if (all.length > 1 && i === last) i = (i + 1) % all.length;
    last = i;
    return all[i]!;
  };

  const show = (kind: 'midgame' | 'rewarded') =>
    new Promise<AdOutcome>((resolve) => {
      const ad = pick();
      if (!ad) return resolve('error');
      const { skipAfter, rewardAfter } = when();
      const host = container();
      const doc = host.ownerDocument;
      ensureStyle(doc);
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const el = doc.createElement('div');
      el.className = 'bg-house-ad';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Advertisement');
      el.setAttribute('data-testid', 'house-ad');
      el.setAttribute('data-kind', kind);
      const tag = doc.createElement('span');
      tag.className = 'tag';
      tag.textContent = kind === 'rewarded' ? 'Ad · reward' : 'Ad';
      const progress = doc.createElement('div');
      progress.className = 'progress';
      const fill = doc.createElement('i');
      progress.append(fill);
      const video = doc.createElement('video');
      video.src = ad.video;
      video.poster = ad.poster;
      video.playsInline = true;
      video.autoplay = true;
      const bar = doc.createElement('div');
      bar.className = 'bar';
      const link = doc.createElement('a');
      link.href = ad.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer sponsored';
      link.textContent = ad.cta;
      const skip = doc.createElement('button');
      skip.type = 'button';
      skip.setAttribute('data-testid', 'house-ad-skip');
      bar.append(link, skip);
      el.append(video, progress, tag, bar);
      host.appendChild(el);

      let done = false;
      let watched = 0;
      const finish = (outcome: AdOutcome) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        video.pause();
        el.remove();
        resolve(outcome);
      };
      const earned = () => kind === 'rewarded' && watched >= rewardAfter;
      const label = () => {
        if (kind === 'rewarded') {
          const left = Math.max(0, Math.ceil(rewardAfter - watched));
          skip.disabled = false;
          skip.className = left === 0 ? 'claim' : '';
          skip.textContent = left === 0 ? 'Claim reward' : `Reward in ${left} · Close`;
          skip.setAttribute('data-testid', left === 0 ? 'house-ad-claim' : 'house-ad-skip');
          return;
        }
        const left = Math.max(0, Math.ceil(skipAfter - watched));
        skip.disabled = left > 0;
        skip.textContent = left > 0 ? `Skip in ${left}` : 'Skip';
      };
      label();
      skip.addEventListener('click', () => finish(kind === 'rewarded' ? (earned() ? 'finished' : 'skipped') : 'finished'));
      video.addEventListener('ended', () => finish('finished'));
      video.addEventListener('error', () => finish('error'));
      // Autoplay with sound can be refused; play muted instead of failing the break.
      void video.play().catch(() => {
        video.muted = true;
        void video.play().catch(() => finish('error'));
      });
      // Count time actually shown (paused or hidden tabs do not count).
      const timer = setInterval(() => {
        if (!video.paused && doc.visibilityState !== 'hidden') watched += 0.25;
        if (video.duration > 0) fill.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
        label();
      }, 250);
    });

  return {
    name: 'house',
    init: async () => {},
    showMidgame: () => show('midgame'),
    showRewarded: () => show('rewarded'),
    async showBanner(slot) {
      const ad = pick();
      if (!ad) return false;
      ensureStyle(slot.ownerDocument);
      const a = slot.ownerDocument.createElement('a');
      a.className = 'bg-house-banner';
      a.setAttribute('data-bg-banner', '');
      a.href = ad.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer sponsored';
      a.style.width = '100%';
      a.style.height = '100%';
      const img = slot.ownerDocument.createElement('img');
      img.src = ad.poster;
      img.alt = '';
      const text = slot.ownerDocument.createElement('span');
      text.textContent = `${ad.title} · ${ad.cta}`;
      a.append(img, text);
      slot.replaceChildren(a);
      return true;
    },
    hideBanner(slot) {
      slot.querySelector('[data-bg-banner]')?.remove();
    },
  };
}
