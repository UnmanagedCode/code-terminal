// Phone test page for soft-keyboard input: a real xterm with the production touch setup
// (`disableTextAssist`, `attachTouchInput`, `ExtraKeys`), a local echo, the exact bytes
// `onData` produced, and a trace of every event on the touch input.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ExtraKeys } from '@/terminal/ExtraKeys';
import { keySequence, Modifiers, type ExtraKeyId } from '@/terminal/extraKeys';
import { disableTextAssist } from '@/terminal/softKeyboard';
import { attachTouchInput } from '@/terminal/touchInput';
import { TOUCH_QUERY } from '@/terminal/useTouchDevice';
import './page.css';

const CHECKLIST = [
  'Tap the box and type ls straight away: it appears in order (not reversed). No suggestion strip, no capital first letter. Switch to another app and back, then type again.',
  'Backspace: type abc, then 4 × Backspace logs 3 × \\x7f and a 4th \\x7f (the keyboard sends it on an empty field). Holding Backspace never logs doubles or stops.',
  'Type ls -all. then Enter: the sent bytes are exactly ls -all.\\r, with no stray space after - or . and no doubled characters.',
  'Swipe the spacebar left and right: SwiftKey sends real arrow keys, which the touch input forwards as \\x1b[D / \\x1b[C, so the shell cursor moves. Then try swipe typing and voice input and note whether they still work.',
  'Bar Ctrl then soft-keyboard c logs \\x03. The arrows log \\x1b[A and so on. Long-press paste logs the pasted text only; note any password-manager prompt.',
];

const esc = (s: string) => Array.from(s, (c) => {
  const cp = c.codePointAt(0)!;
  if (cp < 0x20 || cp === 0x7f) return `\\x${cp.toString(16).padStart(2, '0')}`;
  return cp > 0x7e ? `\\u{${cp.toString(16)}}` : c;
}).join('');

function Page() {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const [mods] = useState(() => new Modifiers());
  const [sent, setSent] = useState<string[]>([]);
  const [trace, setTrace] = useState<string[]>([]);
  const [echo, setEcho] = useState('');
  const [gate, setGate] = useState(false);

  useEffect(() => {
    const t = new Terminal({ fontSize: 13, rows: 6, cursorBlink: true });
    term.current = t;
    t.open(host.current!);
    disableTextAssist(t.textarea);
    const touch = matchMedia(TOUCH_QUERY).matches;
    setGate(touch);
    const attached = touch ? attachTouchInput(t) : null;
    // The touch input takes the keystrokes on a phone; the helper textarea elsewhere.
    const field: HTMLElement = t.element!.querySelector<HTMLElement>('.xterm-touch-input') ?? t.textarea!;
    const value = () => (field as HTMLInputElement).value;
    let line = 0;
    const prompt = () => { t.write('$ '); line = 0; };
    prompt();
    const log = (s: string) => setTrace((l) => [...l.slice(-199), `${s}  [${esc(value())}]`]);
    const listeners = ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'].map((type) => {
      const fn = (e: Event) => {
        const k = e as KeyboardEvent & InputEvent;
        const detail = type.startsWith('key') ? `${JSON.stringify(k.key)} ${k.keyCode}` : type.includes('input') ? `${k.inputType} ${JSON.stringify(k.data)}` : JSON.stringify(k.data);
        log(`${type} ${detail}`);
      };
      field.addEventListener(type, fn, true);
      return () => field.removeEventListener(type, fn, true);
    });
    const data = t.onData((d) => {
      const out = mods.apply(d);
      setSent((l) => [...l.slice(-199), out]);
      setEcho((e) => `${e}${esc(out)} `);
      if (out === '\x7f') {
        if (line > 0) { t.write('\b \b'); line--; } else t.write('⌫');
      } else if (out === '\r') { t.write('\r\n'); prompt(); }
      else if (out === '\x03') { t.write('^C\r\n'); prompt(); }
      else if (/^[\x20-\x7e]+$/.test(out)) { t.write(out); line += out.length; }
      else t.write(esc(out));
    });
    return () => {
      attached?.dispose();
      data.dispose();
      listeners.forEach((off) => off());
      t.dispose();
    };
  }, [mods]);

  const sendBarKey = (id: ExtraKeyId) => {
    if (id === 'ctrl' || id === 'alt') { mods.tap(id); return; }
    const t = term.current!;
    t.focus();
    t.input(keySequence(id, t.modes.applicationCursorKeysMode));
  };
  const clear = () => { setSent([]); setTrace([]); setEcho(''); };

  return (
    <main>
      <h1>Touch input device test</h1>
      <a href="./capture.html">Event capture →</a>
      <div>Touch gate ({TOUCH_QUERY}): {gate ? 'matched' : 'NOT matched, the touch input is off'}</div>
      <div className="term" ref={host} />
      <ExtraKeys mods={mods} onKey={sendBarKey} />
      <button type="button" tabIndex={-1} onPointerDown={(e) => e.preventDefault()} onClick={clear}>Clear logs</button>
      <h2>Sent bytes (one row per onData)</h2>
      <pre aria-label="Sent bytes">{sent.map((s, i) => <div key={i}>{esc(s)}</div>)}</pre>
      <h2>Sent, in order</h2>
      <pre>{echo}</pre>
      <h2>Event trace (field value in brackets)</h2>
      <pre>{trace.map((l, i) => <div key={i}>{l}</div>)}</pre>
      <h2>Checklist</h2>
      <ol>{CHECKLIST.map((c) => <li key={c}>{c}</li>)}</ol>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);
