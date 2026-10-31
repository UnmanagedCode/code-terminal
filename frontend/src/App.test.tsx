import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Pane } from './layout/tree';

// The pane's own behaviour is TerminalPane.test.tsx's; here it only needs a Close and a name.
vi.mock('./terminal/TerminalPane', () => ({
  TerminalPane: ({ pane, checkout, onClose }: { pane: Pane; checkout: { project: string; worktree: string | null }; onClose(): void }) => (
    <section aria-label={`pane ${pane.id}`} data-checkout={`${checkout.project}/${checkout.worktree ?? ''}`}>
      <button type="button" onClick={onClose}>{`Close ${pane.id}`}</button>
    </section>
  ),
}));
const { App } = await import('./App');

// Unmount while the test's fetch stub is still in place: the App flushes pending saves on unmount.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
  localStorage.clear();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const S1 = '0b7c1f5e-3c1a-4c1e-9d2a-1f2e3d4c5b6a';
const S2 = '1c8d2a6f-4d2b-4d2f-8e3b-2a3f4e5d6c7b';
const S3 = '2d9e3b70-5e3c-4e30-9f4c-3b40f5e6d7c8';
const NEW = '3eaf4c81-6f4d-4f41-8a5d-4c51a6f7e8d9';
const p1: Pane = { kind: 'pane', id: 'p1', sessionId: S1 };
const p2: Pane = { kind: 'pane', id: 'p2', sessionId: S2 };
const two = { kind: 'split', dir: 'row', ratio: 0.5, a: p1, b: p2 };

const project = (name: string, worktrees: string[] = [], terminal: unknown = { state: 'available' }) => ({
  name, path: `/p/${name}`, system: 'local', remoteId: null, workspace: null, terminal,
  worktrees: worktrees.map((w) => ({ name: w, path: `/w/${w}`, branch: null })),
});
const info = (id: string, ordinal: number, worktree: string | null = null, kind = 'running') =>
  ({ id, ordinal, project: 'alpha', worktree, state: { kind }, title: '' });

type Call = { url: string; init: RequestInit };
type HostOpts = {
  projects?: unknown[];
  // Layout answers by URL; anything else is the empty layout.
  layouts?: Record<string, unknown>;
  listed?: unknown[];
  deleteStatus?: number;
  checkoutStatus?: number;
  create?: () => Promise<string>;
};

function host(o: HostOpts = {}) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const method = init.method ?? 'GET';
    if (url === 'api/projects') return json(200, { projects: o.projects ?? [project('alpha', ['feat'])] });
    if (url.startsWith('api/layouts/') && method === 'GET') return json(200, { tree: o.layouts?.[url] ?? null });
    if (url === 'api/sessions' && method === 'GET') return json(200, { sessions: o.listed ?? [] });
    if (url === 'api/sessions' && method === 'POST') return json(201, { id: o.create ? await o.create() : NEW });
    if (url.startsWith('api/checkouts/') && method === 'DELETE' && o.checkoutStatus) return json(o.checkoutStatus, { code: 'HOST_UNREACHABLE', error: 'code-conductor is unreachable' });
    if (url.startsWith('api/sessions/') && method === 'DELETE' && o.deleteStatus) return json(o.deleteStatus, { code: 'HOST_UNREACHABLE', error: 'code-conductor is unreachable' });
    return new Response(null, { status: 204 });
  }));
  return calls;
}

const puts = (calls: Call[]) => calls.filter((c) => c.init.method === 'PUT');
const deletes = (calls: Call[]) => calls.filter((c) => c.init.method === 'DELETE').map((c) => c.url);
const listings = (calls: Call[]) => calls.filter((c) => c.url === 'api/sessions' && (c.init.method ?? 'GET') === 'GET').length;
const at = (search: string) => history.replaceState(null, '', search);

// Invariant: standalone page.
test('standalone (no code-conductor behind the backend) the page says to open it through code-conductor', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(503, { code: 'HOST_UNAVAILABLE', error: 'Code Terminal works only when opened through code-conductor' })));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Code Terminal' })).toBeTruthy();
  expect(await screen.findByText(/open it through code-conductor/i)).toBeTruthy();
});

// Invariant: the old and new route forms each open the right checkout and load its own layout.
test('?project=alpha opens the main checkout tab and loads api/layouts/alpha; &worktree=feat loads that worktree\'s layout', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': p1, 'api/layouts/alpha?worktree=feat': p2 } });
  at('?project=alpha');
  render(<App />);
  expect(await screen.findByRole('region', { name: 'pane p1' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'alpha' }).getAttribute('aria-selected')).toBe('true');
  expect(calls.some((c) => c.url === 'api/layouts/alpha')).toBe(true);
  cleanup();
  at('?project=alpha&worktree=feat');
  render(<App />);
  expect(await screen.findByRole('region', { name: 'pane p2' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'alpha/feat' }).getAttribute('aria-selected')).toBe('true');
  expect(calls.some((c) => c.url === 'api/layouts/alpha?worktree=feat')).toBe(true);
});

// Invariant: the open tabs survive a reload and the URL's checkout is the active one.
test('tabs are restored after a remount, and the URL\'s checkout is the active tab', async () => {
  host();
  at('?project=alpha');
  const first = render(<App />);
  await screen.findByRole('tab', { name: 'alpha' });
  fireEvent.click(screen.getByRole('button', { name: 'Open checkout' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Show checkouts of alpha' }));
  fireEvent.click(within(screen.getByRole('list', { name: 'Checkouts of alpha' })).getByRole('button', { name: /feat/ }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'alpha/feat' }).getAttribute('aria-selected')).toBe('true'));
  first.unmount();
  at('?project=alpha');
  render(<App />);
  expect(screen.getByRole('tab', { name: 'alpha/feat' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'alpha' }).getAttribute('aria-selected')).toBe('true');
});

// Invariant: no lost layout on reload.
test('a layout save still in its debounce is sent, surviving unload, when the page is hidden', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': two } });
  at('?project=alpha');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close p2' }));
  expect(puts(calls)).toEqual([]);
  window.dispatchEvent(new Event('pagehide'));
  const [put] = puts(calls);
  expect(put.url).toBe('api/layouts/alpha');
  expect(put.init.keepalive).toBe(true);
  expect((put.init.headers as Record<string, string>)['content-type']).toBe('application/json');
  expect(JSON.parse(put.init.body as string)).toEqual({ tree: p1 });
});

test('a layout save still in its debounce is sent when the app unmounts', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': two } });
  at('?project=alpha');
  const { unmount } = render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close p2' }));
  unmount();
  expect(puts(calls).map((c) => JSON.parse(c.init.body as string))).toEqual([{ tree: p1 }]);
});

// Invariant: closing a pane kills its shell, with a request that survives unload.
test('closing a pane kills its session with a request that survives unload', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': two } });
  at('?project=alpha');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close p2' }));
  const kill = calls.find((c) => c.url.startsWith('api/sessions/') && c.init.method === 'DELETE');
  expect(kill?.url).toBe(`api/sessions/${S2}`);
  expect(kill?.init.keepalive).toBe(true);
  expect((kill?.init.headers as Record<string, string>)['content-type']).toBe('application/json');
});

// Invariant: the killed set keeps a closed pane's shell from coming back as a hidden shell (ported from the sidebar).
test('a closed pane\'s session does not come back as a hidden shell from a stale listing', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': two }, listed: [info(S1, 1), info(S2, 2)] });
  at('?project=alpha');
  render(<App />);
  await screen.findByRole('button', { name: 'Close p2' });
  await waitFor(() => expect(listings(calls)).toBeGreaterThan(0));
  const before = listings(calls);
  fireEvent.click(screen.getByRole('button', { name: 'Close p2' }));
  await waitFor(() => expect(listings(calls)).toBeGreaterThan(before));
  expect(screen.queryByText(/not in this layout/)).toBeNull();
});

test('a kill the backend failed (502) shows the still-running shell again as a hidden shell', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': two }, listed: [info(S1, 1), info(S2, 2)], deleteStatus: 502 });
  at('?project=alpha');
  render(<App />);
  await screen.findByRole('button', { name: 'Close p2' });
  await waitFor(() => expect(listings(calls)).toBeGreaterThan(0));
  const before = listings(calls);
  fireEvent.click(screen.getByRole('button', { name: 'Close p2' }));
  await waitFor(() => expect(listings(calls)).toBeGreaterThan(before));
  expect(await screen.findByText(/1 shell in this checkout is not in this layout/)).toBeTruthy();
});

test('a kill answered 404 (already gone) keeps the shell out of a stale listing', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': two }, listed: [info(S1, 1), info(S2, 2)], deleteStatus: 404 });
  at('?project=alpha');
  render(<App />);
  await screen.findByRole('button', { name: 'Close p2' });
  await waitFor(() => expect(listings(calls)).toBeGreaterThan(0));
  const before = listings(calls);
  fireEvent.click(screen.getByRole('button', { name: 'Close p2' }));
  await waitFor(() => expect(listings(calls)).toBeGreaterThan(before));
  expect(screen.queryByText(/not in this layout/)).toBeNull();
});

// Invariant: confirm, then kill; the tab goes only after the backend has killed the shells.
test('closing a tab with a running shell asks first; Cancel sends nothing, Confirm deletes the checkout and the tab goes after the 204', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': p1 }, listed: [info(S1, 1)] });
  at('?project=alpha');
  render(<App />);
  await screen.findByRole('region', { name: 'pane p1' });
  fireEvent.click(screen.getByRole('button', { name: 'Close alpha' }));
  expect(await screen.findByText('1 running shell will be killed.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(deletes(calls)).toEqual([]);
  expect(screen.getByRole('tab', { name: 'alpha' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close alpha' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Kill shells and close' }));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'alpha' })).toBeNull());
  const del = calls.find((c) => c.url === 'api/checkouts/alpha');
  expect(del?.init.method).toBe('DELETE');
  expect(del?.init.keepalive).toBe(true);
  expect((del?.init.headers as Record<string, string>)['content-type']).toBe('application/json');
  expect(screen.getByText('No checkout open.')).toBeTruthy();
});

test('a worktree tab is closed through api/checkouts/<project>?worktree=<name>', async () => {
  const calls = host({ listed: [] });
  at('?project=alpha&worktree=feat');
  render(<App />);
  await screen.findByRole('tab', { name: 'alpha/feat' });
  fireEvent.click(screen.getByRole('button', { name: 'Close alpha/feat' }));
  await waitFor(() => expect(deletes(calls)).toEqual(['api/checkouts/alpha?worktree=feat']));
});

// Invariant: a tab only closes when its shells are dead.
test('when the backend fails the close (502) the tab stays and the error is shown', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': p1 }, listed: [info(S1, 1)], checkoutStatus: 502 });
  at('?project=alpha');
  render(<App />);
  await screen.findByRole('region', { name: 'pane p1' });
  fireEvent.click(screen.getByRole('button', { name: 'Close alpha' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Kill shells and close' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('code-conductor is unreachable')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'alpha' })).toBeTruthy();
  expect(deletes(calls)).toContain('api/checkouts/alpha');
});

// Invariant: confirm only when needed.
test('closing a tab with no running shells asks nothing and still deletes the checkout', async () => {
  const calls = host({ listed: [info(S1, 1, null, 'exited')] });
  at('?project=alpha');
  render(<App />);
  await screen.findByRole('tab', { name: 'alpha' });
  fireEvent.click(screen.getByRole('button', { name: 'Close alpha' }));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'alpha' })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Kill shells and close' })).toBeNull();
  expect(deletes(calls)).toEqual(['api/checkouts/alpha']);
});

test('Close others on a tab asks once for the other tabs\' running shells', async () => {
  const calls = host({ listed: [info(S1, 1, 'feat')] });
  localStorage.setItem('code-terminal:tabs', JSON.stringify({ open: [{ project: 'alpha', worktree: null }, { project: 'alpha', worktree: 'feat' }], active: 0 }));
  render(<App />);
  await screen.findByRole('tab', { name: 'alpha/feat' });
  fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Close others' }));
  expect(await screen.findByText('Close alpha/feat?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Kill shells and close' }));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'alpha/feat' })).toBeNull());
  expect(deletes(calls)).toEqual(['api/checkouts/alpha?worktree=feat']);
});

// Invariant: a closed checkout's layout is not recreated by a save still pending.
test('a layout save pending for a tab being closed is never sent', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': two }, listed: [] });
  at('?project=alpha');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close p2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close alpha' }));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'alpha' })).toBeNull());
  window.dispatchEvent(new Event('pagehide'));
  expect(puts(calls)).toEqual([]);
});

// Invariant: no shell without a tab (a create finishing after its tab closed).
test('a session created after its tab was closed is killed at once and no layout is written', async () => {
  let release!: (id: string) => void;
  const calls = host({ create: () => new Promise<string>((r) => { release = r; }) });
  at('?project=alpha');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'New shell' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: 'Close alpha' }));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'alpha' })).toBeNull());
  release(NEW);
  await waitFor(() => expect(deletes(calls)).toContain(`api/sessions/${NEW}`));
  expect(puts(calls)).toEqual([]);
});

// Invariant: a gone checkout stays usable and closable.
test('a worktree missing from cc\'s listing shows the gone banner; its Close tab runs the close flow', async () => {
  const calls = host({ projects: [project('alpha')], listed: [] });
  at('?project=alpha&worktree=feat');
  render(<App />);
  expect(await screen.findByText(/alpha\/feat no longer exists in code-conductor \(its worktree was deleted\)/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close tab' }));
  await waitFor(() => expect(deletes(calls)).toEqual(['api/checkouts/alpha?worktree=feat']));
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'alpha/feat' })).toBeNull());
});

test('a checkout of a project cc no longer lists says its project was removed', async () => {
  host({ projects: [] });
  at('?project=ghost');
  render(<App />);
  expect(await screen.findByText(/its project was removed/)).toBeTruthy();
});

// Invariant: hidden shells are reachable, and only on request.
test('a live session the layout does not show is offered with Show, which adds a pane for it', async () => {
  host({ layouts: { 'api/layouts/alpha': p1 }, listed: [info(S1, 1), info(S3, 2)] });
  at('?project=alpha');
  render(<App />);
  expect(await screen.findByText(/1 shell in this checkout is not in this layout/)).toBeTruthy();
  expect(screen.getAllByRole('region').length).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  await waitFor(() => expect(screen.getAllByRole('region').length).toBe(2));
  expect(screen.queryByText(/not in this layout/)).toBeNull();
});

test('sessions of another checkout are not offered as hidden shells', async () => {
  const calls = host({ layouts: { 'api/layouts/alpha': p1 }, listed: [info(S1, 1), info(S3, 2, 'feat')] });
  at('?project=alpha');
  render(<App />);
  await screen.findByRole('region', { name: 'pane p1' });
  await waitFor(() => expect(listings(calls)).toBeGreaterThan(0));
  expect(screen.queryByText(/not in this layout/)).toBeNull();
});

// Invariant: picking opens a shell in an empty checkout; restoring never does; every shell runs in its tab's checkout.
test('picking a checkout with no shells opens one in that checkout; restoring from the URL does not', async () => {
  const calls = host();
  at('?project=alpha');
  render(<App />);
  await screen.findByRole('button', { name: 'New shell' });
  expect(calls.filter((c) => c.url === 'api/sessions' && c.init.method === 'POST')).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Open checkout' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Show checkouts of alpha' }));
  fireEvent.click(within(screen.getByRole('list', { name: 'Checkouts of alpha' })).getByRole('button', { name: /feat/ }));
  await waitFor(() => expect(calls.filter((c) => c.url === 'api/sessions' && c.init.method === 'POST').length).toBe(1));
  const post = calls.find((c) => c.url === 'api/sessions' && c.init.method === 'POST')!;
  expect(JSON.parse(post.init.body as string)).toMatchObject({ project: 'alpha', worktree: 'feat' });
  const pane = await screen.findByRole('region', { name: /^pane / });
  expect(pane.getAttribute('data-checkout')).toBe('alpha/feat');
});

test('New shell is disabled, with cc\'s reason, for a project whose System has no terminal support', async () => {
  host({ projects: [project('alpha', [], { state: 'unavailable', code: 'X', reason: 'no terminals on this System' })] });
  at('?project=alpha');
  render(<App />);
  await screen.findByText('no terminals on this System');
  expect((screen.getByRole('button', { name: 'New shell' }) as HTMLButtonElement).disabled).toBe(true);
});

test('the picker reloads the project listing each time it opens', async () => {
  const calls = host();
  at('?project=alpha');
  render(<App />);
  await screen.findByRole('tab', { name: 'alpha' });
  const count = () => calls.filter((c) => c.url === 'api/projects').length;
  const before = count();
  fireEvent.click(screen.getByRole('button', { name: 'Open checkout' }));
  await waitFor(() => expect(count()).toBe(before + 1));
});
