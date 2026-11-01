// Real xterm under happy-dom: the placeholder's contract is about xterm's own reads of the
// helper textarea, so a stand-in would test nothing.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { attachCapsPlaceholder, PLACEHOLDER as P } from './capsPlaceholder';

let t: Terminal;
let ta: HTMLTextAreaElement;
let bytes: string[];
let detach: () => void;

function setup(placeholder?: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  t = new Terminal();
  t.open(host);
  ta = t.textarea!;
  bytes = [];
  t.onData((d) => bytes.push(d));
  detach = attachCapsPlaceholder(t, placeholder);
}

beforeEach(() => {
  vi.useFakeTimers();
  setup();
});
afterEach(() => {
  detach();
  t.dispose();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTime(10);
const sent = () => bytes.join('');
const fire = (type: string, init: Record<string, unknown> = {}) =>
  ta.dispatchEvent(new (type.startsWith('composition') ? CompositionEvent : type.endsWith('input') ? InputEvent : KeyboardEvent)(type, { bubbles: true, cancelable: true, ...init }));
const key = (keyCode: number, init: Record<string, unknown> = {}) => {
  fire('keydown', { keyCode, ...init });
  fire('keyup', { keyCode });
};
// Chrome-Android shape: keydown 229, beforeinput, the edit, input (composed), keyup 229.
const edit = (next: string, inputType: string, data: string | null = null) => {
  fire('keydown', { keyCode: 229 });
  fire('beforeinput', { inputType, data });
  ta.value = next;
  ta.setSelectionRange(next.length, next.length);
  fire('input', { inputType, data, composed: true });
  fire('keyup', { keyCode: 229 });
};
const type229 = (s: string) => edit(ta.value + s, 'insertText', s);
const del229 = () => edit(ta.value.slice(0, -1), 'deleteContentBackward');
// An `input` with no keydown before it.
const delNoKeydown = () => {
  fire('beforeinput', { inputType: 'deleteContentBackward' });
  ta.value = ta.value.slice(0, -1);
  fire('input', { inputType: 'deleteContentBackward', composed: true });
};

describe('capsPlaceholder', () => {
  test('attach seeds an empty field with the cursor after the placeholder, so the first keystroke never meets an empty field', () => {
    expect(ta.value).toBe(P);
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([P.length, P.length]);
  });

  test('keyCode-229 typing sends exactly the typed text and the field holds the placeholder plus it', () => {
    type229('l'); flush();
    type229('s'); flush();
    expect(sent()).toBe('ls');
    expect(ta.value).toBe(`${P}ls`);
  });

  test('a non-composed insertText without a keydown sends only its data', () => {
    fire('beforeinput', { inputType: 'insertText', data: 'q' });
    ta.value += 'q';
    fire('input', { inputType: 'insertText', data: 'q' });
    flush();
    expect(sent()).toBe('q');
  });

  test('Enter sends CR and the field is reseeded after the flush; nothing sent contains the placeholder', () => {
    type229('ls'); flush();
    key(13);
    expect(ta.value).toBe('');
    flush();
    expect(ta.value).toBe(P);
    expect(sent()).toBe('ls\r');
  });

  test('Ctrl+C sends ETX and the field is reseeded', () => {
    key(67, { ctrlKey: true });
    expect(sent()).toBe('\x03');
    expect(ta.value).toBe('');
    flush();
    expect(ta.value).toBe(P);
  });

  test('a paste sends the pasted text only, and the field is reseeded', () => {
    const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
    e.clipboardData = { getData: () => 'pasted' };
    ta.dispatchEvent(e);
    expect(sent()).toBe('pasted');
    flush();
    expect(ta.value).toBe(P);
  });

  test('blur empties the field in xterm and focus reseeds it; focus on an emptied field reseeds', () => {
    fire('blur');
    flush();
    expect(ta.value).toBe(P);
    ta.value = '';
    fire('focus');
    flush();
    expect(ta.value).toBe(P);
  });

  test('a context menu without a selection and a selection change that empties the field both reseed', () => {
    ta.value = '';
    t.element!.dispatchEvent(new Event('contextmenu', { bubbles: true }));
    flush();
    expect(ta.value).toBe(P);
    ta.value = '';
    t.write('abc');
    t.selectAll();
    t.clearSelection();
    flush();
    expect(ta.value).toBe(P);
  });

  test('a contextmenu on the terminal element alone reseeds the emptied field, with no focus event', () => {
    vi.spyOn(ta, 'focus').mockImplementation(() => {});
    const focused = vi.fn();
    ta.addEventListener('focus', focused);
    ta.value = '';
    t.element!.dispatchEvent(new Event('contextmenu', { bubbles: true }));
    flush();
    expect(focused).not.toHaveBeenCalled();
    expect(ta.value).toBe(P);
  });

  test('a DEL xterm sent for typed text does not suppress the guard for a later no-keydown placeholder deletion', () => {
    type229('a'); flush();
    del229(); flush();
    expect(sent()).toBe('a\x7f');
    bytes.length = 0;
    delNoKeydown(); flush();
    expect(sent()).toBe('\x7f');
  });

  test('a placeholder deletion is forgotten at the next settle: a later blur-emptied field sends no DEL', () => {
    delNoKeydown(); flush();
    expect(sent()).toBe('\x7f');
    bytes.length = 0;
    fire('blur'); flush();
    expect(sent()).toBe('');
    expect(ta.value).toBe(P);
  });

  test('a real Backspace DEL seen before a composition does not swallow the DEL for a placeholder deleted inside it', () => {
    key(8);
    fire('compositionstart', { data: '' });
    fire('beforeinput', { inputType: 'deleteContentBackward' });
    ta.value = '';
    fire('input', { inputType: 'deleteContentBackward', composed: true });
    flush();
    fire('compositionend', { data: '' });
    flush();
    expect(bytes).toEqual(['\x7f', '\x7f']);
    expect(ta.value).toBe(P);
  });

  test('a composition cancelled by blur without compositionend does not stop later reseeds on focus or Enter', () => {
    fire('compositionstart', { data: '' });
    fire('blur');
    flush();
    expect(ta.value).toBe('');
    fire('focus');
    flush();
    expect(ta.value).toBe(P);
    fire('compositionstart', { data: '' });
    fire('blur');
    key(13); flush();
    expect(ta.value).toBe(P);
  });

  test('a blur during a composition begun on the Enter-emptied field never lets the placeholder reach the pty', () => {
    key(13);
    fire('compositionstart', { data: '' });
    fire('blur');
    flush();
    fire('compositionend', { data: '' });
    flush();
    expect(bytes).toEqual(['\r']);
    expect(ta.value).toBe(P);
  });

  test('a character typed right after Enter, before any timer flushes, is exactly that character', () => {
    key(13);
    type229('a');
    flush();
    expect(sent()).toBe('\ra');
  });

  test('Backspace on the placeholder (229 path) sends exactly one DEL and the field is reseeded', () => {
    del229(); flush();
    expect(sent()).toBe('\x7f');
    expect(ta.value).toBe(P);
  });

  test('Backspace on the placeholder through an input with no keydown sends exactly one DEL', () => {
    delNoKeydown(); flush();
    expect(sent()).toBe('\x7f');
    expect(ta.value).toBe(P);
  });

  test('Backspace on the placeholder inside a composition sends exactly one DEL, with no reseed until compositionend', () => {
    fire('compositionstart', { data: '' });
    fire('beforeinput', { inputType: 'deleteContentBackward' });
    ta.value = '';
    fire('input', { inputType: 'deleteContentBackward', composed: true });
    flush();
    expect(ta.value).toBe('');
    expect(sent()).toBe('');
    fire('compositionend', { data: '' });
    flush();
    expect(sent()).toBe('\x7f');
    expect(ta.value).toBe(P);
  });

  test('a real Backspace keydown (prevented by xterm) sends one DEL and leaves the field alone', () => {
    key(8);
    flush();
    expect(sent()).toBe('\x7f');
    expect(ta.value).toBe(P);
  });

  test('Backspace inside the placeholder plus typed text sends one DEL, keeps the rest, and adds no extra DEL', () => {
    type229('ls'); flush();
    bytes.length = 0;
    del229(); flush();
    expect(sent()).toBe('\x7f');
    expect(ta.value).toBe(`${P}l`);
  });

  test('compositions send only their own text: not the placeholder, also after a previous composition and after Enter', () => {
    const run = (updates: string[]) => {
      fire('compositionstart', { data: '' });
      const start = ta.value.length;
      for (const u of updates) {
        ta.value = ta.value.slice(0, start) + u;
        fire('compositionupdate', { data: u });
        flush();
      }
      fire('compositionend', { data: updates.at(-1) });
      flush();
    };
    run(['l', 'ls']);
    expect(sent()).toBe('ls');
    bytes.length = 0;
    run(['g', 'gi']);
    expect(sent()).toBe('gi');
    bytes.length = 0;
    key(13); bytes.length = 0;
    run(['x1']);
    expect(sent()).toBe('x1');
    expect(sent()).not.toContain(P + 'x1');
  });

  test('nothing is written to the field while composing, even when it is empty', () => {
    fire('compositionstart', { data: '' });
    ta.value = '';
    fire('keydown', { keyCode: 229 });
    flush();
    expect(ta.value).toBe('');
    fire('compositionend', { data: '' });
    flush();
    expect(ta.value).toBe(P);
  });

  test('detach empties the field, and afterwards Enter and blur leave it empty with no DEL emitted', () => {
    detach();
    expect(ta.value).toBe('');
    key(13);
    fire('blur');
    fire('focus');
    flush();
    expect(ta.value).toBe('');
    delNoKeydown(); flush();
    expect(sent()).toBe('\r');
    detach = () => {};
  });

  test('detach is safe after the terminal is disposed', () => {
    t.dispose();
    expect(() => detach()).not.toThrow();
    detach = () => {};
    t = new Terminal();
  });

  test('a custom placeholder is the one seeded', () => {
    detach();
    ta.value = '';
    detach = attachCapsPlaceholder(t, '​');
    expect(ta.value).toBe('​');
    type229('a'); flush();
    expect(sent()).toBe('a');
  });

  test('attaching to a terminal that is not open throws', () => {
    expect(() => attachCapsPlaceholder(new Terminal())).toThrow(/open/);
  });
});
