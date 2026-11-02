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
