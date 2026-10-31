// The open tabs, one per checkout, and their persistence.
import { checkoutKey, sameCheckout, type Checkout } from '../checkout';
import { getItem, setItem } from '../storage';

export type TabsState = {
  open: Checkout[];
  // Index into `open`; -1 when no tab is open.
  active: number;
};

export type TabsAction =
  | { type: 'open'; checkout: Checkout }
  | { type: 'close'; index: number }
  | { type: 'closeOthers'; index: number }
  | { type: 'activateIndex'; index: number };

export const EMPTY: TabsState = { open: [], active: -1 };

export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'open': {
      const checkout: Checkout = { project: a.checkout.project, worktree: a.checkout.worktree };
      const at = s.open.findIndex((t) => sameCheckout(t, checkout));
      if (at !== -1) return at === s.active ? s : { ...s, active: at };
      return { open: [...s.open, checkout], active: s.open.length };
    }
    case 'close': {
      if (a.index < 0 || a.index >= s.open.length) return s;
      const open = s.open.filter((_, i) => i !== a.index);
      // Closing the active tab activates its right neighbour, else its left one.
      const active = !open.length ? -1 : a.index < s.active ? s.active - 1 : a.index === s.active ? Math.min(a.index, open.length - 1) : s.active;
      return { open, active };
    }
    case 'closeOthers':
      if (a.index < 0 || a.index >= s.open.length) return s;
      return { open: [s.open[a.index]], active: 0 };
    case 'activateIndex':
      if (a.index < 0 || a.index >= s.open.length || a.index === s.active) return s;
      return { ...s, active: a.index };
  }
}

const STORAGE_KEY = 'tabs';

// The persisted tabs, or EMPTY when absent or malformed.
export function loadTabs(): TabsState {
  try {
    const v = JSON.parse(getItem(STORAGE_KEY) ?? 'null') as TabsState | null;
    if (!v || !Array.isArray(v.open)) return EMPTY;
    const seen = new Set<string>();
    const open: Checkout[] = [];
    for (const t of v.open) {
      const ok = t && typeof t.project === 'string' && t.project && (t.worktree === null || (typeof t.worktree === 'string' && t.worktree));
      if (!ok || seen.has(checkoutKey(t))) continue;
      seen.add(checkoutKey(t));
      open.push({ project: t.project, worktree: t.worktree });
    }
    if (!open.length) return EMPTY;
    const active = Number.isInteger(v.active) && v.active >= 0 && v.active < open.length ? v.active : 0;
    return { open, active };
  } catch {
    return EMPTY;
  }
}

export const saveTabs = (s: TabsState): void => setItem(STORAGE_KEY, JSON.stringify(s));
