// Real xterm under happy-dom has no layout (cell height 0), so the screen's height is stubbed and
// the contract asserted is what reaches `Terminal.scrollLines`.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { attachTouchScroll } from './touchScroll';

const ROWS = 10;
const CELL = 20;

let t: Terminal;
let surface: HTMLElement;
let scroll: ReturnType<typeof attachTouchScroll>;
let calls: number[];
let screenHeight: number;

function setup() {
  surface = document.createElement('div');
  document.body.appendChild(surface);
  const host = document.createElement('div');
  surface.appendChild(host);
  t = new Terminal({ rows: ROWS });
  t.open(host);
  screenHeight = ROWS * CELL;
  vi.spyOn(t.element!.querySelector('.xterm-screen')!, 'getBoundingClientRect')
    .mockImplementation(() => ({ height: screenHeight }) as DOMRect);
  calls = [];
  vi.spyOn(t, 'scrollLines').mockImplementation((n) => { calls.push(n!); });
  scroll = attachTouchScroll(t, surface);
}

beforeEach(setup);
afterEach(() => {
  scroll.dispose();
  t.dispose();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const total = () => calls.reduce((a, b) => a + b, 0);
function touch(type: string, ys: number[], cancelable = false) {
  const touches = ys.map((clientY) => ({ clientY, clientX: 5, identifier: 0 }));
  const e = new Event(type, { bubbles: true, cancelable });
  Object.assign(e, { touches });
  surface.dispatchEvent(e);
  return e;
}

describe('touch scrolling', () => {
  test('a one-finger drag down shows older lines (negative), up shows newer, by whole cell heights', () => {
    touch('touchstart', [100]);
    touch('touchmove', [100 + 3 * CELL]);
    expect(total()).toBe(-3);
    touch('touchmove', [100]);
    expect(total()).toBe(0);
    touch('touchmove', [100 - 2 * CELL]);
    expect(total()).toBe(2);
  });

  test('sub-line moves accumulate: no call until a whole line, remainder kept', () => {
    touch('touchstart', [100]);
    touch('touchmove', [100 - CELL / 2]);
    expect(calls).toEqual([]);
    touch('touchmove', [100 - CELL]);
    expect(calls).toEqual([1]);
  });

  test('a fractional remainder carries across a scrollLines call (the accumulator is not zeroed)', () => {
    touch('touchstart', [100]);
    touch('touchmove', [100 - 1.5 * CELL]);
    expect(calls).toEqual([1]);
    touch('touchmove', [100 - 2 * CELL]);
    expect(calls).toEqual([1, 1]);
  });

  test('a second finger stops scrolling until all fingers lift; then a new gesture works', () => {
    touch('touchstart', [100]);
    touch('touchstart', [100, 200]);
    touch('touchmove', [100 - 5 * CELL, 200]);
    expect(calls).toEqual([]);
    touch('touchend', [200]);
    touch('touchmove', [200 - 5 * CELL]);
    expect(calls).toEqual([]);
    touch('touchend', []);
    touch('touchstart', [100]);
    touch('touchmove', [100 - CELL]);
    expect(calls).toEqual([1]);
  });

  test('touch events are never default-prevented and a tap scrolls nothing', () => {
    const start = touch('touchstart', [100], true);
    const end = touch('touchend', [], true);
    expect(start.defaultPrevented).toBe(false);
    expect(end.defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
  });

  test('without layout (cell height 0) nothing scrolls and nothing throws', () => {
    screenHeight = 0;
    touch('touchstart', [100]);
    expect(() => touch('touchmove', [300])).not.toThrow();
    expect(calls).toEqual([]);
  });

  test('every touch listener is registered passive, so taps and native behaviour stay intact', () => {
    scroll.dispose();
    const add = vi.spyOn(surface, 'addEventListener');
    scroll = attachTouchScroll(t, surface);
    const touchCalls = add.mock.calls.filter(([type]) => String(type).startsWith('touch'));
    expect(touchCalls.map(([type]) => type).sort()).toEqual(['touchcancel', 'touchend', 'touchmove', 'touchstart']);
    for (const [, , options] of touchCalls) expect(options).toMatchObject({ passive: true });
  });

  test('dispose restores the previous inline touch-action, not an empty value', () => {
    scroll.dispose();
    surface.style.touchAction = 'pan-x';
    scroll = attachTouchScroll(t, surface);
    expect(surface.style.touchAction).not.toBe('pan-x');
    scroll.dispose();
    expect(surface.style.touchAction).toBe('pan-x');
  });

  test('touch-action blocks the native pan while attached and is restored on dispose', () => {
    expect(['none', 'pinch-zoom']).toContain(surface.style.touchAction);
    scroll.dispose();
    expect(surface.style.touchAction).toBe('');
    touch('touchstart', [100]);
    touch('touchmove', [100 - 3 * CELL]);
    expect(calls).toEqual([]);
  });
});
