// What a code-conductor row ⋮ "Open terminal" asks for. The values are untrusted text:
// they are checked against cc's own project listing before anything is built from them.
import type { ProjectInfo } from '../api';
import { checkoutPresence, type Checkout } from '../checkout';

// cc's `SCOPE_PARAMS` owns these names (cc docs/plugins.md, `menuItems`).
const PARAMS = { project: 'ccProject', worktree: 'ccWorktree' };

export type MenuTarget = { project: string | null; worktree: string | null };

// null when the URL carries no menu param at all; an empty value counts as absent.
export function readMenuTarget(search = location.search): MenuTarget | null {
  const q = new URLSearchParams(search);
  if (!q.has(PARAMS.project) && !q.has(PARAMS.worktree)) return null;
  return { project: q.get(PARAMS.project) || null, worktree: q.get(PARAMS.worktree) || null };
}

export type Resolved = { ok: true; checkout: Checkout } | { ok: false; message: string };

// The checkout is built from the listing's own strings, never from the request's.
export function resolveMenuTarget(projects: ProjectInfo[], t: MenuTarget): Resolved {
  if (t.project === null) return { ok: false, message: "Can't open a terminal: code-conductor named no project." };
  const presence = checkoutPresence(projects, { project: t.project, worktree: t.worktree });
  if (presence.kind === 'project-gone' || presence.kind === 'unknown') {
    return { ok: false, message: `Can't open a terminal: code-conductor lists no project “${t.project}”.` };
  }
  if (presence.kind === 'worktree-gone') {
    return { ok: false, message: `Can't open a terminal: project “${t.project}” has no worktree “${t.worktree}”.` };
  }
  const worktree = t.worktree === null ? null : presence.project.worktrees.find((w) => w.name === t.worktree)!.name;
  return { ok: true, checkout: { project: presence.project.name, worktree } };
}
