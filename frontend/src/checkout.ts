// A checkout is what a tab shows: a project's main checkout (worktree null) or one of its worktrees.
import type { ProjectInfo, SessionInfo, TerminalAvailability } from './api';

export type Checkout = { project: string; worktree: string | null };

// NUL is in no cc name, so `a` + `b/c` and `a/b` + `c` cannot collide.
export const checkoutKey = (c: Checkout): string => `${c.project}\0${c.worktree ?? ''}`;
export const checkoutLabel = (c: Checkout): string => (c.worktree ? `${c.project}/${c.worktree}` : c.project);
export const sameCheckout = (a: Checkout, b: Checkout): boolean => checkoutKey(a) === checkoutKey(b);

export type Presence =
  | { kind: 'unknown' }
  | { kind: 'project-gone' }
  | { kind: 'worktree-gone'; project: ProjectInfo }
  | { kind: 'present'; project: ProjectInfo };

// Whether cc still has the checkout. `unknown` until a listing has succeeded.
export function checkoutPresence(projects: ProjectInfo[] | null, c: Checkout): Presence {
  if (!projects) return { kind: 'unknown' };
  const project = projects.find((p) => p.name === c.project);
  if (!project) return { kind: 'project-gone' };
  if (c.worktree !== null && !project.worktrees.some((w) => w.name === c.worktree)) return { kind: 'worktree-gone', project };
  return { kind: 'present', project };
}

// Why a gone checkout's tab is marked; null while it is there (or not yet known).
export function goneReason(p: Presence): string | null {
  if (p.kind === 'project-gone') return 'its project was removed';
  if (p.kind === 'worktree-gone') return 'its worktree was deleted';
  return null;
}

// What to tell the user about opening terminals in a project; null when nothing is wrong.
export function availabilityNote(t: TerminalAvailability): string | null {
  if (t.state === 'available') return null;
  if (t.state === 'unreachable') return `System unreachable: ${t.reason}`;
  if (t.state === 'unknown') return `Terminals may not open: ${t.reason}`;
  return t.reason;
}

// Running shells of exactly this checkout.
export const runningIn = (sessions: SessionInfo[], c: Checkout): number =>
  sessions.filter((s) => s.state.kind === 'running' && sameCheckout(s, c)).length;
