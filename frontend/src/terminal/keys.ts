// Clipboard keys: Ctrl+Shift+C copies the selection, Ctrl+Shift+V pastes
// (bracketed by xterm when the program asked for it). Ctrl+C stays ^C.
import type { Terminal } from '@xterm/xterm';

export type ClipboardLike = Pick<Clipboard, 'readText' | 'writeText'>;

// Handles a clipboard key and returns true when `e` was one (the caller must not send it on).
// `before` runs just before a paste is handed to the terminal, `after` just after.
export function handleClipboardKey(term: Terminal, e: KeyboardEvent, clipboard: ClipboardLike = navigator.clipboard, hooks: { before?: () => void; after?: () => void } = {}): boolean {
  if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return false;
  if (e.code === 'KeyC') {
    if (term.hasSelection()) void clipboard.writeText(term.getSelection());
    return true;
  }
  if (e.code === 'KeyV') {
    void clipboard.readText().then((text) => {
      if (!text) return;
      hooks.before?.();
      term.paste(text);
      hooks.after?.();
    });
    return true;
  }
  return false;
}

export function attachClipboardKeys(term: Terminal, clipboard: ClipboardLike = navigator.clipboard): void {
  term.attachCustomKeyEventHandler((e) => !handleClipboardKey(term, e, clipboard));
}
