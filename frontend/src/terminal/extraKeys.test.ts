import { describe, expect, test, vi } from 'vitest';
import { applyModifiers, DOUBLE_TAP_MS, keySequence, Modifiers } from './extraKeys';

const none = { ctrl: false, alt: false };
const ctrl = { ctrl: true, alt: false };
const alt = { ctrl: false, alt: true };

function clocked() {
  let t = 1000;
  const mods = new Modifiers(() => t);
  return { mods, advance: (ms: number) => { t += ms; } };
}

describe('keySequence', () => {
  test.each([[false], [true]])('non-arrow keys send their own byte (application cursor %s)', (app) => {
    expect(keySequence('esc', app)).toBe('\x1b');
    expect(keySequence('tab', app)).toBe('\t');
    expect(keySequence('tilde', app)).toBe('~');
    expect(keySequence('pipe', app)).toBe('|');
    expect(keySequence('slash', app)).toBe('/');
    expect(keySequence('dash', app)).toBe('-');
  });

  test('arrows in normal cursor mode are CSI, with the right letter per direction', () => {
    expect(keySequence('up', false)).toBe('\x1b[A');
    expect(keySequence('down', false)).toBe('\x1b[B');
    expect(keySequence('right', false)).toBe('\x1b[C');
    expect(keySequence('left', false)).toBe('\x1b[D');
  });

  test('arrows in application cursor mode are SS3', () => {
    expect(keySequence('up', true)).toBe('\x1bOA');
    expect(keySequence('down', true)).toBe('\x1bOB');
    expect(keySequence('right', true)).toBe('\x1bOC');
    expect(keySequence('left', true)).toBe('\x1bOD');
  });
});

describe('applyModifiers', () => {
  test('Ctrl maps to the control byte, with exact range edges', () => {
    const c = (s: string) => applyModifiers(s, ctrl);
    expect([c('a'), c('c'), c('z'), c('C')]).toEqual(['\x01', '\x03', '\x1a', '\x03']);
    expect([c('@'), c(' '), c('['), c('\\'), c(']'), c('^'), c('_'), c('?')])
      .toEqual(['\x00', '\x00', '\x1b', '\x1c', '\x1d', '\x1e', '\x1f', '\x7f']);
    expect([c('`'), c('{'), c('1'), c('/')]).toEqual(['`', '{', '1', '/']);
  });

  test('Alt prefixes ESC', () => {
    expect(applyModifiers('x', alt)).toBe('\x1bx');
    expect(applyModifiers('\x1b', alt)).toBe('\x1b\x1b');
    expect(applyModifiers('\t', alt)).toBe('\x1b\t');
    expect(applyModifiers('\x7f', alt)).toBe('\x1b\x7f');
  });

  test('Ctrl+Alt composes', () => {
    expect(applyModifiers('c', { ctrl: true, alt: true })).toBe('\x1b\x03');
  });

  test('modified arrows use the xterm modifier parameter in either cursor mode', () => {
    for (const up of ['\x1b[A', '\x1bOA']) {
      expect(applyModifiers(up, ctrl)).toBe('\x1b[1;5A');
      expect(applyModifiers(up, alt)).toBe('\x1b[1;3A');
      expect(applyModifiers(up, { ctrl: true, alt: true })).toBe('\x1b[1;7A');
    }
    expect(applyModifiers('\x1b[D', ctrl)).toBe('\x1b[1;5D');
  });

  test('only the first code point of multi-char input is modified; astral characters are not split', () => {
    expect(applyModifiers('cd', ctrl)).toBe('\x03d');
    expect(applyModifiers('😀x', alt)).toBe('\x1b😀x');
  });

  test('terminal reports are not keystrokes', () => {
    for (const r of ['\x1b[12;5R', '\x1b[<0;3;4M', '\x1b[I', '\x1b[200~x\x1b[201~']) expect(applyModifiers(r, ctrl)).toBeNull();
  });

  test('empty data is not a keystroke', () => {
    expect(applyModifiers('', ctrl)).toBeNull();
    expect(applyModifiers('', alt)).toBeNull();
  });

  test('no modifier leaves arrows unchanged', () => {
    expect(applyModifiers('\x1b[A', none)).toBe('\x1b[A');
  });
});

describe('Modifiers', () => {
  test('idle modifiers are the identity', () => {
    const { mods } = clocked();
    for (const d of ['c', '\x1b[A', '\x1b[12;5R']) expect(mods.apply(d)).toBe(d);
  });

  test('a one-shot applies to the next key and clears', () => {
    const { mods } = clocked();
    mods.tap('ctrl');
    expect(mods.get().ctrl).toBe('once');
    expect(mods.apply('c')).toBe('\x03');
    expect(mods.get().ctrl).toBe('off');
    expect(mods.apply('c')).toBe('c');
  });

  test('a double-tap within DOUBLE_TAP_MS locks; another tap clears', () => {
    const { mods, advance } = clocked();
    mods.tap('ctrl');
    advance(DOUBLE_TAP_MS - 1);
    mods.tap('ctrl');
    expect(mods.get().ctrl).toBe('locked');
    expect([mods.apply('a'), mods.apply('b'), mods.apply('c')]).toEqual(['\x01', '\x02', '\x03']);
    mods.tap('ctrl');
    expect(mods.get().ctrl).toBe('off');
  });

  test('a second tap DOUBLE_TAP_MS later cancels instead of locking', () => {
    const { mods, advance } = clocked();
    mods.tap('alt');
    advance(DOUBLE_TAP_MS);
    mods.tap('alt');
    expect(mods.get().alt).toBe('off');
  });

  test('Ctrl and Alt are independent: a key clears only the one-shot', () => {
    const { mods, advance } = clocked();
    mods.tap('alt');
    advance(10);
    mods.tap('alt');
    mods.tap('ctrl');
    expect(mods.apply('c')).toBe('\x1b\x03');
    expect(mods.get()).toEqual({ ctrl: 'off', alt: 'locked' });
    expect(mods.apply('x')).toBe('\x1bx');
  });

  test('a report or empty data does not consume a one-shot', () => {
    const { mods } = clocked();
    mods.tap('ctrl');
    expect(mods.apply('')).toBe('');
    expect(mods.get().ctrl).toBe('once');
    expect(mods.apply('\x1b[I')).toBe('\x1b[I');
    expect(mods.get().ctrl).toBe('once');
  });

  test('subscribers see changes with a fresh snapshot, and none after unsubscribe', () => {
    const { mods } = clocked();
    const fn = vi.fn();
    const off = mods.subscribe(fn);
    const s0 = mods.get();
    mods.tap('ctrl');
    const s1 = mods.get();
    mods.apply('c');
    const s2 = mods.get();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(new Set([s0, s1, s2]).size).toBe(3);
    off();
    mods.tap('ctrl');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
