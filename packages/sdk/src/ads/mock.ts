import type { AdOutcome, AdProvider } from './provider';

const STYLE_ID = 'bg-mock-ad-style';
const CSS = `
.bg-mock-ad{position:absolute;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,12,48,.94);color:#fcfcfc;font:600 16px/1.4 system-ui,sans-serif;text-align:center}
.bg-mock-ad b{font-size:22px}
.bg-mock-ad span{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;border:3px solid #00e8fc;font-size:22px;color:#00e8fc}
.bg-mock-ad button{border:0;border-radius:12px;padding:10px 18px;background:#00c0f0;color:#000c30;font-weight:800;cursor:pointer}
.bg-mock-banner{display:flex;align-items:center;justify-content:center;box-sizing:border-box;border:2px dashed #4a72c8;border-radius:8px;background:#0c2a6e;color:#dce6f2;font:700 12px system-ui,sans-serif}
`;

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

export interface MockProviderOptions {
  /** Element the fake ad covers. It gets `position: relative` if it is static. */
  container: () => HTMLElement;
  durationMs?: number;
}

/**
 * The mock provider: a 5-second fake ad with a countdown. Used in development and in Spark
 * Launch tests. Rewarded mock ads have a "Close" button so the "closed early" path can be tried.
 */
export function createMockProvider({ container, durationMs = 5000 }: MockProviderOptions): AdProvider {
  const show = (kind: 'midgame' | 'rewarded') =>
    new Promise<AdOutcome>((resolve) => {
      const host = container();
      const doc = host.ownerDocument;
      ensureStyle(doc);
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const el = doc.createElement('div');
      el.className = 'bg-mock-ad';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Advertisement');
      el.setAttribute('data-testid', 'mock-ad');
      const title = doc.createElement('b');
      title.textContent = kind === 'rewarded' ? 'Rewarded ad (mock)' : 'Ad break (mock)';
      const counter = doc.createElement('span');
      const note = doc.createElement('div');
      note.textContent = 'This is a test ad. No real ad is shown in development.';
      el.append(title, counter, note);
      let left = Math.ceil(durationMs / 1000);
      counter.textContent = String(left);
      let done = false;
      const finish = (outcome: AdOutcome) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        el.remove();
        resolve(outcome);
      };
      if (kind === 'rewarded') {
        const close = doc.createElement('button');
        close.type = 'button';
        close.textContent = 'Close (no reward)';
        close.setAttribute('data-testid', 'mock-ad-close');
        close.addEventListener('click', () => finish('skipped'));
        el.append(close);
      }
      host.appendChild(el);
      const timer = setInterval(() => {
        left -= 1;
        counter.textContent = String(Math.max(left, 0));
        if (left <= 0) finish('finished');
      }, 1000);
    });

  return {
    name: 'mock',
    init: async () => {},
    showMidgame: () => show('midgame'),
    showRewarded: () => show('rewarded'),
    async showBanner(slot, size) {
      ensureStyle(slot.ownerDocument);
      const [w, h] = size.split('x').map((n) => Number.parseInt(n, 10));
      const box = slot.ownerDocument.createElement('div');
      box.className = 'bg-mock-banner';
      box.setAttribute('data-bg-banner', '');
      box.style.width = `${w || 320}px`;
      box.style.height = `${h || 50}px`;
      box.textContent = `Banner ad (mock) ${size}`;
      slot.replaceChildren(box);
      return true;
    },
    hideBanner(slot) {
      slot.querySelector('[data-bg-banner]')?.remove();
    },
  };
}
