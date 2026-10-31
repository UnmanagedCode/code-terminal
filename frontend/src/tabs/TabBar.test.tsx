import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
