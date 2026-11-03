// Replays logged device events (see harness/mobile-input/captureLog.ts) into a field.
// The log records absolute values, so an `in` event applies its logged value and selection
// before dispatching; a `bi` that the page prevented cancels the edit that follows it.
import type { LogEvent } from '../../../harness/mobile-input/captureLog';

export interface ReplayOptions {
  // Runs the fake timers; called after every event (`each`) or once after the last (`end`).
  advance: () => void;
  timers: 'each' | 'end';
}

export function replayStep(el: HTMLInputElement | HTMLTextAreaElement, events: readonly LogEvent[], { advance, timers }: ReplayOptions): void {
  let skipInput = false;
  for (const e of events) {
    switch (e.kind) {
      case 'kd': case 'ku':
        el.dispatchEvent(new KeyboardEvent(e.kind === 'kd' ? 'keydown' : 'keyup', { key: e.key, code: e.code, keyCode: e.keyCode, bubbles: true, cancelable: true } as KeyboardEventInit));
        break;
      case 'bi': {
        const ev = new InputEvent('beforeinput', { inputType: e.inputType, data: e.data, isComposing: e.composing, bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        skipInput = ev.defaultPrevented;
        break;
      }
      case 'in':
        if (skipInput) { skipInput = false; break; }
        el.value = e.v;
        el.setSelectionRange(e.s0, e.s1);
        el.dispatchEvent(new InputEvent('input', { inputType: e.inputType, data: e.data, isComposing: e.composing, bubbles: true }));
        break;
      case 'cs': case 'cu': case 'ce': {
        const type = { cs: 'compositionstart', cu: 'compositionupdate', ce: 'compositionend' }[e.kind];
        el.dispatchEvent(new CompositionEvent(type, { data: e.data, bubbles: true }));
        break;
      }
      case 'fo': el.focus(); break;
      case 'bl': el.blur(); break;
      case '~': case 'tx': break; // observations of the original run, not inputs
    }
    if (timers === 'each') advance();
  }
  if (timers === 'end') advance();
}

// --- a keyboard that edits the live field, for what a log cannot say -----------------------------
// A log records only the edits that happened; a field whose caret differs from the logged run would
// have edited differently. These apply an edit where the caret really is, like Chrome does.

// The keyboard (or Chrome) moves the caret without any input event.
export function driftCaret(el: HTMLInputElement, pos: number): void {
  el.setSelectionRange(pos, pos);
  document.dispatchEvent(new Event('selectionchange'));
}

export function insertAtCaret(el: HTMLInputElement, text: string): void {
  const before = new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true });
  el.dispatchEvent(before);
  if (before.defaultPrevented) return;
  const i = el.selectionStart ?? el.value.length;
  el.value = el.value.slice(0, i) + text + el.value.slice(i);
  el.setSelectionRange(i + text.length, i + text.length);
  el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
}

// Chrome deletes before the caret; at caret 0 there is nothing to delete and no event follows.
function deleteBackward(el: HTMLInputElement): void {
  const i = el.selectionStart ?? 0;
  if (i === 0) return;
  const before = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true });
  el.dispatchEvent(before);
  if (before.defaultPrevented) return;
  el.value = el.value.slice(0, i - 1) + el.value.slice(i);
  el.setSelectionRange(i - 1, i - 1);
  el.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
}

// One Backspace press: keyCode 229 (the keyboard's usual bare pair) or 8 (a real Backspace key
// event). The default action, deleting before the caret, runs only if the keydown was not prevented.
export function backspaceKey(el: HTMLInputElement, keyCode: 229 | 8): void {
  const down = new KeyboardEvent('keydown', { key: keyCode === 8 ? 'Backspace' : 'Unidentified', keyCode, bubbles: true, cancelable: true } as KeyboardEventInit);
  el.dispatchEvent(down);
  if (!down.defaultPrevented) deleteBackward(el);
  el.dispatchEvent(new KeyboardEvent('keyup', { key: down.key, keyCode, bubbles: true } as KeyboardEventInit));
}
