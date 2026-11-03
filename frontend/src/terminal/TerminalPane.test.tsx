import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConnHandlers, ConnState } from './socket';

const termModes = { applicationCursorKeysMode: false };
const termInput = vi.fn((d: string) => dataListener?.(d));
let dataListener: ((d: string) => void) | null = null;
const dataFns = new Set<(d: string) => void>();

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
    onSelectionChange() { return { dispose() {} }; }
    onRender() { return { dispose() {} }; }
    onData(fn: (d: string) => void) {
      dataFns.add(fn);
      dataListener = (d) => dataFns.forEach((f) => f(d));
      return { dispose() { dataFns.delete(fn); } };
    } onBinary() { return { dispose() {} }; }
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
const { EMPTY_LINE, feedLine, lineText } = await import('../../../harness/mobile-input/captureLog');
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
  dataFns.clear();
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
      await waitFor(() => expect(document.querySelector('.xterm-touch-input')).not.toBeNull());
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

    describe('the synthetic Backspace of a bare 229 pair', () => {
      const proxy = () => document.querySelector<HTMLInputElement>('.xterm-touch-input')!;
      const bare = () => {
        fireEvent.keyDown(proxy(), { key: 'Unidentified', keyCode: 229 });
        fireEvent.keyUp(proxy(), { key: 'Unidentified', keyCode: 229 });
      };
      const typeInto = (text: string) => {
        proxy().value += text;
        fireEvent.input(proxy(), { inputType: 'insertText', data: text });
      };
      const sentBytes = () => sendInput.mock.calls.map((c) => c[0] as string);

      test('goes out unmodified and leaves an armed Alt armed for the next real key', async () => {
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        typeInto('ab');
        fireEvent.click(key('Alt'));
        vi.useFakeTimers();
        try {
          bare();
          act(() => { vi.advanceTimersByTime(60); });
          expect(sentBytes().at(-1)).toBe('\x7f');
          expect(proxy().value).toBe('a');
          expect(key('Alt').getAttribute('aria-pressed')).toBe('true');
          typeInto('c');
          expect(sentBytes().at(-1)).toBe('\x1bc');
        } finally { vi.useRealTimers(); }
      });

      test('two pairs 25 ms apart with Alt armed send two plain DELs and leave Alt armed', async () => {
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        typeInto('abc');
        sendInput.mockClear();
        fireEvent.click(key('Alt'));
        vi.useFakeTimers();
        try {
          bare();
          act(() => { vi.advanceTimersByTime(25); });
          bare();
          act(() => { vi.advanceTimersByTime(200); });
          expect(sentBytes()).toEqual(['\x7f', '\x7f']);
          expect(proxy().value).toBe('a');
          expect(key('Alt').getAttribute('aria-pressed')).toBe('true');
        } finally { vi.useRealTimers(); }
      });

      test('the same with Ctrl locked: two plain DELs, still locked', async () => {
        const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(100).mockReturnValue(1000);
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        typeInto('abc');
        fireEvent.click(key('Control'));
        fireEvent.click(key('Control'));
        expect(key('Control').getAttribute('data-mod-state')).toBe('locked');
        sendInput.mockClear();
        vi.useFakeTimers();
        try {
          bare();
          act(() => { vi.advanceTimersByTime(25); });
          bare();
          act(() => { vi.advanceTimersByTime(200); });
          expect(sentBytes()).toEqual(['\x7f', '\x7f']);
          expect(key('Control').getAttribute('data-mod-state')).toBe('locked');
        } finally { vi.useRealTimers(); now.mockRestore(); }
      });

      test('a character typed inside the guard cancels the DEL whether or not beforeinput fired: the field and the shell agree', async () => {
        for (const withBeforeInput of [false, true]) {
          cleanup();
          sendInput.mockClear();
          await renderTouch();
          await waitFor(() => expect(proxy()).not.toBeNull());
          typeInto('ab');
          sendInput.mockClear();
          vi.useFakeTimers();
          try {
            bare();
            if (withBeforeInput) fireEvent(proxy(), new InputEvent('beforeinput', { inputType: 'insertText', data: 'c', bubbles: true, cancelable: true }));
            typeInto('c');
            act(() => { vi.advanceTimersByTime(200); });
            expect(sentBytes(), `beforeinput=${withBeforeInput}`).toEqual(['c']);
            expect(proxy().value).toBe('abc');
          } finally { vi.useRealTimers(); }
        }
      });

      test('a bar key tapped inside the guard goes out after the DEL, not before it', async () => {
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        typeInto('abc');
        sendInput.mockClear();
        vi.useFakeTimers();
        try {
          bare();
          fireEvent.click(key('Dash'));
          act(() => { vi.advanceTimersByTime(600); });
          expect(sentBytes()).toEqual(['\x7f', '-']);
        } finally { vi.useRealTimers(); }
      });
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

    describe('touch input', () => {
      const proxy = () => screen.queryByRole('textbox', { name: 'Terminal input' }) as HTMLInputElement | null;
      const textarea = () => document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!;
      const typeInto = (el: HTMLInputElement, text: string) => {
        el.value += text;
        fireEvent.input(el, { inputType: 'insertText', data: text });
      };

      test('on touch a textbox named "Terminal input" exists after open', async () => {
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        expect(textarea().disabled).toBe(true);
      });

      test('the pane body blocks native panning on touch only, and follows the gate', async () => {
        const panBlocked = () => {
          const v = document.querySelector<HTMLElement>('.pane-body')!.style.touchAction;
          return v === 'none' || v === 'pinch-zoom';
        };
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        expect(panBlocked()).toBe(true);
        mqlMatches = false;
        act(() => mqlListeners.forEach((f) => f()));
        expect(panBlocked()).toBe(false);
      });

      test('typing into the proxy reaches the pty, and a bar Ctrl then c sends ETX', async () => {
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        typeInto(proxy()!, 'l');
        expect(sendInput).toHaveBeenLastCalledWith('l');
        fireEvent.click(key('Control'));
        typeInto(proxy()!, 'c');
        expect(sendInput).toHaveBeenLastCalledWith('\x03');
        expect(proxy()!.value).toBe('');
      });

      const shell = () => lineText(feedLine(EMPTY_LINE, sendInput.mock.calls.map((c) => c[0]).join('')));
      const deleteAll = (el: HTMLInputElement) => {
        el.value = '';
        fireEvent.input(el, { inputType: 'deleteWordBackward' });
      };

      test('a bar symbol key empties the field, so a later word-delete cannot remove more than was typed since', async () => {
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        typeInto(proxy()!, 'ls');
        fireEvent.click(key('Dash'));
        expect(proxy()!.value).toBe('');
        typeInto(proxy()!, 'la');
        deleteAll(proxy()!);
        expect(shell()).toBe('ls-');
      });

      test('a modifier-changed chunk mid-composition leaves the field alone until compositionend', async () => {
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        fireEvent.compositionStart(proxy()!);
        fireEvent.click(key('Control'));
        proxy()!.value = 'a';
        fireEvent.input(proxy()!, { inputType: 'insertCompositionText', data: 'a', isComposing: true });
        expect(sendInput).toHaveBeenLastCalledWith('\x01');
        expect(proxy()!.value).toBe('a');
        proxy()!.value = 'ab';
        fireEvent.input(proxy()!, { inputType: 'insertCompositionText', data: 'ab', isComposing: true });
        fireEvent.compositionEnd(proxy()!, { data: 'ab' });
        expect(proxy()!.value).toBe('');
        expect(sendInput.mock.calls.map((c) => c[0]).join('')).toBe('\x01b');
      });

      test('after a bar Ctrl+l the field is empty: no phantom character, and an insert at caret 0 stays clean', async () => {
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        typeInto(proxy()!, 'ab');
        fireEvent.click(key('Control'));
        typeInto(proxy()!, 'l');
        expect(proxy()!.value).toBe('');
        proxy()!.value = 'x';
        proxy()!.setSelectionRange(0, 0);
        fireEvent.input(proxy()!, { inputType: 'insertText', data: 'x' });
        expect(sendInput.mock.calls.map((c) => c[0]).join('')).toBe('ab\x0cx');
      });

      test('on desktop there is no proxy and the textarea stays enabled', async () => {
        renderPane();
        await waitFor(() => expect(textarea()).not.toBeNull());
        await waitFor(() => expect(matchMediaMock).toHaveBeenCalled());
        expect(proxy()).toBeNull();
        expect(textarea().disabled).toBe(false);
      });

      test('the gate follows the media query live: leaving touch removes the proxy and re-enables the textarea', async () => {
        await renderTouch();
        await waitFor(() => expect(proxy()).not.toBeNull());
        mqlMatches = false;
        act(() => mqlListeners.forEach((f) => f()));
        expect(proxy()).toBeNull();
        expect(textarea().disabled).toBe(false);
        mqlMatches = true;
        act(() => mqlListeners.forEach((f) => f()));
        expect(proxy()).not.toBeNull();
        expect(textarea().disabled).toBe(true);
      });

      test('the focus effect focuses the proxy on touch', async () => {
        await renderTouch();
        await waitFor(() => expect(document.activeElement).toBe(proxy()));
      });
    });
  });
});
