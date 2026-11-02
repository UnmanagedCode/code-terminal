// Clipboard keys: Ctrl+Shift+C copies the selection, Ctrl+Shift+V pastes
// (bracketed by xterm when the program asked for it). Ctrl+C stays ^C.
import type { Terminal } from '@xterm/xterm';

export type ClipboardLike = Pick<Clipboard, 'readText' | 'writeText'>;

// Handles a clipboard key and returns true when `e` was one (the caller must not send it on).
// `onPasted` runs after a paste has been handed to the terminal.
export function handleClipboardKey(term: Terminal, e: KeyboardEvent, clipboard: ClipboardLike = navigator.clipboard, onPasted?: () => void): boolean {
  if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return false;
  if (e.code === 'KeyC') {
    if (term.hasSelection()) void clipboard.writeText(term.getSelection());
    return true;
  }
  if (e.code === 'KeyV') {
    void clipboard.readText().then((text) => {
      if (!text) return;
      term.paste(text);
      onPasted?.();
    });
    return true;
  }
  return false;
}

export function attachClipboardKeys(term: Terminal, clipboard: ClipboardLike = navigator.clipboard): void {
  term.attachCustomKeyEventHandler((e) => !handleClipboardKey(term, e, clipboard));
}
