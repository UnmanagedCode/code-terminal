import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConnHandlers, ConnState } from './socket';

// xterm needs a real layout engine; the pane's contract is tested against stand-ins.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24; options: Record<string, unknown> = {};
    loadAddon() {} open() {} write() {} reset() {} dispose() {} focus() {}
    onData() { return { dispose() {} }; } onBinary() { return { dispose() {} }; }
    onTitleChange(fn: (t: string) => void) { titleListener = fn; return { dispose() {} }; }
    attachCustomKeyEventHandler() {} getSelection() { return ''; } hasSelection() { return false; } paste() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} proposeDimensions() { return { cols: 80, rows: 24 }; } } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

let handlers: ConnHandlers | null = null;
let titleListener: ((t: string) => void) | null = null;
const reattach = vi.fn();
vi.mock('./socket', () => ({
  connectSession: (_id: string, _size: unknown, h: ConnHandlers) => { handlers = h; return { sendInput() {}, resize() {}, close() {}, reattach }; },
}));

const { TerminalPane } = await import('./TerminalPane');
const { TITLE_MAX_CHARS } = await import('../../../shared/terminal.js');

const fetchMock = vi.fn();
beforeEach(() => {
  handlers = null;
  titleListener = null;
  reattach.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

const pane = { kind: 'pane' as const, id: 'p1', sessionId: '0b7c1f5e-3c1a-4c1e-9d2a-1f2e3d4c5b6a', worktree: 'feature' };

function renderPane(onSessionReplaced = vi.fn()) {
  render(<TerminalPane project="alpha" pane={pane} focused onFocus={() => {}} onSplit={() => {}} onClose={() => {}} onSessionReplaced={onSessionReplaced} />);
  return onSessionReplaced;
}

async function enter(state: ConnState) {
  await waitFor(() => expect(handlers).not.toBeNull());
  act(() => handlers!.onState(state));
}

describe('TerminalPane', () => {
  test.each<[string, ConnState]>([
    ['ended', { kind: 'ended' }],
    ['exited', { kind: 'exited', code: 2, signal: null }],
    ['failed', { kind: 'failed', code: 'ETRANSPORT', error: 'provider died' }],
  ])('a %s session offers Restart', async (_name, state) => {
    renderPane();
    await enter(state);
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy();
  });

  test('a running session offers no Restart', async () => {
    renderPane();
    await enter({ kind: 'running' });
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
  });

  test('Restart opens a new session in the same project and worktree and puts it in this pane', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'new-id' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const onSessionReplaced = renderPane();
    await enter({ kind: 'exited', code: 0, signal: null });
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(onSessionReplaced).toHaveBeenCalledWith('new-id'));
    const [url, init] = fetchMock.mock.calls.find(([u]) => u === 'api/sessions')!;
    expect(url).toBe('api/sessions');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toMatchObject({ project: 'alpha', worktree: 'feature' });
  });

  test('a terminal title is rendered as text, never as markup', async () => {
    renderPane();
    await waitFor(() => expect(handlers).not.toBeNull());
    act(() => handlers!.onHello({ kind: 'running' }, '<img src=x onerror=alert(1)>'));
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  test('the header buttons have accessible names', () => {
    renderPane();
    for (const name of ['Split side by side', 'Split stacked', 'Close shell']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  test('a pane detached by another window offers Reattach here, which reattaches', async () => {
    renderPane();
    await enter({ kind: 'detached' });
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reattach here' }));
    expect(reattach).toHaveBeenCalledTimes(1);
    act(() => handlers!.onState({ kind: 'running' }));
    expect(screen.queryByRole('button', { name: 'Reattach here' })).toBeNull();
  });

  test("a program title is clamped to TITLE_MAX_CHARS, from the stream and from the backend's hello", async () => {
    renderPane();
    await waitFor(() => expect(titleListener).not.toBeNull());
    act(() => titleListener!('t'.repeat(TITLE_MAX_CHARS * 4)));
    expect(screen.getByText('t'.repeat(TITLE_MAX_CHARS))).toBeTruthy();
    act(() => handlers!.onHello({ kind: 'running' }, 'h'.repeat(TITLE_MAX_CHARS + 1)));
    expect(screen.getByText('h'.repeat(TITLE_MAX_CHARS))).toBeTruthy();
  });
});
