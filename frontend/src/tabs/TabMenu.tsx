import { useEffect, useRef } from 'react';

export type MenuItem = { label: string; run(): void };

// A small `role="menu"` popup: the first item is focused on open, ↑/↓ move,
// Esc, a press outside or a selection closes it. `onClose(true)` asks the
// opener to take focus back.
export function TabMenu({ label, items, onClose }: { label: string; items: MenuItem[]; onClose(refocus: boolean): void }) {
  const root = useRef<HTMLDivElement>(null);
  const buttons = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  useEffect(() => {
    buttons()[0]?.focus();
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) onClose(false); };
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

  return (
    <div className="menu" role="menu" aria-label={label} ref={root} onKeyDown={onKeyDown}>
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className="menu-item" onClick={() => { onClose(true); it.run(); }}>{it.label}</button>
      ))}
    </div>
  );
}
