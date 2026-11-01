// Phone test page for soft-keyboard input: a real xterm with the production touch setup
// (`disableTextAssist`, `attachCapsPlaceholder`, `ExtraKeys`), a local echo, the exact bytes
// `onData` produced, and a trace of every helper-textarea event.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ExtraKeys } from '@/terminal/ExtraKeys';
import { attachCapsPlaceholder, PLACEHOLDER } from '@/terminal/capsPlaceholder';
import { keySequence, Modifiers, type ExtraKeyId } from '@/terminal/extraKeys';
import { disableTextAssist } from '@/terminal/softKeyboard';
import { TOUCH_QUERY } from '@/terminal/useTouchDevice';
import './page.css';

const CANDIDATES: Record<string, string | null> = { x: PLACEHOLDER, '200b': '​', none: null };
const choice = new URLSearchParams(location.search).get('p') ?? 'x';
const candidate = Object.hasOwn(CANDIDATES, choice) ? CANDIDATES[choice] : PLACEHOLDER;
// Only an untypable placeholder can be told from typed text in the log.
const highlight = candidate !== null && !/^[\x20-\x7e]$/.test(candidate);

const CHECKLIST = [
  '?p=none: type ls. The log shows L then s (the bug).',
  '?p=x: at a fresh prompt type ls. The log shows l, s, with no extra x (compare the log with what you typed). After Enter the next first letter is lowercase. After switching apps and back, the first letter is lowercase.',
  'Backspace: type abc, then 3 × Backspace logs 3 × \\x7f. A 4th Backspace (on the placeholder) logs exactly one \\x7f, a 5th another. Holding Backspace never logs doubles or stops.',
  'Swipe a word, tap a prediction, use voice input: the log holds the word and no stray placeholder (compare with what you typed). Note what the prediction strip shows.',
  'Bar Ctrl then soft-keyboard c logs \\x03. Long-press paste logs the pasted text only.',
  'Autocorrect on space: at a fresh prompt type a misspelled first word and a space (gti status), then a correctly spelled one (ls ). SwiftKey sees the placeholder as part of the first word, so it may rewrite it on space. The log must show exactly what was sent; note any rewrite or stray placeholder.',
  '?p=200b is a diagnostic only: U+200B was device-tested and does not stop SwiftKey capitalizing; the shipped placeholder is x.',
];

const esc = (s: string) => Array.from(s, (c) => {
  const cp = c.codePointAt(0)!;
  if (cp < 0x20 || cp === 0x7f) return `\\x${cp.toString(16).padStart(2, '0')}`;
  return cp > 0x7e ? `\\u{${cp.toString(16)}}` : c;
}).join('');

function Marked({ text }: { text: string }) {
  if (!candidate || !highlight) return <>{esc(text)}</>;
  return <>{text.split(candidate).flatMap((part, i) => (i === 0 ? [esc(part)] : [<mark key={i}>{esc(candidate)}</mark>, esc(part)]))}</>;
}

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
    const ta = t.textarea!;
    disableTextAssist(ta);
    const touch = matchMedia(TOUCH_QUERY).matches;
    setGate(touch);
    const detach = touch && candidate ? attachCapsPlaceholder(t, candidate) : () => {};
    let line = 0;
    const prompt = () => { t.write('$ '); line = 0; };
    prompt();
    const log = (s: string) => setTrace((l) => [...l.slice(-199), `${s}  [${esc(ta.value)}]`]);
    const listeners = ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'].map((type) => {
      const fn = (e: Event) => {
        const k = e as KeyboardEvent & InputEvent;
        const detail = type.startsWith('key') ? `${JSON.stringify(k.key)} ${k.keyCode}` : type.includes('input') ? `${k.inputType} ${JSON.stringify(k.data)}` : JSON.stringify(k.data);
        log(`${type} ${detail}`);
      };
      ta.addEventListener(type, fn, true);
      return () => ta.removeEventListener(type, fn, true);
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
      detach();
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
      <h1>Caps placeholder device test</h1>
      <nav>
        {Object.keys(CANDIDATES).map((k) => <a key={k} href={`?p=${k}`} className={k === choice ? 'on' : ''}>?p={k}</a>)}
      </nav>
      <div>Candidate: {candidate ? <code>{esc(candidate)}</code> : 'none (today)'} · touch gate ({TOUCH_QUERY}): {gate ? 'matched' : 'NOT matched, placeholder off'}</div>
      <div className="term" ref={host} />
      <ExtraKeys mods={mods} onKey={sendBarKey} />
      <button type="button" tabIndex={-1} onPointerDown={(e) => e.preventDefault()} onClick={clear}>Clear logs</button>
      <h2>Sent bytes (one row per onData)</h2>
      <pre aria-label="Sent bytes">{sent.map((s, i) => <div key={i}><Marked text={s} /></div>)}</pre>
      <h2>Sent, in order</h2>
      <pre>{echo}</pre>
      <h2>Event trace (textarea value in brackets)</h2>
      <pre>{trace.map((l, i) => <div key={i}>{l}</div>)}</pre>
      <h2>Checklist</h2>
      <ol>{CHECKLIST.map((c) => <li key={c}>{c}</li>)}</ol>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);
