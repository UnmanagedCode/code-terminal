import { useEffect } from 'react';

// Ctrl/⌘+1…8 activate that tab, Ctrl/⌘+9 the last one. Registered in the capture
// phase and swallowing the key: xterm turns Ctrl+2…8 into control bytes and
// stops the event, so a bubbling listener would never see it inside a terminal.
// Only works while focus is inside the plugin's frame.
export function useTabShortcuts(count: () => number, activate: (index: number) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (!/^[1-9]$/.test(e.key)) return;
      // A modal keeps its own keys.
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation();
      activate(e.key === '9' ? count() - 1 : Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [count, activate]);
}
