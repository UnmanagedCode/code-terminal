import { afterEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(() => vi.unstubAllGlobals());

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
