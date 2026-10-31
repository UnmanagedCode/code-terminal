import { beforeEach, describe, expect, test } from 'vitest';
import { EMPTY, loadTabs, saveTabs, tabsReducer, type TabsState } from './tabs';

const a = { project: 'alpha', worktree: null };
const aw = { project: 'alpha', worktree: 'w' };
const b = { project: 'beta', worktree: null };
const state = (open: TabsState['open'], active: number): TabsState => ({ open, active });

beforeEach(() => localStorage.clear());

describe('tabsReducer', () => {
  // Invariant: one tab per checkout.
  test('open adds and activates a tab; opening an open checkout only activates it; a project and its worktree are two tabs', () => {
    let s = tabsReducer(EMPTY, { type: 'open', checkout: a });
    expect(s).toEqual(state([a], 0));
    s = tabsReducer(s, { type: 'open', checkout: aw });
    expect(s).toEqual(state([a, aw], 1));
    s = tabsReducer(s, { type: 'open', checkout: a });
    expect(s).toEqual(state([a, aw], 0));
  });

  // Invariant: code-git's close semantics (right neighbour, else left; indices left of active shift).
  test('closing the active tab activates its right neighbour, else its left one', () => {
    expect(tabsReducer(state([a, aw, b], 1), { type: 'close', index: 1 })).toEqual(state([a, b], 1));
    expect(tabsReducer(state([a, aw, b], 2), { type: 'close', index: 2 })).toEqual(state([a, aw], 1));
    expect(tabsReducer(state([a], 0), { type: 'close', index: 0 })).toEqual(EMPTY);
  });

  test('closing a tab left of the active one keeps the same tab active; one to its right changes nothing', () => {
    expect(tabsReducer(state([a, aw, b], 2), { type: 'close', index: 0 })).toEqual(state([aw, b], 1));
    expect(tabsReducer(state([a, aw, b], 0), { type: 'close', index: 2 })).toEqual(state([a, aw], 0));
  });

  test('closeOthers keeps one tab, active; an out-of-range index changes nothing', () => {
    expect(tabsReducer(state([a, aw, b], 0), { type: 'closeOthers', index: 2 })).toEqual(state([b], 0));
    const s = state([a, aw], 1);
    expect(tabsReducer(s, { type: 'closeOthers', index: 5 })).toBe(s);
    expect(tabsReducer(s, { type: 'close', index: -1 })).toBe(s);
    expect(tabsReducer(s, { type: 'activateIndex', index: 2 })).toBe(s);
    expect(tabsReducer(s, { type: 'activateIndex', index: 0 })).toEqual(state([a, aw], 0));
  });
});

describe('loadTabs / saveTabs', () => {
  // Invariant: the open tabs survive a reload, under the plugin's own storage key.
  test('a saved state loads back, stored under code-terminal:tabs', () => {
    saveTabs(state([a, aw], 1));
    expect(localStorage.getItem('code-terminal:tabs')).not.toBeNull();
    expect(loadTabs()).toEqual(state([a, aw], 1));
  });

  test('malformed entries are dropped, an out-of-range active is clamped, and bad JSON loads as empty', () => {
    localStorage.setItem('code-terminal:tabs', JSON.stringify({
      open: [a, { project: '', worktree: null }, { project: 'x', worktree: '' }, { project: 3, worktree: null }, { project: 'y', worktree: 4 }, a, null, b],
      active: 9,
    }));
    expect(loadTabs()).toEqual(state([a, b], 0));
    localStorage.setItem('code-terminal:tabs', '{nope');
    expect(loadTabs()).toEqual(EMPTY);
    localStorage.setItem('code-terminal:tabs', JSON.stringify({ open: [{ project: '', worktree: null }], active: 0 }));
    expect(loadTabs()).toEqual(EMPTY);
  });
});
