// Touch typing goes through a hidden <input> instead of xterm's helper textarea.
//
// Soft keyboards in suggestion mode (SwiftKey) rewrite the field behind the user's back
// (re-committing words, autospace after punctuation, auto-capitals), and xterm turns Android
// typing into a value diff taken on a timer, which loses or repeats bytes when edits arrive in
// one batch. An input created as `type=password` and then switched to `type=text` gets no
// suggestion strip, so the field only ever receives plain edits; each one is mirrored to the
// shell at once, with no timers. The attributes must be set before the first focus: Chrome
// copies them into the keyboard's editor info when the field gains focus.
import type { Terminal } from '@xterm/xterm';
import { applyModifiers, keySequence, type ExtraKeyId } from './extraKeys';
import { handleClipboardKey, type ClipboardLike } from './keys';
import { disableTextAssist, optOutOfAutofill } from './softKeyboard';

const DEL = '\x7f';

const NAMED_KEY: Record<string, ExtraKeyId> = {
  ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'right', Tab: 'tab', Escape: 'esc',
};

export interface TouchInput {
  focus(): void;
  // Forget the field: call when bytes reached the shell by any route other than this input's own
  // insert/delete diff, so a later edit never deletes more than was typed since.
  clear(): void;
  dispose(): void;
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;

// Call after `open()`.
export interface TouchInputOptions {
  // Diagnostic (capture page variant J): keep the field empty after every committed, non-composing
  // edit, so the keyboard's view of the field (empty, caret 0) matches it. A composition is emptied
  // when it ends, never during it.
  emptyField?: boolean;
  // Diagnostic (capture page variant K): SwiftKey sends most Backspaces as a bare keydown/keyup
  // 229 pair with no edit between (and moves the caret to 0), deleting nothing. Treat such a pair
  // as a Backspace: send one DEL and drop the last character from the field and the sent-text record.
  bareBackspace?: boolean;
}

// How long after the keyup an edit event may still show the browser did delete, so none is repeated.
const BARE_GUARD_MS = 40;

export function attachTouchInput(t: Terminal, clipboard: ClipboardLike = navigator.clipboard, { emptyField = false, bareBackspace = false }: TouchInputOptions = {}): TouchInput {
  const { textarea, element } = t;
  if (!textarea || !element) throw new Error('xterm has no helper textarea; call after open()');

  const el = document.createElement('input');
  el.type = 'password';
  (textarea.parentElement ?? element).append(el);
  el.type = 'text';
  disableTextAssist(el);
  optOutOfAutofill(el);
  el.setAttribute('aria-label', 'Terminal input');
  el.className = 'xterm-touch-input';
  // The same hiding as xterm's helper textarea; 16px stops iOS from zooming on focus.
  Object.assign(el.style, {
    position: 'absolute', opacity: '0', zIndex: '-5', border: '0', padding: '0', margin: '0',
    caretColor: 'transparent', fontSize: '16px',
  });
  const place = () => {
    const s = textarea.style;
    Object.assign(el.style, { left: s.left, top: s.top, width: s.width, height: s.height });
  };
  place();

  // The field's value as already sent to the shell since the last clear().
  let last = '';
  let composing = false;
  // A clear() that arrived mid-composition: the field is never written while composing, so it is
  // applied when the composition ends.
  let pendingClear = false;
  const wipe = () => {
    el.value = '';
    last = '';
  };
  const clear = () => {
    if (composing) pendingClear = true;
    else wipe();
  };
  // While a clear is pending the shell holds bytes the composition knows nothing about, so its
  // composing updates are not mirrored (a diff from `last` would resend text or delete the wrong
  // characters). It ends on `compositionend`, on blur, or on the first non-composing edit or key
  // (SwiftKey leaves empty compositions unended). Then only the part of the final text beyond what
  // was already sent goes out; a composition that no longer extends it sends nothing.
  const endComposition = () => {
    composing = false;
    if (!pendingClear) {
      if (emptyField) wipe();
      return;
    }
    pendingClear = false;
    if (el.value.startsWith(last)) send(el.value.slice(last.length));
    wipe();
  };

  // A non-composing event proves any composition we still track is over.
  const endStale = () => {
    if (pendingClear) endComposition();
    else composing = false;
  };
  // Keep the caret at the end: the shell line is edited only at its end, and the keyboard deletes
  // before the caret, so a caret it has moved (SwiftKey drifts it to 0 while idle) turns Backspace
  // into a no-op with no event at all. Skipped while composing, which owns the selection.
  const pin = () => {
    if (composing) return;
    const len = el.value.length;
    if (el.selectionStart !== len || el.selectionEnd !== len) el.setSelectionRange(len, len);
  };
  // Bare-pair detection: between a 229 keydown and its keyup nothing edited the field.
  let pairOpen = false;
  let pairEdited = false;
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const cancelPending = () => { for (const id of pending) clearTimeout(id); pending.clear(); };
  const noteEdit = () => {
    pairEdited = true;
    cancelPending(); // the browser deleted (or composed) after all
  };
  const applyBare = () => {
    if (composing || pendingClear) return;
    send(DEL);
    const chars = [...el.value];
    if (chars.length === 0) return;
    chars.pop();
    const next = chars.join('');
    el.value = next;
    last = next;
    pin();
  };
  const onKeyUp = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.keyCode !== 229 || k.isComposing) return;
    const bare = pairOpen && !pairEdited;
    pairOpen = false;
    if (!bare || composing || pendingClear) return;
    const id = setTimeout(() => { pending.delete(id); applyBare(); }, BARE_GUARD_MS);
    pending.add(id);
  };
  const send = (s: string) => { if (s) t.input(s); };
  const onInput = (e: Event) => {
    if (!(e as InputEvent).isComposing) {
      if (pendingClear) { endComposition(); return; }
      composing = false;
    } else if (pendingClear) return;
    const v = el.value;
    let p = 0;
    const n = Math.min(last.length, v.length);
    while (p < n && last[p] === v[p]) p++;
    if (p > 0 && isHighSurrogate(last.charCodeAt(p - 1))) p--;
    const removed = [...last.slice(p)].length;
    // Set before sending: a clear() triggered by the send itself must win.
    last = v;
    send(DEL.repeat(removed));
    send(v.slice(p));
    // A keyboard that mis-tracks the caret (it reports 0 on first focus) sends later characters
    // to the wrong place; moving the caret to the end makes Chrome resync the keyboard.
    if (emptyField && !(e as InputEvent).isComposing) { wipe(); return; }
    const len = el.value.length;
    if (!(e as InputEvent).isComposing && (el.selectionStart !== len || el.selectionEnd !== len)) {
      el.setSelectionRange(len, len);
    }
  };

  const onBeforeInput = (e: Event) => {
    if (!(e as InputEvent).isComposing) endStale();
    const type = (e as InputEvent).inputType;
    if (type === 'insertLineBreak' || type === 'insertParagraph') e.preventDefault();
  };

  const onKeyDown = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.isComposing || k.keyCode === 229) {
      if (!k.isComposing) {
        pin();
        pairOpen = true;
        pairEdited = false;
      }
      return;
    }
    endStale(); // flush held composition text before the key's own bytes
    pin(); // a caret moved without an event must be back at the end before the default action runs
    if (handleClipboardKey(t, k, clipboard, clear)) {
      k.preventDefault();
      return;
    }
    let out: string | null = null;
    if (k.key === 'Enter') out = '\r';
    else if (k.key === 'Backspace') out = k.keyCode === 8 && el.value === '' ? DEL : null;
    else if (NAMED_KEY[k.key]) out = keySequence(NAMED_KEY[k.key], t.modes.applicationCursorKeysMode);
    else if (k.key.length === 1 && (k.ctrlKey || k.altKey) && !k.metaKey && !(k.ctrlKey && k.shiftKey)) {
      out = applyModifiers(k.key, { ctrl: k.ctrlKey, alt: k.altKey });
    }
    if (out === null) return;
    k.preventDefault();
    t.input(out);
    clear();
  };

  const onPaste = (e: Event) => {
    e.preventDefault();
    e.stopPropagation(); // xterm also listens for paste on its element
    t.paste((e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '');
    clear();
  };

  // xterm keeps its focused state (cursor style, `focus` class, DECSET 1004 reports) through
  // events on its textarea, which is disabled and so can never gain focus itself.
  const relay = (type: 'focus' | 'blur') => () => { textarea.dispatchEvent(new FocusEvent(type)); };
  const relayFocus = relay('focus');
  const onFocus = () => {
    pin();
    relayFocus();
  };
  const onSelectionChange = () => { if (document.activeElement === el) pin(); };
  const relayBlur = relay('blur');
  // An IME may cancel a composition on blur without `compositionend`; stuck state would block clears.
  const onBlur = () => {
    relayBlur();
    if (composing) endComposition();
  };
  const onMouseDown = () => { el.focus({ preventScroll: true }); };

  const listeners: [EventTarget, string, (e: Event) => void][] = [
    [el, 'input', onInput],
    [el, 'beforeinput', onBeforeInput],
    [el, 'keydown', onKeyDown],
    [el, 'paste', onPaste],
    [el, 'focus', onFocus],
    ...(bareBackspace ? ([
      [el, 'keyup', onKeyUp],
      [el, 'beforeinput', noteEdit],
      [el, 'input', noteEdit],
      [el, 'compositionupdate', noteEdit],
      [el, 'compositionend', noteEdit],
    ] as [EventTarget, string, (e: Event) => void][]) : []),
    [el, 'compositionstart', () => { composing = true; noteEdit(); }],
    [el, 'compositionend', endComposition],
    [el, 'blur', onBlur],
    [element, 'mousedown', onMouseDown],
  ];
  listeners.push([document, 'selectionchange', onSelectionChange]);
  for (const [target, type, fn] of listeners) target.addEventListener(type, fn);

  // After a command is sent the keyboard's context should be an empty field, as xterm leaves it.
  const offData = t.onData((d) => {
    if (d === '\r' || d === '\x03') {
      // The line was submitted: whatever a pending composition held back is dropped.
      composing = false;
      pendingClear = false;
      wipe();
    }
  });
  const offRender = t.onRender(place);

  if (document.activeElement === textarea) el.focus({ preventScroll: true });
  textarea.disabled = true;

  return {
    focus: () => { el.focus({ preventScroll: true }); },
    clear,
    dispose() {
      // After `t.dispose()` (unmount order allows it) xterm's element is gone: only drop our own state.
      const alive = element.isConnected;
      cancelPending();
      const hadFocus = alive && document.activeElement === el;
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      offData.dispose();
      offRender.dispose();
      el.remove();
      textarea.disabled = false;
      if (hadFocus) {
        // xterm still counts as focused through the relay; blur it first so t.focus() reports once.
        textarea.dispatchEvent(new FocusEvent('blur'));
        t.focus();
      }
    },
  };
}
