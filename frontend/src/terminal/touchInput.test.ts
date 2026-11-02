// Real xterm under happy-dom: the proxy's contract is about what reaches xterm's onData, and
// about xterm's own focus and paste paths. The device steps come from a real SwiftKey capture.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { EMPTY_LINE, feedLine, lineText, parseCaptureLog, type LogEvent } from '../../../harness/mobile-input/captureLog';
import { replayStep } from '../test/replay';
import LOG from './fixtures/swiftkey-capture-log.txt?raw';
import { attachTouchInput } from './touchInput';

const STEPS = parseCaptureLog(LOG).filter((s) => s.verdict !== undefined);
const step = (variant: string, id: string) => STEPS.find((s) => s.variant === variant && s.id === id)!;

let t: Terminal;
let el: HTMLInputElement;
let ta: HTMLTextAreaElement;
let bytes: string[];
let touch: ReturnType<typeof attachTouchInput>;

function setup(opts: { focusTextarea?: boolean } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  t = new Terminal();
  t.open(host);
  ta = t.textarea!;
  if (opts.focusTextarea) ta.focus();
  bytes = [];
  t.onData((d) => bytes.push(d));
  touch = attachTouchInput(t);
  el = t.element!.querySelector<HTMLInputElement>('.xterm-touch-input')!;
}

beforeEach(() => {
  vi.useFakeTimers();
  setup();
});
afterEach(() => {
  touch.dispose();
  t.dispose();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const advance = () => vi.advanceTimersByTime(10);
const sent = () => bytes.join('');
const replay = (events: readonly LogEvent[], timers: 'each' | 'end' = 'each') => replayStep(el, events, { advance, timers });
const fire = (type: string, init: Record<string, unknown> = {}) => {
  const Ctor = type.startsWith('key') ? KeyboardEvent : type.startsWith('composition') ? CompositionEvent : InputEvent;
  const ev = new Ctor(type, { bubbles: true, cancelable: true, ...init } as EventInit);
  el.dispatchEvent(ev);
  return ev;
};
// A plain edit at the end of the field, as a keyboard without suggestions makes it.
const typeText = (s: string) => {
  el.value += s;
  el.setSelectionRange(el.value.length, el.value.length);
  fire('input', { inputType: 'insertText', data: s });
};
const press = (key: string, keyCode: number, init: Record<string, unknown> = {}) => fire('keydown', { key, keyCode, ...init });
const writeMode = (seq: string) => { t.write(seq); advance(); };
const upToEnter = (b: string) => b.slice(0, b.indexOf('\r'));

describe('replaying device logs into the proxy', () => {
  test('a keyboard with no suggestions (variant E) sends exactly the wanted line and CR', () => {
    for (const id of ['S1', 'S4', 'S6']) {
      bytes = [];
      replay(step('E', id).events);
      expect(sent(), id).toBe(`${step('E', id).want}\r`);
      expect(el.value, `${id} cleared after Enter`).toBe('');
    }
    expect(step('E', 'S1').want).toBe('ls -all.');
  });

  test('every B to E step gives the same bytes however the timers batch, and the shell line is the field at Enter', () => {
    let checked = 0;
    for (const s of STEPS.filter((x) => x.variant !== 'A')) {
      const enter = [...s.events].reverse().find((e): e is Extract<LogEvent, { key: string }> => e.kind === 'kd' && e.key === 'Enter');
      if (!enter) continue;
      const runs = (['each', 'end'] as const).map((mode) => {
        el.value = '';
        touch.dispose();
        t.dispose();
        document.body.innerHTML = '';
        setup();
        replay(s.events, mode);
        return sent();
      });
      expect(runs[0], `${s.variant}.${s.id} batching`).toBe(runs[1]);
      expect(lineText(feedLine(EMPTY_LINE, runs[0])), `${s.variant}.${s.id} line`).toBe(enter.v);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  test('B.S5 never sends the whole field again as one chunk', () => {
    const s = step('B', 'S5');
    replay(s.events);
    const enter = s.events.find((e): e is Extract<LogEvent, { key: string }> => e.kind === 'kd' && e.key === 'Enter')!;
    const field = enter.v;
    expect(field.length).toBeGreaterThan(2);
    expect(bytes).not.toContain(field);
    expect(bytes.filter((b) => b.length > 1 && b.includes(field))).toEqual([]);
  });
});

describe('Enter', () => {
  test('sends exactly CR, clears the field, ignores the line-break edit that follows, and the next typing starts empty', () => {
    typeText('ls');
    const enter = press('Enter', 13);
    expect(enter.defaultPrevented).toBe(true);
    expect(sent()).toBe('ls\r');
    expect(el.value).toBe('');
    bytes = [];
    replay(step('E', 'S4').events.slice(0, 2)); // beforeinput insertLineBreak, keyup Enter
    expect(sent()).toBe('');
    typeText('e');
    expect(sent()).toBe('e');
  });
});

describe('deletion', () => {
  const del = (inputType: string, next: string) => {
    el.value = next;
    el.setSelectionRange(next.length, next.length);
    fire('input', { inputType });
  };

  test('a backspace is one DEL and a word deletion is one DEL per character', () => {
    typeText('abc');
    bytes = [];
    del('deleteContentBackward', 'ab');
    expect(sent()).toBe('\x7f');
    bytes = [];
    typeText('cde');
    bytes = [];
    del('deleteWordBackward', 'ab');
    expect(sent()).toBe('\x7f\x7f\x7f');
  });

  test('Backspace keydown on an empty field sends one DEL and is prevented', () => {
    const ev = press('Backspace', 8);
    expect(ev.defaultPrevented).toBe(true);
    expect(sent()).toBe('\x7f');
  });

  test('a delete then Enter leaves no DEL after the CR, even when timers run later', () => {
    typeText('ab');
    del('deleteContentBackward', 'a');
    press('Enter', 13);
    advance();
    expect(sent()).toBe('ab\x7f\r');
  });

  test('deleting an emoji sends one DEL', () => {
    typeText('😀');
    bytes = [];
    del('deleteContentBackward', '');
    expect(sent()).toBe('\x7f');
  });
});

describe('caret', () => {
  test('B.S1 first commit leaving the caret at 0: the caret goes back to the end and the next character appends', () => {
    const open = step('B', 'S1').events;
    const firstIn = open.findIndex((e) => e.kind === 'in');
    expect(open[firstIn]).toMatchObject({ s0: 0, s1: 0 });
    replay(open.slice(0, firstIn + 1));
    expect([el.selectionStart, el.selectionEnd]).toEqual([el.value.length, el.value.length]);
    bytes = [];
    typeText('s');
    expect(el.value.endsWith('s')).toBe(true);
    expect(sent()).toBe('s');
  });
});

describe('composition', () => {
  const comp = (value: string) => {
    el.value = value;
    el.setSelectionRange(value.length, value.length);
    fire('input', { inputType: 'insertCompositionText', data: value, isComposing: true });
  };

  test('each composition update is sent as a diff and compositionend adds nothing', () => {
    fire('compositionstart', { data: '' });
    comp('l');
    comp('ls');
    comp('lsx');
    expect(sent()).toBe('lsx');
    fire('compositionend', { data: 'lsx' });
    advance();
    expect(sent()).toBe('lsx');
  });

  test('a rewritten composition deletes the changed tail and sends the new one', () => {
    fire('compositionstart', { data: '' });
    comp('Ls');
    bytes = [];
    comp('LS');
    expect(sent()).toBe('\x7fS');
  });

  test('a blur mid-composition writes nothing to the field and sends nothing; typing after refocus is clean', () => {
    el.focus();
    fire('compositionstart', { data: '' });
    comp('ls');
    bytes = [];
    el.blur();
    advance();
    expect(el.value).toBe('ls');
    expect(sent()).toBe('');
    el.focus();
    advance();
    expect(el.value).toBe('ls');
    expect(sent()).toBe('');
    typeText('x');
    expect(sent()).toBe('x');
  });
});

describe('paste', () => {
  const paste = (text: string) => {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { getData: (k: string) => (k === 'text/plain' ? text : '') } });
    el.dispatchEvent(ev);
    return ev;
  };

  test('pastes through xterm exactly once, keeping line breaks, and leaves the field alone', () => {
    typeText('q');
    bytes = [];
    const ev = paste('a\nb');
    expect(ev.defaultPrevented).toBe(true);
    expect(sent()).toBe('a\rb');
    expect(el.value).toBe('q');
  });

  test('is bracketed when the application asked for it', () => {
    writeMode('\x1b[?2004h');
    paste('hi');
    expect(sent()).toBe('\x1b[200~hi\x1b[201~');
  });
});

describe('keys', () => {
  test('arrows follow application-cursor mode', () => {
    press('ArrowUp', 38);
    expect(sent()).toBe('\x1b[A');
    writeMode('\x1b[?1h');
    bytes = [];
    press('ArrowUp', 38);
    press('ArrowLeft', 37);
    expect(sent()).toBe('\x1bOA\x1bOD');
  });

  test('Tab, Escape and Ctrl+c are sent and prevented; a bare 229 keydown sends nothing', () => {
    for (const [key, code, init, out] of [['Tab', 9, {}, '\t'], ['Escape', 27, {}, '\x1b'], ['c', 67, { ctrlKey: true }, '\x03']] as const) {
      bytes = [];
      const ev = press(key, code, init);
      expect(ev.defaultPrevented, key).toBe(true);
      expect(sent(), key).toBe(out);
    }
    bytes = [];
    const ev = press('Unidentified', 229);
    expect(sent()).toBe('');
    expect(ev.defaultPrevented).toBe(false);
  });

  test('Ctrl+c, like a bar Ctrl-C, empties the field so the next line starts clean', () => {
    typeText('sleep');
    press('c', 67, { ctrlKey: true });
    expect(el.value).toBe('');
    bytes = [];
    typeText('a');
    expect(sent()).toBe('a');
  });

  test('a printable key without modifiers keeps its default so the character arrives as input', () => {
    expect(press('a', 65).defaultPrevented).toBe(false);
  });
});

describe('construction', () => {
  test('the proxy is made as a password field, switched to text, with text assistance off before any focus', async () => {
    touch.dispose();
    t.dispose();
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    t = new Terminal();
    t.open(host);
    const types: (string | null)[] = [];
    const mo = new MutationObserver((rs) => { for (const r of rs) if (r.attributeName === 'type') types.push(r.oldValue); });
    mo.observe(t.element!, { subtree: true, attributes: true, attributeOldValue: true });
    const focuses: Element[] = [];
    document.addEventListener('focusin', (e) => focuses.push(e.target as Element));
    touch = attachTouchInput(t);
    el = t.element!.querySelector<HTMLInputElement>('.xterm-touch-input')!;
    await Promise.resolve();
    mo.disconnect();
    expect(types).toEqual(['password']);
    expect(el.type).toBe('text');
    expect(focuses).toEqual([]);
    for (const [a, v] of [['autocapitalize', 'off'], ['autocorrect', 'off'], ['autocomplete', 'off'], ['spellcheck', 'false']]) {
      expect(el.getAttribute(a), a).toBe(v);
    }
    expect(el.getAttribute('aria-label')).toBe('Terminal input');
  });
});

describe('focus', () => {
  test('a mousedown on the terminal focuses the proxy, and the textarea is disabled so xterm cannot take focus', () => {
    t.element!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(el);
    expect(ta.disabled).toBe(true);
    t.focus();
    expect(document.activeElement).not.toBe(ta);
  });

  test('focus and blur reach xterm: focus class and the focus reports', () => {
    writeMode('\x1b[?1004h');
    bytes = []; // xterm reports the current (blurred) state when the mode is enabled
    el.focus();
    expect(sent()).toBe('\x1b[I');
    expect(t.element!.classList.contains('focus')).toBe(true);
    el.blur();
    expect(sent()).toBe('\x1b[I\x1b[O');
    expect(t.element!.classList.contains('focus')).toBe(false);
  });

  test('attaching while the textarea has focus moves focus to the proxy', () => {
    touch.dispose();
    t.dispose();
    document.body.innerHTML = '';
    setup({ focusTextarea: true });
    expect(document.activeElement).toBe(el);
  });

  test('dispose removes the proxy, re-enables the textarea and returns focus to xterm when the proxy had it', () => {
    el.focus();
    touch.dispose();
    expect(t.element!.querySelector('.xterm-touch-input')).toBeNull();
    expect(ta.disabled).toBe(false);
    expect(document.activeElement).toBe(ta);
    // and typing into the removed proxy no longer sends anything
    bytes = [];
    el.value = 'zz';
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'z', bubbles: true }));
    expect(sent()).toBe('');
    touch = attachTouchInput(t); // afterEach disposes again
  });

  test('a focus method on the handle focuses the proxy', () => {
    touch.focus();
    expect(document.activeElement).toBe(el);
  });
});
