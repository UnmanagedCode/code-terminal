import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ProjectInfo, SessionInfo } from '../api';
import { CheckoutPicker } from './CheckoutPicker';

afterEach(cleanup);

const project = (name: string, extra: Partial<ProjectInfo> = {}): ProjectInfo => ({
  name, path: `/p/${name}`, system: 'local', remoteId: null, workspace: null, worktrees: [], terminal: { state: 'available' }, ...extra,
});
const session = (project: string, worktree: string | null, kind: 'running' | 'ended' = 'running'): SessionInfo => ({
  id: `${project}-${worktree}-${kind}-${Math.random()}`, ordinal: 1, project, worktree, state: { kind }, title: '',
});

function setup(projects: ProjectInfo[] | null, sessions: SessionInfo[] = [], error: string | null = null) {
  const p = { onOpen: vi.fn(), onClose: vi.fn(), onRetry: vi.fn() };
  render(<CheckoutPicker open projects={projects} error={error} sessions={sessions} {...p} />);
  return p;
}

// Invariant: listing and filter (workspaces alphabetical, "No workspace" last, projects alphabetical).
test('projects are grouped by workspace alphabetically with "No workspace" last, projects sorted within', () => {
  setup([project('zed'), project('b2', { workspace: 'beta' }), project('a1', { workspace: 'alpha' }), project('a0', { workspace: 'beta' })]);
  const groups = screen.getAllByRole('region').map((g) => [g.getAttribute('aria-label'), within(g).getAllByRole('button').filter((b) => !b.getAttribute('aria-label')).map((b) => b.textContent)]);
  expect(groups).toEqual([['alpha', ['a1']], ['beta', ['a0', 'b2']], ['No workspace', ['zed']]]);
});

test('the filter matches a project or workspace name case-insensitively; no match says so', () => {
  setup([project('one', { workspace: 'Team' }), project('two')]);
  const box = screen.getByRole('textbox', { name: 'Filter projects' });
  fireEvent.change(box, { target: { value: 'TEAM' } });
  expect(screen.getByRole('button', { name: 'one' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'two' })).toBeNull();
  fireEvent.change(box, { target: { value: 'tw' } });
  expect(screen.getByRole('button', { name: 'two' })).toBeTruthy();
  fireEvent.change(box, { target: { value: 'zzz' } });
  expect(screen.getByText('No project matches.')).toBeTruthy();
});

// Invariant: an unavailable project is disabled with cc's reason, as text only.
test('an unavailable project is disabled and shows cc\'s reason as text, creating no element from it', () => {
  setup([project('bad', { terminal: { state: 'unavailable', code: 'X', reason: 'no <b id="x">terminal</b> here' } })]);
  expect((screen.getByRole('button', { name: 'bad' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Show checkouts of bad' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('no <b id="x">terminal</b> here')).toBeTruthy();
  expect(document.getElementById('x')).toBeNull();
});

// Invariant: an unreachable System stays retryable.
test('an unreachable project is enabled and shows "System unreachable: …"', () => {
  setup([project('far', { terminal: { state: 'unreachable', code: null, reason: 'timed out' } })]);
  expect((screen.getByRole('button', { name: 'far' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText('System unreachable: timed out')).toBeTruthy();
});

// Invariant: every checkout is selectable.
test('expanding a project lists its main checkout and worktrees, and picking each opens that checkout', () => {
  const p = setup([project('alpha', { worktrees: [{ name: 'feat', path: '/w/feat', branch: 'b/feat' }] })]);
  fireEvent.click(screen.getByRole('button', { name: 'Show checkouts of alpha' }));
  const list = screen.getByRole('list', { name: 'Checkouts of alpha' });
  expect(within(list).getByText('b/feat')).toBeTruthy();
  fireEvent.click(within(list).getByRole('button', { name: /feat/ }));
  expect(p.onOpen).toHaveBeenLastCalledWith({ project: 'alpha', worktree: 'feat' });
  expect(p.onClose).toHaveBeenCalled();
  fireEvent.click(within(list).getByRole('button', { name: /main checkout/ }));
  expect(p.onOpen).toHaveBeenLastCalledWith({ project: 'alpha', worktree: null });
  fireEvent.click(screen.getByRole('button', { name: 'alpha' }));
  expect(p.onOpen).toHaveBeenLastCalledWith({ project: 'alpha', worktree: null });
});

// Invariant: the live count is per exact checkout and only counts running shells.
test('the running badge counts only running shells of that exact checkout, and is absent at zero', () => {
  setup(
    [project('alpha', { worktrees: [{ name: 'feat', path: '/w', branch: null }, { name: 'idle', path: '/w2', branch: null }] }), project('beta')],
    [session('alpha', null), session('alpha', null), session('alpha', 'feat'), session('alpha', 'feat', 'ended'), session('beta', 'alpha')],
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show checkouts of alpha' }));
  const list = screen.getByRole('list', { name: 'Checkouts of alpha' });
  expect(within(list).getByRole('button', { name: /main checkout/ }).textContent).toContain('2 running');
  expect(within(list).getByRole('button', { name: /feat/ }).textContent).toContain('1 running');
  expect(within(list).getByRole('button', { name: /idle/ }).textContent).not.toContain('running');
  expect(screen.getAllByLabelText('2 running shells')).toHaveLength(2);
  expect(screen.getAllByLabelText(/running shells?$/)).toHaveLength(3);
  expect(screen.getByLabelText('1 running shell')).toBeTruthy();
});

test('a listing error shows its message and Retry; before the first listing it says Loading', () => {
  const p = setup(null, [], 'cc is down');
  expect(screen.getByText('cc is down')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(p.onRetry).toHaveBeenCalled();
  cleanup();
  setup(null);
  expect(screen.getByText('Loading projects…')).toBeTruthy();
});

test('a project on another System shows its system badge', () => {
  setup([project('far', { system: 'remote-1', remoteId: 'r9' })]);
  expect(screen.getByText('remote-1 · r9')).toBeTruthy();
});
