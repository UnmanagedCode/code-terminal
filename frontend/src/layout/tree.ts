// Pure operations on the split-pane layout tree. Shape rules live in
// shared/layout.js, which the backend store uses too.
import type { Layout, Pane } from '../../../shared/layout.js';
import { RATIO_MAX, RATIO_MIN, validateLayout } from '../../../shared/layout.js';

export type { Layout, Pane, Split } from '../../../shared/layout.js';
export { validateLayout };
// 'row' puts panes side by side (a vertical split); 'col' stacks them (a horizontal split).
export type SplitDir = 'row' | 'col';

export function newPane(sessionId: string | null): Pane {
  return { kind: 'pane', id: `p${crypto.randomUUID().slice(0, 8)}`, sessionId };
}

export function panes(tree: Layout | null): Pane[] {
  if (!tree) return [];
  return tree.kind === 'pane' ? [tree] : [...panes(tree.a), ...panes(tree.b)];
}

const map = (tree: Layout, fn: (n: Layout) => Layout | undefined): Layout => {
  const hit = fn(tree);
  if (hit) return hit;
  return tree.kind === 'split' ? { ...tree, a: map(tree.a, fn), b: map(tree.b, fn) } : tree;
};

// Replaces pane `paneId` with a split holding it (a) and `added` (b).
export function split(tree: Layout, paneId: string, dir: SplitDir, added: Pane): Layout {
  return map(tree, (n) => (n.kind === 'pane' && n.id === paneId ? { kind: 'split', dir, ratio: 0.5, a: n, b: added } : undefined));
}

export function updatePane(tree: Layout, paneId: string, patch: Partial<Omit<Pane, 'kind' | 'id'>>): Layout {
  return map(tree, (n) => (n.kind === 'pane' && n.id === paneId ? { ...n, ...patch } : undefined));
}

// The tree without pane `paneId`: its sibling takes its parent's place.
export function close(tree: Layout, paneId: string): Layout | null {
  if (tree.kind === 'pane') return tree.id === paneId ? null : tree;
  if (tree.a.kind === 'pane' && tree.a.id === paneId) return tree.b;
  if (tree.b.kind === 'pane' && tree.b.id === paneId) return tree.a;
  return { ...tree, a: close(tree.a, paneId) as Layout, b: close(tree.b, paneId) as Layout };
}

// The pane to focus once `paneId` is closed: the first pane of its sibling.
export function focusAfterClose(tree: Layout, paneId: string): string | null {
  if (tree.kind === 'pane') return null;
  if (tree.a.kind === 'pane' && tree.a.id === paneId) return panes(tree.b)[0].id;
  if (tree.b.kind === 'pane' && tree.b.id === paneId) return panes(tree.a)[0].id;
  return focusAfterClose(tree.a, paneId) ?? focusAfterClose(tree.b, paneId);
}

export const clampRatio = (r: number) => Math.min(RATIO_MAX, Math.max(RATIO_MIN, r));

// Sets the ratio of the split at `path` (a string of 'a'/'b' steps from the root).
export function setRatio(tree: Layout, path: string, ratio: number): Layout {
  if (tree.kind !== 'split') return tree;
  if (path === '') return { ...tree, ratio: clampRatio(ratio) };
  const [step, rest] = [path[0] as 'a' | 'b', path.slice(1)];
  return { ...tree, [step]: setRatio(tree[step], rest, ratio) };
}
