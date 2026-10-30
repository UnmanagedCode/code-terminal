import { describe, expect, test } from 'vitest';
import fixtures from '../../../tests/fixtures/layouts.json';
import { close, focusAfterClose, panes, setRatio, split, validateLayout, type Layout, type Pane } from './tree';
import { RATIO_MAX, RATIO_MIN } from '../../../shared/layout.js';

const pane = (id: string, worktree: string | null = null): Pane => ({ kind: 'pane', id, sessionId: null, worktree });

describe('split', () => {
  test('a vertical split then a horizontal split of the new pane nests correctly', () => {
    let t: Layout = pane('p1');
    t = split(t, 'p1', 'row', pane('p2'));
    t = split(t, 'p2', 'col', pane('p3'));
    expect(t).toEqual({
      kind: 'split', dir: 'row', ratio: 0.5, a: pane('p1'),
      b: { kind: 'split', dir: 'col', ratio: 0.5, a: pane('p2'), b: pane('p3') },
    });
    expect(panes(t).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(validateLayout(t)).toBeNull();
  });
});

describe('close', () => {
  const three: Layout = {
    kind: 'split', dir: 'row', ratio: 0.4, a: pane('p1'),
    b: { kind: 'split', dir: 'col', ratio: 0.5, a: pane('p2'), b: pane('p3') },
  };
  test('closing a pane collapses its parent: the sibling takes the parent\'s place', () => {
    expect(close(three, 'p2')).toEqual({ kind: 'split', dir: 'row', ratio: 0.4, a: pane('p1'), b: pane('p3') });
    expect(close(three, 'p1')).toEqual({ kind: 'split', dir: 'col', ratio: 0.5, a: pane('p2'), b: pane('p3') });
  });
  test('closing the only pane leaves an empty layout', () => {
    expect(close(pane('p1'), 'p1')).toBeNull();
  });
  test('focus moves to the closed pane\'s sibling (its first pane when the sibling is a split)', () => {
    expect(focusAfterClose(three, 'p3')).toBe('p2');
    expect(focusAfterClose(three, 'p1')).toBe('p2');
    expect(focusAfterClose(pane('p1'), 'p1')).toBeNull();
  });
});

describe('setRatio', () => {
  test('the ratio is clamped to the shared bounds', () => {
    const t: Layout = { kind: 'split', dir: 'row', ratio: 0.5, a: pane('p1'), b: pane('p2') };
    expect((setRatio(t, '', 0.01) as { ratio: number }).ratio).toBe(RATIO_MIN);
    expect((setRatio(t, '', 5) as { ratio: number }).ratio).toBe(RATIO_MAX);
    expect((setRatio(t, '', 0.3) as { ratio: number }).ratio).toBe(0.3);
  });
  test('a nested split is addressed by its a/b path', () => {
    const t = split(split(pane('p1'), 'p1', 'row', pane('p2')), 'p2', 'col', pane('p3'));
    const r = setRatio(t, 'b', 0.7) as { b: { ratio: number }; ratio: number };
    expect(r.b.ratio).toBe(0.7);
    expect(r.ratio).toBe(0.5);
  });
});

describe('validateLayout', () => {
  test('the frontend validator agrees with the backend on the shared fixtures', () => {
    for (const t of fixtures.valid) expect(validateLayout(t)).toBeNull();
    for (const t of fixtures.invalid) expect(validateLayout(t)).not.toBeNull();
  });
});
