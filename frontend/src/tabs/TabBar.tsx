// One tab per open checkout, with its actions menu, and a + that opens the picker.
import { useCallback, useRef, useState } from 'react';
import { checkoutKey, checkoutLabel, type Checkout } from '../checkout';
import { CloseIcon, EllipsisVerticalIcon, PlusIcon } from '../icons';
import { TabMenu, type MenuItem } from './TabMenu';

type Props = {
  tabs: Checkout[];
  active: number;
  // Why a tab's checkout no longer exists in cc; null while it does.
  goneReason(c: Checkout): string | null;
  onActivate(index: number): void;
  onClose(index: number): void;
  onCloseOthers(index: number): void;
  onOpenPicker(): void;
  onError(e: unknown): void;
};

export function TabBar({ tabs, active, goneReason, onActivate, onClose, onCloseOthers, onOpenPicker, onError }: Props) {
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const moreButtons = useRef(new Map<string, HTMLButtonElement>());
  const closeMenu = useCallback((refocus: boolean) => {
    setMenuFor((i) => {
      if (refocus && i !== null) queueMicrotask(() => moreButtons.current.get(String(i))?.focus());
      return null;
    });
  }, []);

  const itemsFor = (i: number): MenuItem[] => [
    { label: 'Close', run: () => onClose(i) },
    ...(tabs.length > 1 ? [{ label: 'Close others', run: () => onCloseOthers(i) }] : []),
    { label: 'Copy name', run: () => { navigator.clipboard.writeText(checkoutLabel(tabs[i])).catch(onError); } },
  ];

  return (
    <div className="tabbar">
      <div className="tabs" role="tablist" aria-label="Open checkouts">
        {tabs.map((c, i) => {
          const label = checkoutLabel(c);
          const gone = goneReason(c);
          return (
            <div key={checkoutKey(c)} className={`tab${i === active ? ' tab-active' : ''}${gone ? ' tab-gone' : ''}`}
              onContextMenu={(e) => { e.preventDefault(); setMenuFor(i); }}>
              <button type="button" role="tab" className="tab-label" aria-selected={i === active} title={gone ? `${label}: ${gone}` : label}
                onClick={() => onActivate(i)}>{label}</button>
              <button type="button" className="icon-button tab-button" aria-label={`Actions for ${label}`} aria-haspopup="menu" aria-expanded={menuFor === i}
                ref={(el) => { if (el) moreButtons.current.set(String(i), el); else moreButtons.current.delete(String(i)); }}
                onClick={() => setMenuFor(menuFor === i ? null : i)}><EllipsisVerticalIcon /></button>
              <button type="button" className="icon-button tab-button" aria-label={`Close ${label}`} onClick={() => onClose(i)}><CloseIcon /></button>
              {menuFor === i && <TabMenu label={`Actions for ${label}`} items={itemsFor(i)} onClose={closeMenu} />}
            </div>
          );
        })}
      </div>
      <button type="button" className="icon-button" aria-label="Open checkout" title="Open checkout" onClick={onOpenPicker}><PlusIcon /></button>
    </div>
  );
}
