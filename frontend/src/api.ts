// The backend's REST surface (docs/protocol.md → REST). Relative URLs only: the
// page is served under cc's /plugins/code-terminal/.
import type { Layout } from './layout/tree';

export type TerminalAvailability =
  | { state: 'available' }
  | { state: 'unavailable' | 'unreachable' | 'unknown'; code: string | null; reason: string };

export type WorktreeInfo = { name: string; path: string; branch: string | null };
export type ProjectInfo = {
  name: string; path: string; system: string; remoteId: string | null;
  worktrees: WorktreeInfo[]; terminal: TerminalAvailability;
};

export type SessionState =
  | { kind: 'running' }
  | { kind: 'exited'; code: number | null; signal: string | null }
  | { kind: 'failed'; code: string | null; error: string }
  | { kind: 'ended' };
export type SessionInfo = { id: string; project: string; worktree: string | null; state: SessionState; title: string };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) { super(message); }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit & { headers: Record<string, string> } = { method, headers: {} };
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
export const createSession = (project: string, worktree: string | null, size: { cols: number; rows: number }) =>
  call<{ id: string }>('POST', 'api/sessions', { project, worktree, cols: size.cols, rows: size.rows }).then((r) => r.id);
export const killSession = (id: string) => call<null>('DELETE', `api/sessions/${encodeURIComponent(id)}`);
export const getLayout = (project: string) =>
  call<{ tree: Layout | null }>('GET', `api/layouts/${encodeURIComponent(project)}`).then((r) => r.tree);
export const putLayout = (project: string, tree: Layout | null) => call<null>('PUT', `api/layouts/${encodeURIComponent(project)}`, { tree });
