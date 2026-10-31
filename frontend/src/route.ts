import type { Checkout } from './checkout';

// The active tab lives in the query string (`?project=<p>[&worktree=<w>]`), never in the hash.

export function readRoute(search = location.search): Checkout | null {
  const q = new URLSearchParams(search);
  const project = q.get('project');
  if (!project) return null;
  return { project, worktree: q.get('worktree') || null };
}

export function routeSearch(c: Checkout | null): string {
  if (!c) return '';
  const q = new URLSearchParams({ project: c.project });
  if (c.worktree) q.set('worktree', c.worktree);
  return `?${q}`;
}

// Mirrors `c` into the URL when it differs from what is there.
export function writeRoute(c: Checkout | null): void {
  const search = routeSearch(c);
  if (search === location.search) return;
  history.pushState(null, '', search || location.pathname);
}
