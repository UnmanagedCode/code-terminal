import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem = { label: string; run(): void };

// A small `role="menu"` popup, rendered in `document.body` so the tab strip's
// scroll box cannot clip it, and placed under `anchor`: right edges aligned, or
// left edges when that would run off the left of the viewport, always kept
// inside it with a small margin. It closes when the page scrolls or resizes,
// since a fixed menu would no longer sit under its opener.
// The first item is focused on open, ↑/↓ move, Esc, a press outside or a
// selection closes it; `onClose(true)` asks the opener to take focus back. A
// press on an opener (`data-menu-opener`) is left to its own click, which toggles.
const MARGIN = 8;

export function TabMenu({ label, items, anchor, onClose }: { label: string; items: MenuItem[]; anchor: DOMRect; onClose(refocus: boolean): void }) {
  const root = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(MARGIN);
  useLayoutEffect(() => {
    const width = root.current?.getBoundingClientRect().width ?? 0;
    const room = document.documentElement.clientWidth - width - MARGIN;
    const preferred = anchor.right - width >= MARGIN ? anchor.right - width : anchor.left;
    setLeft(Math.max(MARGIN, Math.min(preferred, room)));
  }, [anchor]);
  const buttons = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  useEffect(() => {
    buttons()[0]?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!root.current?.contains(t) && !t.closest?.('[data-menu-opener]')) onClose(false);
    };
    const drift = () => onClose(false);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('scroll', drift, true);
    window.addEventListener('resize', drift);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('scroll', drift, true);
      window.removeEventListener('resize', drift);
    };
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
      style={{ top: anchor.bottom, left }}>
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className="menu-item" onClick={() => { onClose(true); it.run(); }}>{it.label}</button>
      ))}
    </div>,
    document.body,
  );
}
