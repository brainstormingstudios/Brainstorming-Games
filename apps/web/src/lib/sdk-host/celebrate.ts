/**
 * `BG.game.celebrate()`: the mascot pops in over the game with a cyan-glow confetti burst.
 * Plain DOM (it runs from the SDK bridge, outside React) using the classes in mascot.css.
 */
export function celebrate(container: HTMLElement): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.setAttribute('data-testid', 'celebration');
  wrap.style.cssText =
    'position:absolute;right:16px;bottom:16px;z-index:6;width:120px;height:120px;pointer-events:none;animation:bg-pop-in .3s cubic-bezier(.34,1.56,.64,1) both';
  const mascot = document.createElement('img');
  mascot.src = '/brand/mascot-256.webp';
  mascot.alt = '';
  mascot.width = 120;
  mascot.height = 120;
  mascot.className = reduced ? '' : 'bg-mascot--celebrate';
  mascot.style.cssText = 'display:block;width:120px;height:120px;filter:drop-shadow(0 0 14px rgba(0,232,252,.7))';
  wrap.appendChild(mascot);
  if (!reduced) {
    const burst = document.createElement('span');
    burst.className = 'bg-confetti';
    for (let i = 0; i < 14; i++) {
      const piece = document.createElement('i');
      const angle = (Math.PI * 2 * i) / 14 - Math.PI / 2;
      const distance = 90 + (i % 3) * 34;
      piece.style.setProperty('--i', String(i));
      piece.style.setProperty('--x', `${Math.round(Math.cos(angle) * distance)}px`);
      piece.style.setProperty('--y', `${Math.round(Math.sin(angle) * distance - 20)}px`);
      piece.style.setProperty('--r', `${(i % 2 === 0 ? 1 : -1) * (180 + i * 26)}deg`);
      burst.appendChild(piece);
    }
    wrap.appendChild(burst);
  }
  container.appendChild(wrap);
  window.setTimeout(() => wrap.remove(), 2200);
}
