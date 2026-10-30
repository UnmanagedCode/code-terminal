import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { ProjectInfo } from '../api';

const project = (name: string, terminal: ProjectInfo['terminal'], worktrees: ProjectInfo['worktrees'] = []): ProjectInfo =>
  ({ name, path: `/p/${name}`, system: 'local', remoteId: null, worktrees, terminal });

const NO_PTY = "terminal: system 'box' is served by prov, which does not support terminals";

function renderSidebar(projects: ProjectInfo[], onNewShell = vi.fn()) {
  render(<Sidebar projects={projects} sessions={[]} selected={null} onSelect={() => {}} onNewShell={onNewShell} onFocusSession={() => {}} />);
  return onNewShell;
}

describe('Sidebar', () => {
  test("a project whose System has no pty has New shell disabled and shows cc's reason", () => {
    const onNewShell = renderSidebar([
      project('alpha', { state: 'available' }),
      project('remote1', { state: 'unavailable', code: 'SYSTEM_NO_PTY', reason: NO_PTY }),
    ]);
    const row = screen.getByRole('group', { name: 'remote1' });
    const button = within(row).getByRole('button', { name: 'New shell in remote1' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(within(row).getByText(NO_PTY)).toBeTruthy();
    fireEvent.click(button);
    expect(onNewShell).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'New shell in alpha' }) as HTMLButtonElement).disabled).toBe(false);
  });

  test('an unreachable System says so and still lets the user try', () => {
    renderSidebar([project('alpha', { state: 'unreachable', code: 'SYSTEM_UNREACHABLE', reason: 'provider died' })]);
    const row = screen.getByRole('group', { name: 'alpha' });
    expect(within(row).getByText(/unreachable/i)).toBeTruthy();
    expect((within(row).getByRole('button', { name: 'New shell in alpha' }) as HTMLButtonElement).disabled).toBe(false);
  });

  test('the worktree picker defaults to the main checkout and sends the chosen worktree', () => {
    const onNewShell = renderSidebar([project('alpha', { state: 'available' }, [{ name: 'feature', path: '/w/feature', branch: 'feature' }])]);
    fireEvent.click(screen.getByRole('button', { name: 'New shell in alpha' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Worktree for alpha' }), { target: { value: 'feature' } });
    fireEvent.click(screen.getByRole('button', { name: 'New shell in alpha' }));
    expect(onNewShell.mock.calls).toEqual([['alpha', null], ['alpha', 'feature']]);
  });
});
