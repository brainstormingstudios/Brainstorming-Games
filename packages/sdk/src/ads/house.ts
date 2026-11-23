import type { AdOutcome, AdProvider } from './provider';

const STYLE_ID = 'bg-house-ad-style';
const CSS = `
.bg-house-ad{position:absolute;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(4,6,12,.96);font:600 15px/1.4 system-ui,sans-serif;color:#fcfcfc}
.bg-house-ad video{max-width:100%;max-height:100%;height:100%;aspect-ratio:9/16;object-fit:contain;background:#000}
.bg-house-ad .bar{position:absolute;left:0;right:0;bottom:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;padding:0 12px}
.bg-house-ad a,.bg-house-ad button{border:0;border-radius:12px;padding:10px 16px;font:800 14px system-ui,sans-serif;cursor:pointer;text-decoration:none}
.bg-house-ad a{background:#ff2a2a;color:#fff}
.bg-house-ad button{background:rgba(255,255,255,.14);color:#fff}
.bg-house-ad button[disabled]{opacity:.6;cursor:default}
.bg-house-ad .tag{position:absolute;top:12px;left:12px;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.6);font-size:12px}
.bg-house-banner{display:flex;align-items:center;gap:10px;box-sizing:border-box;padding:6px;border-radius:8px;background:#1a0608;color:#fff;font:700 12px system-ui,sans-serif;text-decoration:none;overflow:hidden}
.bg-house-banner img{height:100%;aspect-ratio:9/16;object-fit:cover;border-radius:4px}
`;

export interface HouseAd {
  /** Vertical promo video (MP4) and a still for when it cannot play. */
  video: string;
  poster: string;
  /** Where a click goes (opens in a new tab). */
  href: string;
  title: string;
  cta: string;
}

export interface HouseProviderOptions {
  container: () => HTMLElement;
  ad: HouseAd;
  /** Seconds before a break can be skipped; rewarded breaks play to the end. */
  skipAfter?: number;
}

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

/**
 * Our own ad: the Brainstorming Studios promo, shown in ad breaks while no ad network is set up
 * (NEXT_PUBLIC_INGAME_ADS=house). Breaks can be skipped after `skipAfter` seconds; a rewarded break
 * counts once the video has played to the end. Plays with sound, since the player chose the break.
 */
export function createHouseProvider({ container, ad, skipAfter = 5 }: HouseProviderOptions): AdProvider {
  const show = (kind: 'midgame' | 'rewarded') =>
    new Promise<AdOutcome>((resolve) => {
      const host = container();
      const doc = host.ownerDocument;
      ensureStyle(doc);
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const el = doc.createElement('div');
      el.className = 'bg-house-ad';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Advertisement');
      el.setAttribute('data-testid', 'house-ad');
      const tag = doc.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Ad';
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
      el.append(video, tag, bar);
      host.appendChild(el);

      let done = false;
      let left = skipAfter;
      const finish = (outcome: AdOutcome) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        video.pause();
        el.remove();
        resolve(outcome);
      };
      const label = () => {
        if (kind === 'rewarded') {
          skip.textContent = 'Close (no reward)';
          return;
        }
        skip.disabled = left > 0;
        skip.textContent = left > 0 ? `Skip in ${left}` : 'Skip';
      };
      label();
      skip.addEventListener('click', () => finish(kind === 'rewarded' ? 'skipped' : 'finished'));
      video.addEventListener('ended', () => finish('finished'));
      video.addEventListener('error', () => finish('error'));
      // Autoplay with sound can be refused; play muted instead of failing the break.
      void video.play().catch(() => {
        video.muted = true;
        void video.play().catch(() => finish('error'));
      });
      const timer = setInterval(() => {
        left -= 1;
        label();
      }, 1000);
    });

  return {
    name: 'house',
    init: async () => {},
    showMidgame: () => show('midgame'),
    showRewarded: () => show('rewarded'),
    async showBanner(slot) {
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
