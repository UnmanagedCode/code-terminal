import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConnHandlers, ConnState } from './socket';

const termModes = { applicationCursorKeysMode: false };
const termInput = vi.fn((d: string) => dataListener?.(d));
let dataListener: ((d: string) => void) | null = null;

// xterm needs a real layout engine; the pane's contract is tested against stand-ins.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24; options: Record<string, unknown> = {};
    modes = termModes; element: HTMLElement | undefined; textarea: HTMLTextAreaElement | undefined;
    loadAddon() {} write() {} reset() {} dispose() {} focus() {}
    open(el: HTMLElement) {
      this.element = el;
      this.textarea = document.createElement('textarea');
      this.textarea.className = 'xterm-helper-textarea';
      el.appendChild(this.textarea);
    }
    input = termInput;
    onData(fn: (d: string) => void) { dataListener = fn; return { dispose() {} }; } onBinary() { return { dispose() {} }; }
    onTitleChange(fn: (t: string) => void) { titleListener = fn; return { dispose() {} }; }
    attachCustomKeyEventHandler() {} getSelection() { return ''; } hasSelection() { return false; } paste() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} proposeDimensions() { return { cols: 80, rows: 24 }; } } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

let handlers: ConnHandlers | null = null;
let titleListener: ((t: string) => void) | null = null;
const reattach = vi.fn();
const sendInput = vi.fn();
vi.mock('./socket', () => ({
  connectSession: (_id: string, _size: unknown, h: ConnHandlers) => { handlers = h; return { sendInput, resize() {}, close() {}, reattach }; },
}));

const { TerminalPane } = await import('./TerminalPane');
const { EXTRA_KEYS } = await import('./extraKeys');
const { TITLE_MAX_CHARS } = await import('../../../shared/terminal.js');

const fetchMock = vi.fn();

const mqlListeners = new Set<() => void>();
let mqlMatches = false;
const matchMediaMock = vi.fn((_q: string) => ({
  get matches() { return mqlMatches; },
  addEventListener: (_t: string, fn: () => void) => { mqlListeners.add(fn); },
  removeEventListener: (_t: string, fn: () => void) => { mqlListeners.delete(fn); },
}));
function stubMatchMedia(matches: boolean) {
  mqlMatches = matches;
  mqlListeners.clear();
  matchMediaMock.mockClear();
  vi.stubGlobal('matchMedia', matchMediaMock);
}

beforeEach(() => {
  handlers = null;
  titleListener = null;
  dataListener = null;
  termModes.applicationCursorKeysMode = false;
  sendInput.mockClear();
  termInput.mockClear();
  stubMatchMedia(false);
  reattach.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

const pane = { kind: 'pane' as const, id: 'p1', sessionId: '0b7c1f5e-3c1a-4c1e-9d2a-1f2e3d4c5b6a' };

function renderPane(onSessionReplaced = vi.fn(), onFocus: () => void = () => {}) {
  render(<TerminalPane checkout={{ project: 'alpha', worktree: 'feature' }} pane={pane} focused onFocus={onFocus} onSplit={() => {}} onClose={() => {}} onSessionReplaced={onSessionReplaced} />);
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

  test('Restart opens a new session in the same checkout and puts it in this pane', async () => {
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

  describe('mobile input', () => {
    const bar = () => screen.queryByRole('toolbar', { name: 'Extra keys' });
    const key = (name: string) => screen.getByRole('button', { name });
    async function renderTouch(onFocus?: () => void) {
      stubMatchMedia(true);
      renderPane(vi.fn(), onFocus);
      await waitFor(() => expect(document.querySelector('.xterm-helper-textarea')).not.toBeNull());
    }
    const type = (d: string) => act(() => dataListener!(d));

    test("the textarea's text assistance is off on every terminal, regardless of touch", async () => {
      renderPane();
      await waitFor(() => expect(document.querySelector('.xterm-helper-textarea')).not.toBeNull());
      const ta = document.querySelector('.xterm-helper-textarea')!;
      expect(['autocapitalize', 'autocorrect', 'autocomplete', 'spellcheck'].map((a) => ta.getAttribute(a))).toEqual(['off', 'off', 'off', 'false']);
    });

    test('the bar is touch-only: gated on (hover: none), one button per catalog key', async () => {
      renderPane();
      await waitFor(() => expect(matchMediaMock).toHaveBeenCalled());
      expect(matchMediaMock.mock.calls.every(([q]) => q === '(hover: none)')).toBe(true);
      expect(bar()).toBeNull();
      cleanup();
      await renderTouch();
      expect(bar()).toBeTruthy();
      for (const k of EXTRA_KEYS) expect(key(k.name)).toBeTruthy();
      expect(screen.getAllByRole('button').filter((b) => b.closest('.extra-keys'))).toHaveLength(EXTRA_KEYS.length);
    });

    test('the gate follows the media query live', async () => {
      renderPane();
      expect(bar()).toBeNull();
      mqlMatches = true;
      act(() => mqlListeners.forEach((f) => f()));
      expect(bar()).toBeTruthy();
      mqlMatches = false;
      act(() => mqlListeners.forEach((f) => f()));
      expect(bar()).toBeNull();
    });

    test('a bar tap does not blur: pointerdown is default-prevented', async () => {
      await renderTouch();
      expect(fireEvent.pointerDown(key('Up arrow'))).toBe(false);
      expect(fireEvent.pointerDown(key('Control'))).toBe(false);
    });

    test('bar keys go through the typed-input path and honour the cursor mode at tap time', async () => {
      await renderTouch();
      await waitFor(() => expect(handlers).not.toBeNull());
      fireEvent.click(key('Up arrow'));
      expect(termInput).toHaveBeenLastCalledWith('\x1b[A');
      expect(sendInput).toHaveBeenLastCalledWith('\x1b[A');
      termModes.applicationCursorKeysMode = true;
      fireEvent.click(key('Up arrow'));
      expect(termInput).toHaveBeenLastCalledWith('\x1bOA');
      expect(sendInput).toHaveBeenLastCalledWith('\x1bOA');
    });

    test('a one-shot Ctrl modifies the next typed character, then clears, visibly', async () => {
      await renderTouch();
      fireEvent.click(key('Control'));
      expect(key('Control').getAttribute('aria-pressed')).toBe('true');
      type('c');
      expect(sendInput).toHaveBeenLastCalledWith('\x03');
      expect(key('Control').getAttribute('aria-pressed')).toBe('false');
      type('c');
      expect(sendInput).toHaveBeenLastCalledWith('c');
    });

    test('a double-tap locks Ctrl visibly until tapped again', async () => {
      const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(100).mockReturnValue(1000);
      await renderTouch();
      fireEvent.click(key('Control'));
      fireEvent.click(key('Control'));
      expect(key('Control').getAttribute('data-mod-state')).toBe('locked');
      type('a'); type('b');
      expect(sendInput.mock.calls.map((c) => c[0])).toEqual(['\x01', '\x02']);
      expect(key('Control').getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(key('Control'));
      expect(key('Control').getAttribute('data-mod-state')).toBe('off');
      now.mockRestore();
    });

    test('Alt applies to a bar key', async () => {
      await renderTouch();
      fireEvent.click(key('Alt'));
      fireEvent.click(key('Escape'));
      expect(sendInput).toHaveBeenLastCalledWith('\x1b\x1b');
    });

    test('a bar tap focuses its pane', async () => {
      const onFocus = vi.fn();
      await renderTouch(onFocus);
      onFocus.mockClear();
      fireEvent.click(key('Tab'));
      expect(onFocus).toHaveBeenCalledTimes(1);
      fireEvent.click(key('Control'));
      expect(onFocus).toHaveBeenCalledTimes(2);
      fireEvent.click(key('Alt'));
      expect(onFocus).toHaveBeenCalledTimes(3);
    });

    test('without the bar, typed data reaches the pty unchanged', async () => {
      renderPane();
      await waitFor(() => expect(dataListener).not.toBeNull());
      type('c');
      expect(sendInput).toHaveBeenLastCalledWith('c');
    });
  });
});
