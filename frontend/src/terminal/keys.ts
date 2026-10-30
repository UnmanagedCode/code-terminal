// Clipboard keys: Ctrl+Shift+C copies the selection, Ctrl+Shift+V pastes
// (bracketed by xterm when the program asked for it). Ctrl+C stays ^C.
import type { Terminal } from '@xterm/xterm';

export function attachClipboardKeys(term: Terminal, clipboard: Clipboard = navigator.clipboard): void {
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return true;
    if (e.code === 'KeyC') {
      if (term.hasSelection()) void clipboard.writeText(term.getSelection());
      return false;
    }
    if (e.code === 'KeyV') {
      void clipboard.readText().then((text) => { if (text) term.paste(text); });
      return false;
    }
    return true;
  });
}
