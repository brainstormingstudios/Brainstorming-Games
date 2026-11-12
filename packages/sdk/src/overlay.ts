/**
 * The debug overlay for the `local` environment: a small panel listing every SDK call and its
 * result, so a developer can check their integration without uploading anything.
 */
const MAX_LINES = 40;

export interface DebugOverlay {
  log(line: string): void;
}

export function createDebugOverlay(): DebugOverlay {
  let panel: HTMLDivElement | null = null;
  let list: HTMLOListElement | null = null;
  const pending: string[] = [];

  const mount = () => {
    if (panel || !document.body) return;
    panel = document.createElement('div');
    panel.setAttribute('data-bg-debug', '');
    panel.style.cssText =
      'position:fixed;right:8px;bottom:8px;z-index:2147483646;width:min(340px,calc(100vw - 16px));max-height:40vh;display:flex;flex-direction:column;border-radius:12px;background:rgba(0,12,48,.92);color:#fcfcfc;font:12px/1.4 ui-monospace,Consolas,monospace;box-shadow:0 8px 24px rgba(0,0,0,.4);border:1px solid #4a72c8';
    const head = document.createElement('button');
    head.type = 'button';
    head.textContent = 'Brainstorming SDK (local) ▾';
    head.style.cssText = 'all:unset;cursor:pointer;padding:6px 10px;font-weight:700;color:#00e8fc';
    list = document.createElement('ol');
    list.style.cssText = 'margin:0;padding:0 10px 8px 26px;overflow:auto';
    head.addEventListener('click', () => {
      if (!list) return;
      const hidden = list.style.display === 'none';
      list.style.display = hidden ? '' : 'none';
      head.textContent = `Brainstorming SDK (local) ${hidden ? '▾' : '▸'}`;
    });
    panel.append(head, list);
    document.body.appendChild(panel);
    pending.splice(0).forEach(add);
  };

  const add = (line: string) => {
    if (!list) {
      pending.push(line);
      return;
    }
    const li = document.createElement('li');
    li.textContent = line;
    list.appendChild(li);
    while (list.children.length > MAX_LINES) list.firstElementChild?.remove();
    list.scrollTop = list.scrollHeight;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  return {
    log(line) {
      console.info(`[BG] ${line}`);
      add(`${new Date().toLocaleTimeString()} ${line}`);
    },
  };
}
