import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useTabShortcuts } from './useTabShortcuts';

function Probe({ count, activate }: { count: number; activate(i: number): void }) {
  useTabShortcuts(() => count, activate);
  return null;
}

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

// Invariant: the shortcut contract (Ctrl/⌘ + digit, no Shift/Alt, 9 = last).
test('Ctrl+2 activates the second tab, Ctrl+9 the last, Meta works too', () => {
  const activate = vi.fn();
  render(<Probe count={4} activate={activate} />);
  fireEvent.keyDown(window, { key: '2', ctrlKey: true });
  fireEvent.keyDown(window, { key: '9', ctrlKey: true });
  fireEvent.keyDown(window, { key: '1', metaKey: true });
  expect(activate.mock.calls).toEqual([[1], [3], [0]]);
});

test('Shift or Alt held, no modifier, or a non-digit key do nothing', () => {
  const activate = vi.fn();
  render(<Probe count={4} activate={activate} />);
  fireEvent.keyDown(window, { key: '2', ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(window, { key: '2', ctrlKey: true, altKey: true });
  fireEvent.keyDown(window, { key: '2' });
  fireEvent.keyDown(window, { key: '0', ctrlKey: true });
  fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
  expect(activate).not.toHaveBeenCalled();
});

// Invariant: the key is intercepted before xterm, so no byte reaches the shell.
test('a keydown on a terminal textarea activates the tab and never reaches the terminal\'s own listener', () => {
  const activate = vi.fn();
  render(<Probe count={3} activate={activate} />);
  const xterm = document.createElement('div');
  xterm.className = 'xterm';
  const area = document.createElement('textarea');
  xterm.append(area);
  document.body.append(xterm);
  const own = vi.fn();
  area.addEventListener('keydown', own);
  const ev = new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true, cancelable: true });
  area.dispatchEvent(ev);
  expect(activate).toHaveBeenCalledWith(2);
  expect(own).not.toHaveBeenCalled();
  expect(ev.defaultPrevented).toBe(true);
});

// Invariant: an open modal keeps its keys.
test('with a modal dialog open the key is not handled', () => {
  const activate = vi.fn();
  render(<Probe count={3} activate={activate} />);
  const dlg = document.createElement('dialog');
  dlg.setAttribute('open', '');
  document.body.append(dlg);
  const ev = new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(ev);
  expect(activate).not.toHaveBeenCalled();
  expect(ev.defaultPrevented).toBe(false);
});
