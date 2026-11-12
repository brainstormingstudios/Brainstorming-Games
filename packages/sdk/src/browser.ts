// Script-tag entry: exposes the SDK as `window.BG`.
import BG from './index';

declare global {
  interface Window {
    BG?: typeof BG;
  }
}

window.BG = BG;
