import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TabBar } from './TabBar';

afterEach(cleanup);

const a = { project: 'alpha', worktree: null };
const aw = { project: 'alpha', worktree: 'feat' };

function setup(tabs = [a, aw], goneReason: (c: typeof a) => string | null = () => null) {
  const p = { onActivate: vi.fn(), onClose: vi.fn(), onCloseOthers: vi.fn(), onOpenPicker: vi.fn(), onError: vi.fn() };
  render(<TabBar tabs={tabs} active={0} goneReason={goneReason} {...p} />);
  return p;
}

// Invariant: tab bar parity with code-git (labels, activate, close, + opens the picker).
test('tabs are labelled project or project/worktree; clicking one activates it; + opens the picker', () => {
  const p = setup();
  expect(screen.getByRole('tablist', { name: 'Open checkouts' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'alpha' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: 'alpha/feat' }));
  expect(p.onActivate).toHaveBeenCalledWith(1);
  fireEvent.click(screen.getByRole('button', { name: 'Open checkout' }));
  expect(p.onOpenPicker).toHaveBeenCalled();
});

test('the close button of a tab requests its close', () => {
  const p = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Close alpha/feat' }));
  expect(p.onClose).toHaveBeenCalledWith(1);
});

test('the actions menu (from the ⋮ button or a right-click) offers Close, Close others and Copy name', () => {
  const p = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha/feat' }));
  expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Close', 'Close others', 'Copy name']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Close others' }));
  expect(p.onCloseOthers).toHaveBeenCalledWith(1);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'alpha' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }));
  expect(p.onClose).toHaveBeenCalledWith(0);
});

test('Close others is offered only with more than one tab', () => {
  setup([a]);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
  expect(screen.queryByRole('menuitem', { name: 'Close others' })).toBeNull();
});

test('Copy name writes the tab label to the clipboard', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  try {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha/feat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy name' }));
    expect(writeText).toHaveBeenCalledWith('alpha/feat');
  } finally { vi.unstubAllGlobals(); }
});

test('the menu moves focus with the arrow keys and closes on Escape or a press outside', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
  const items = screen.getAllByRole('menuitem');
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(items[0], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(items[1], { key: 'ArrowUp' });
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(items[0], { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('a tab whose checkout is gone says why in its title', () => {
  setup([a, aw], (c) => (c.worktree ? 'its worktree was deleted' : null));
  expect(screen.getByRole('tab', { name: 'alpha/feat' }).getAttribute('title')).toContain('its worktree was deleted');
  expect(screen.getByRole('tab', { name: 'alpha' }).getAttribute('title')).toBe('alpha');
});

// Invariant: the ⋮ button toggles its menu (a press on it is not an outside press).
test('a second press on ⋮ closes the menu and aria-expanded goes back to false', () => {
  setup();
  const more = screen.getByRole('button', { name: 'Actions for alpha' });
  const press = () => { fireEvent.pointerDown(more); fireEvent.click(more); };
  press();
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(more.getAttribute('aria-expanded')).toBe('true');
  press();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(more.getAttribute('aria-expanded')).toBe('false');
});

// Invariant: the menu is rendered outside the tab strip, whose scroll box would clip it.
test('the menu is rendered in document.body, not inside the tab strip', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
  const menu = screen.getByRole('menu');
  expect(menu.parentElement).toBe(document.body);
  expect(screen.getByRole('tablist').contains(menu)).toBe(false);
});

// Invariant: the menu always lies inside the viewport horizontally.
describe('menu placement', () => {
  const stubRects = (anchor: { left: number; right: number }) => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 });
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = this.classList.contains('menu') ? { left: 0, right: 144, width: 144 } : { ...anchor, width: anchor.right - anchor.left };
      return { x: box.left, y: 0, top: 0, bottom: 30, height: 30, toJSON() {}, ...box } as DOMRect;
    });
  };
  const left = () => Number.parseFloat(screen.getByRole('menu').style.left);

  test('a menu too wide to right-align under a button near the left edge is left-aligned to it, within the margin', () => {
    const spy = stubRects({ left: 20, right: 85 });
    try {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
      expect(left()).toBe(20);
    } finally { spy.mockRestore(); }
  });

  test('a button with room to its left gets the menu right-aligned; one at the far right is pulled back inside the viewport', () => {
    let spy = stubRects({ left: 540, right: 600 });
    try {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
      expect(left()).toBe(456);
    } finally { spy.mockRestore(); }
    cleanup();
    spy = stubRects({ left: 960, right: 1010 });
    try {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
      expect(left()).toBe(1000 - 144 - 8);
    } finally { spy.mockRestore(); }
  });

  test('a button hugging the left edge still leaves the menu a margin', () => {
    const spy = stubRects({ left: 0, right: 30 });
    try {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
      expect(left()).toBe(8);
    } finally { spy.mockRestore(); }
  });
});

// Invariant: a menu that no longer sits under its opener closes, without taking focus.
test('the menu closes on window resize and on a scroll of the tab strip, leaving focus where it is', () => {
  setup();
  const more = screen.getByRole('button', { name: 'Actions for alpha' });
  fireEvent.click(more);
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).not.toBe(more);
  fireEvent.click(more);
  fireEvent.scroll(screen.getByRole('tablist'));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).not.toBe(more);
});
