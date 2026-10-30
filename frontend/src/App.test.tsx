import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Pane } from './layout/tree';

// The pane's own behaviour is TerminalPane.test.tsx's; here it only needs a Close.
vi.mock('./terminal/TerminalPane', () => ({
  TerminalPane: ({ pane, onClose }: { pane: Pane; onClose(): void }) => (
    <section aria-label={`pane ${pane.id}`}><button type="button" onClick={onClose}>{`Close ${pane.id}`}</button></section>
  ),
}));
const { App } = await import('./App');

// Unmount while the test's fetch stub is still in place: the App flushes pending saves on unmount.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('standalone (no code-conductor behind the backend) the page says to open it through code-conductor', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(503, { code: 'HOST_UNAVAILABLE', error: 'Code Terminal works only when opened through code-conductor' })));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Code Terminal' })).toBeTruthy();
  expect(await screen.findByText(/open it through code-conductor/i)).toBeTruthy();
});

test('projects are listed in the sidebar', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === 'api/projects') return json(200, { projects: [{ name: 'alpha', path: '/p/alpha', system: 'local', remoteId: null, worktrees: [], terminal: { state: 'available' } }] });
    return json(200, { sessions: [] });
  }));
  render(<App />);
  expect(await screen.findByRole('group', { name: 'alpha' })).toBeTruthy();
});

const S1 = '0b7c1f5e-3c1a-4c1e-9d2a-1f2e3d4c5b6a';
const S2 = '1c8d2a6f-4d2b-4d2f-8e3b-2a3f4e5d6c7b';
const p1: Pane = { kind: 'pane', id: 'p1', sessionId: S1, worktree: null };
const p2: Pane = { kind: 'pane', id: 'p2', sessionId: S2, worktree: null };

const info = (id: string, ordinal: number) => ({ id, ordinal, project: 'alpha', worktree: null, state: { kind: 'running' }, title: '' });

// `listed`: what the backend's session list answers, which may lag a kill.
function hostWithTwoPanes(listed: unknown[] = []) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url === 'api/projects') return json(200, { projects: [{ name: 'alpha', path: '/p/alpha', system: 'local', remoteId: null, worktrees: [], terminal: { state: 'available' } }] });
    if (url === 'api/layouts/alpha' && (init.method ?? 'GET') === 'GET') return json(200, { tree: { kind: 'split', dir: 'row', ratio: 0.5, a: p1, b: p2 } });
    if (url === 'api/sessions') return json(200, { sessions: listed });
    return new Response(null, { status: 204 });
  }));
  history.replaceState(null, '', '?project=alpha');
  return calls;
}

const puts = (calls: { url: string; init: RequestInit }[]) => calls.filter((c) => c.init.method === 'PUT');

test('a layout save still in its debounce is sent, surviving unload, when the page is hidden', async () => {
  const calls = hostWithTwoPanes();
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
  const calls = hostWithTwoPanes();
  const { unmount } = render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close p2' }));
  unmount();
  expect(puts(calls).map((c) => JSON.parse(c.init.body as string))).toEqual([{ tree: p1 }]);
});

test("closing a pane kills its session with a request that survives unload", async () => {
  const calls = hostWithTwoPanes();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close p2' }));
  const kill = calls.find((c) => c.init.method === 'DELETE');
  expect(kill?.url).toBe(`api/sessions/${S2}`);
  expect(kill?.init.keepalive).toBe(true);
  expect((kill?.init.headers as Record<string, string>)['content-type']).toBe('application/json');
});

test('a closed shell leaves the sidebar at once and stays gone even while the session list still reports it', async () => {
  // The backend's listing still carries S2, as one fetched before the kill landed would.
  const calls = hostWithTwoPanes([info(S1, 1), info(S2, 2)]);
  render(<App />);
  expect(await screen.findByRole('button', { name: /^shell 2 / })).toBeTruthy();
  const listingsBefore = calls.filter((c) => c.url === 'api/sessions').length;
  fireEvent.click(screen.getByRole('button', { name: 'Close p2' }));
  expect(screen.queryByRole('button', { name: /^shell 2 / })).toBeNull();
  // The refresh after the kill answers with the stale list; S2 must not come back.
  await waitFor(() => expect(calls.filter((c) => c.url === 'api/sessions').length).toBeGreaterThan(listingsBefore));
  await waitFor(() => expect(screen.getByRole('button', { name: /^shell 1 / })).toBeTruthy());
  expect(screen.queryByRole('button', { name: /^shell 2 / })).toBeNull();
  expect(screen.queryByRole('region', { name: 'pane p2' })).toBeNull();
});
