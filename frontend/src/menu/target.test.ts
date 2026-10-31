import { expect, test } from 'vitest';
import type { ProjectInfo } from '../api';
import { readMenuTarget, resolveMenuTarget } from './target';

const project = (name: string, worktrees: string[]): ProjectInfo => ({
  name, path: `/p/${name}`, system: 'local', remoteId: null, workspace: null, terminal: { state: 'available' },
  worktrees: worktrees.map((w) => ({ name: w, path: `/w/${w}`, branch: null })),
} as ProjectInfo);

// Invariant: only cc's two params make a menu target; code-terminal's own route is not one.
test('readMenuTarget reads ccProject/ccWorktree only', () => {
  expect(readMenuTarget('?ccProject=a')).toEqual({ project: 'a', worktree: null });
  expect(readMenuTarget('?ccProject=a&ccWorktree=w')).toEqual({ project: 'a', worktree: 'w' });
  expect(readMenuTarget('?ccWorktree=w')).toEqual({ project: null, worktree: 'w' });
  expect(readMenuTarget('?ccProject=')).toEqual({ project: null, worktree: null });
  expect(readMenuTarget('?project=a')).toBeNull();
  expect(readMenuTarget('')).toBeNull();
  expect(readMenuTarget('?ccProject=a%20b&ccWorktree=w%2Fx')).toEqual({ project: 'a b', worktree: 'w/x' });
});

// Invariant: the param→checkout selection is decided only by the listing.
test('resolveMenuTarget maps listed names to a checkout and refuses everything else, quoting the names', () => {
  const list = [project('alpha', ['feat'])];
  expect(resolveMenuTarget(list, { project: 'alpha', worktree: null })).toEqual({ ok: true, checkout: { project: 'alpha', worktree: null } });
  expect(resolveMenuTarget(list, { project: 'alpha', worktree: 'feat' })).toEqual({ ok: true, checkout: { project: 'alpha', worktree: 'feat' } });
  const bad = [
    { t: { project: 'ghost', worktree: null }, name: 'ghost' },
    { t: { project: 'alpha', worktree: 'nope' }, name: 'nope' },
    { t: { project: null, worktree: 'feat' }, name: '' },
  ];
  for (const { t, name } of bad) {
    const r = resolveMenuTarget(list, t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(name);
  }
});
