import { afterEach, expect, test } from 'vitest';
import { readRoute, routeSearch, writeRoute } from './route';

afterEach(() => history.replaceState(null, '', '/'));

// Invariant: the URL names the active checkout; a bare ?project=X is its main checkout.
test('?project=alpha is the main checkout; &worktree names a worktree; no project is no checkout', () => {
  expect(readRoute('?project=alpha')).toEqual({ project: 'alpha', worktree: null });
  expect(readRoute('?project=a&worktree=w')).toEqual({ project: 'a', worktree: 'w' });
  expect(readRoute('?worktree=w')).toBeNull();
  expect(readRoute('')).toBeNull();
});

test('routeSearch round-trips through readRoute and is empty for no checkout', () => {
  for (const c of [{ project: 'a b', worktree: null }, { project: 'a', worktree: 'w/x' }]) expect(readRoute(routeSearch(c))).toEqual(c);
  expect(routeSearch(null)).toBe('');
});

test('writeRoute pushes a history entry only when the URL differs', () => {
  const before = history.length;
  writeRoute({ project: 'alpha', worktree: null });
  expect(location.search).toBe('?project=alpha');
  expect(history.length).toBe(before + 1);
  writeRoute({ project: 'alpha', worktree: null });
  expect(history.length).toBe(before + 1);
  writeRoute(null);
  expect(location.search).toBe('');
});
