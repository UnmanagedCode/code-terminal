// The backend's REST surface (docs/protocol.md → REST). Relative URLs only: the
// page is served under cc's /plugins/code-terminal/.
import type { Checkout } from './checkout';
import type { Layout } from './layout/tree';

export type TerminalAvailability =
  | { state: 'available' }
  | { state: 'unavailable' | 'unreachable' | 'unknown'; code: string | null; reason: string };

export type WorktreeInfo = { name: string; path: string; branch: string | null };
export type ProjectInfo = {
  name: string; path: string; system: string; remoteId: string | null; workspace: string | null;
  worktrees: WorktreeInfo[]; terminal: TerminalAvailability;
};

export type SessionState =
  | { kind: 'running' }
  | { kind: 'exited'; code: number | null; signal: string | null }
  | { kind: 'failed'; code: string | null; error: string }
  | { kind: 'ended' };
// `ordinal`: the shell's number within its project (1, 2, …), never reused.
export type SessionInfo = { id: string; ordinal: number; project: string; worktree: string | null; state: SessionState; title: string };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) { super(message); }
}

// `keepalive` lets a request outlive the page (a save or kill sent as it unloads);
// the browser still sends Origin, so the backend's guard admits it.
async function call<T>(method: string, url: string, body?: unknown, { keepalive = false } = {}): Promise<T> {
  const init: RequestInit & { headers: Record<string, string> } = { method, headers: {}, ...(keepalive ? { keepalive } : {}) };
  // Every state-changing request is JSON: the backend refuses anything else.
  if (method !== 'GET') init.headers['content-type'] = 'application/json';
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const d = data as { code?: string; error?: string } | null;
    throw new ApiError(res.status, d?.code ?? null, d?.error ?? `${method} ${url} answered ${res.status}`);
  }
  return data as T;
}

export const listProjects = () => call<{ projects: ProjectInfo[] }>('GET', 'api/projects').then((r) => r.projects);
export const listSessions = () => call<{ sessions: SessionInfo[] }>('GET', 'api/sessions').then((r) => r.sessions);
export const createSession = (c: Checkout, size: { cols: number; rows: number }) =>
  call<{ id: string }>('POST', 'api/sessions', { project: c.project, worktree: c.worktree, cols: size.cols, rows: size.rows }).then((r) => r.id);
export const killSession = (id: string) => call<null>('DELETE', `api/sessions/${encodeURIComponent(id)}`, undefined, { keepalive: true });

// `api/<noun>/<project>[?worktree=<w>]`: no worktree means the main checkout.
const checkoutUrl = (noun: string, c: Checkout) =>
  `api/${noun}/${encodeURIComponent(c.project)}${c.worktree === null ? '' : `?worktree=${encodeURIComponent(c.worktree)}`}`;

export const getLayout = (c: Checkout) => call<{ tree: Layout | null }>('GET', checkoutUrl('layouts', c)).then((r) => r.tree);
export const putLayout = (c: Checkout, tree: Layout | null) => call<null>('PUT', checkoutUrl('layouts', c), { tree }, { keepalive: true });
// Kills every shell of the checkout and drops its layout.
export const closeCheckout = (c: Checkout) => call<null>('DELETE', checkoutUrl('checkouts', c), undefined, { keepalive: true });
