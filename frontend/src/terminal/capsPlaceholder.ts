// Keeps a placeholder before the cursor in xterm's helper textarea so soft keyboards
// that ignore autocapitalize (SwiftKey) never see an empty, sentence-start field.
// Typing, deletion, Enter, paste and composition never send the placeholder; an IME rewrite of
// the first word (e.g. recapitalizing `xls`) can include it.
//
// xterm turns Android typing into diffs of the textarea's value (keyCode 229 keydown, then a
// `setTimeout(0)` re-read), so a placeholder already in the field never reaches the pty. The
// field is therefore only ever rewritten from one `setTimeout(0)` timer queued after xterm's
// own, never between one of xterm's reads and its timer, and never while composing. Each
// listener sits in the phase xterm's own uses: a capture-phase `stopPropagation` (Enter) would
// hide a bubble-phase `keydown` listener, and a capture `compositionend` listener would queue
// our timer before xterm's finalize timer.
import type { Terminal } from '@xterm/xterm';

export const PLACEHOLDER = 'x';

const DEL = '\x7f';

type Host = Pick<Terminal, 'textarea' | 'element' | 'onData' | 'onSelectionChange' | 'input'>;

// Call after `open()`. Returns the detach function, which also empties the field if it holds exactly the placeholder.
export function attachCapsPlaceholder(t: Host, placeholder = PLACEHOLDER): () => void {
  const { textarea, element } = t;
  if (!textarea || !element) throw new Error('xterm has no helper textarea; call after open()');

  let timer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let before: string | null = null; // the value at `beforeinput`
  let ateP = false; // the placeholder itself was deleted
  let sawDel = false; // xterm emitted DEL since the last settle

  const seed = () => {
    if (textarea.value !== '') return;
    textarea.value = placeholder;
    textarea.setSelectionRange(placeholder.length, placeholder.length);
  };
  const settle = () => {
    if (composing) return;
    // xterm sends nothing when the placeholder goes by an `input` without a keydown or inside a
    // composition; when it already sent the DEL, a second one would delete a real character.
    if (ateP && !sawDel && textarea.value === '') t.input(DEL);
    ateP = false;
    sawDel = false;
    seed();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(settle, 0);
  };

  const listeners: [EventTarget, string, () => void, boolean][] = [
    [textarea, 'keydown', schedule, true],
    [textarea, 'beforeinput', () => { before = textarea.value; }, true],
    [textarea, 'input', () => {
      if (before === placeholder && textarea.value === '') {
        ateP = true;
        sawDel = false; // a DEL seen before this deletion is not the one for the placeholder
      }
      schedule();
    }, true],
    [textarea, 'compositionstart', () => { composing = true; }, false],
    [textarea, 'compositionend', () => { composing = false; schedule(); }, false],
    [textarea, 'paste', schedule, false],
    [textarea, 'focus', schedule, false],
    // An IME may cancel a composition on blur without `compositionend`; stuck state would stop every
    // reseed. Seeding now would put the placeholder inside a composition xterm may still finalize
    // from an earlier start offset, so the next focus or keydown seeds instead.
    [textarea, 'blur', () => {
      if (composing) {
        composing = false;
        clearTimeout(timer);
      } else schedule();
    }, false],
    [element, 'contextmenu', schedule, false],
  ];
  for (const [target, type, fn, capture] of listeners) target.addEventListener(type, fn, capture);
  const offSelection = t.onSelectionChange(schedule);
  const offData = t.onData((d) => { if (d === DEL) sawDel = true; });

  seed();

  return () => {
    clearTimeout(timer);
    for (const [target, type, fn, capture] of listeners) target.removeEventListener(type, fn, capture);
    offSelection.dispose();
    offData.dispose();
    if (textarea.value === placeholder) textarea.value = '';
  };
}
