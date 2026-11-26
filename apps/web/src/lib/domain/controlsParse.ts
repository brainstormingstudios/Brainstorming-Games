import type { ControlRow } from '@/lib/data/types';

/**
 * Reads controls pasted as text, one per line, in the forms developers actually write:
 *   Move: Arrow keys / WASD | Swipe
 *   Jump - Space - Tap
 *   Shoot = Mouse click (touch: Tap)
 *   Pause	Esc	Two-finger tap         (copied from a spreadsheet)
 *   - Dash: Shift                          (bullets and numbering are ignored)
 * Keyboard and touch parts are optional. At most `max` rows.
 */
export function parseControls(text: string, max = 12): ControlRow[] {
  const rows: ControlRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!line || /^(action|control)s?\s*[:|\t-]/i.test(line) && /keyboard|touch/i.test(line)) continue; // header row
    let touch = '';
    const touchTag = /\(\s*(?:touch|mobile|phone)\s*:\s*([^)]+)\)\s*$/i.exec(line);
    if (touchTag) {
      touch = touchTag[1]!.trim();
      line = line.slice(0, touchTag.index).trim();
    }
    let parts: string[];
    if (line.includes('\t')) parts = line.split('\t');
    else {
      const m = /^(.+?)\s*(?::|=|→|->|\s-\s|\s–\s)\s*(.+)$/.exec(line);
      parts = m ? [m[1]!, ...m[2]!.split(/\s*(?:\||\s-\s|\s–\s)\s*/)] : [line];
    }
    parts = parts.map((p) => p.trim()).filter((p, i) => i === 0 || p.length > 0);
    const action = (parts[0] ?? '').slice(0, 60);
    if (!action) continue;
    const keyboard = (parts[1] ?? '').slice(0, 60);
    touch = (touch || parts[2] || '').slice(0, 60);
    rows.push({ action, keyboard, touch });
    if (rows.length >= max) break;
  }
  return rows;
}
