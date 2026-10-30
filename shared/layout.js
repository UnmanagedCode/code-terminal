// The split-pane layout tree: its shape rules, shared by the backend store and
// the frontend so both accept exactly the same trees (docs/protocol.md → Layouts).

// The largest stored layout, as serialized JSON.
export const LAYOUT_MAX_BYTES = 64 * 1024;
export const RATIO_MIN = 0.1;
export const RATIO_MAX = 0.9;

const PANE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORKTREE_MAX_CHARS = 255;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasExactly = (o, keys) => Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

// Why `tree` is not a layout, or null. `null` is the empty layout. Iterative,
// so nesting depth is bounded only by the byte cap, never by the stack.
export function validateLayout(tree) {
  if (tree === null) return null;
  const ids = new Set();
  const stack = [tree];
  while (stack.length) {
    const n = stack.pop();
    if (!isObject(n)) return 'a node is not an object';
    if (n.kind === 'pane') {
      if (!hasExactly(n, ['kind', 'id', 'sessionId', 'worktree'])) return 'a pane has exactly kind, id, sessionId, worktree';
      if (typeof n.id !== 'string' || !PANE_ID_RE.test(n.id)) return 'a pane id is 1-64 letters, digits, _ or -';
      if (ids.has(n.id)) return `pane id ${n.id} is used twice`;
      ids.add(n.id);
      if (n.sessionId !== null && (typeof n.sessionId !== 'string' || !UUID_RE.test(n.sessionId))) return 'a pane sessionId is a UUID or null';
      if (n.worktree !== null && (typeof n.worktree !== 'string' || n.worktree === '' || n.worktree.length > WORKTREE_MAX_CHARS)) {
        return 'a pane worktree is a non-empty name or null';
      }
    } else if (n.kind === 'split') {
      if (!hasExactly(n, ['kind', 'dir', 'ratio', 'a', 'b'])) return 'a split has exactly kind, dir, ratio, a, b';
      if (n.dir !== 'row' && n.dir !== 'col') return 'a split dir is row or col';
      if (typeof n.ratio !== 'number' || !(n.ratio >= RATIO_MIN && n.ratio <= RATIO_MAX)) return `a split ratio is in ${RATIO_MIN}..${RATIO_MAX}`;
      stack.push(n.b, n.a);
    } else {
      return 'a node kind is pane or split';
    }
  }
  return null;
}
