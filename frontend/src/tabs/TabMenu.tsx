import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem = { label: string; run(): void };

// A small `role="menu"` popup, rendered in `document.body` so the tab strip's
// scroll box cannot clip it, and placed under `anchor` (its right edges aligned).
// The first item is focused on open, ↑/↓ move, Esc, a press outside or a
// selection closes it; `onClose(true)` asks the opener to take focus back. A
// press on an opener (`data-menu-opener`) is left to its own click, which toggles.
export function TabMenu({ label, items, anchor, onClose }: { label: string; items: MenuItem[]; anchor: DOMRect; onClose(refocus: boolean): void }) {
  const root = useRef<HTMLDivElement>(null);
  const buttons = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  useEffect(() => {
    buttons()[0]?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!root.current?.contains(t) && !t.closest?.('[data-menu-opener]')) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') all[(at + 1) % all.length]?.focus();
    else if (e.key === 'ArrowUp') all[(at - 1 + all.length) % all.length]?.focus();
    else if (e.key === 'Escape') onClose(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div className="menu" role="menu" aria-label={label} ref={root} onKeyDown={onKeyDown}
      style={{ top: anchor.bottom, right: document.documentElement.clientWidth - anchor.right }}>
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className="menu-item" onClick={() => { onClose(true); it.run(); }}>{it.label}</button>
      ))}
    </div>,
    document.body,
  );
}
