import { describe, expect, it } from 'vitest';
import { parseControls } from '@/lib/domain/controlsParse';
import { keyCaps } from '@/components/game/ControlsPanel';

describe('pasted controls', () => {
  it('reads the common ways developers write controls', () => {
    expect(
      parseControls(`Action | Keyboard | Touch
Move: Arrow keys / WASD | Swipe
- Jump - Space - Tap
2. Shoot = Mouse click (touch: Tap)
Pause\tEsc\tTwo-finger tap
Dash: Shift`),
    ).toEqual([
      { action: 'Move', keyboard: 'Arrow keys / WASD', touch: 'Swipe' },
      { action: 'Jump', keyboard: 'Space', touch: 'Tap' },
      { action: 'Shoot', keyboard: 'Mouse click', touch: 'Tap' },
      { action: 'Pause', keyboard: 'Esc', touch: 'Two-finger tap' },
      { action: 'Dash', keyboard: 'Shift', touch: '' },
    ]);
  });

  it('ignores blank lines, caps the count and the length', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Act ${i}: K`).join('\n\n');
    expect(parseControls(many)).toHaveLength(12);
    expect(parseControls(`${'x'.repeat(100)}: y`)[0]!.action).toHaveLength(60);
  });

  it('turns key text into key caps', () => {
    expect(keyCaps('Arrow keys / WASD, Space or click')).toEqual(['Arrow keys', 'WASD', 'Space', 'click']);
  });
});
