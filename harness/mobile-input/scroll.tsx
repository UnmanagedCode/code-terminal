// Phone test page for touch scrolling: a real xterm with the production touch setup
// (`disableTextAssist`, `attachTouchInput`, `attachTouchScroll`), 300 numbered lines, a
// page-load counter (a pull-to-refresh of cc's page reloads this frame and raises it), a live
// fix on/off toggle and a PASS/FAIL checklist reported through `window.ccArtifact.report`.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { disableTextAssist } from '@/terminal/softKeyboard';
import { attachTouchInput } from '@/terminal/touchInput';
import { attachTouchScroll, type TouchScroll } from '@/terminal/touchScroll';
import './page.css';

const LOADS_KEY = 'code-terminal:scroll-loads';
const loads = (() => {
  let n = 0;
  try {
    n = Number(sessionStorage.getItem(LOADS_KEY) ?? 0) + 1;
    sessionStorage.setItem(LOADS_KEY, String(n));
  } catch { /* storage blocked: the counter stays 0 */ }
  return n;
})();

const STEPS = [
  { id: 'S1', text: 'CONTROL, fix OFF: press "Fix: OFF" below, then swipe down over the terminal. The page should reload and Page loads goes up. PASS = it reloaded (the bug reproduces here). If it does not reload, press FAIL and stop.' },
  { id: 'S2', text: 'Fix ON: swipe down slowly over the terminal. Older lines follow your finger. Keep going to line 001: it stops there and Page loads does not change.' },
  { id: 'S3', text: 'Swipe up back to the bottom. It stops at the prompt and nothing reloads.' },
  { id: 'S4', text: 'Tap the terminal: the keyboard opens. Type ls, Backspace once (a single tap), Enter. The echo below shows ls, then \\x7f, then \\r in order.' },
  { id: 'S5', text: 'With the keyboard open, swipe the terminal. It scrolls, nothing reloads and the keyboard stays open.' },
  { id: 'S6', text: 'Swipe the keyboard spacebar left and right: the echo shows \\x1b[D and \\x1b[C.' },
  { id: 'S7', text: 'Pinch with two fingers over the terminal. Note whether the page zooms (put it in the note). Nothing reloads and the terminal does not scroll.' },
  { id: 'S8', text: 'OBSERVATION: swipe down on the strip above the terminal (title bar). PASS = it reloads (not fixed here), FAIL = it does not.' },
];

type Verdict = 'PASS' | 'FAIL';

const esc = (s: string) => Array.from(s, (c) => {
  const cp = c.codePointAt(0)!;
  return cp < 0x20 || cp === 0x7f ? `\\x${cp.toString(16).padStart(2, '0')}` : c;
}).join('');

function Page() {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const scroll = useRef<TouchScroll | null>(null);
  const [fix, setFix] = useState(true);
  const [echo, setEcho] = useState('');
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const fixRef = useRef(fix);
  fixRef.current = fix;

  useEffect(() => {
    const t = new Terminal({ fontSize: 13, rows: 10, cursorBlink: true, scrollback: 1000 });
    term.current = t;
    t.open(host.current!);
    disableTextAssist(t.textarea);
    const touch = attachTouchInput(t);
    scroll.current = fixRef.current ? attachTouchScroll(t, host.current!.parentElement!) : null;
    for (let i = 1; i <= 300; i++) t.write(`line ${String(i).padStart(3, '0')}\r\n`);
    let line = 0;
    t.write('$ ');
    const data = t.onData((d) => {
      setEcho((e) => `${e}${esc(d)} `);
      if (d === '\x7f') { if (line > 0) { t.write('\b \b'); line--; } }
      else if (d === '\r') { t.write('\r\n$ '); line = 0; }
      else if (/^[\x20-\x7e]+$/.test(d)) { t.write(d); line += d.length; }
    });
    return () => {
      scroll.current?.dispose();
      scroll.current = null;
      touch.dispose();
      data.dispose();
      t.dispose();
    };
  }, []);

  const toggle = () => {
    if (fix) { scroll.current?.dispose(); scroll.current = null; }
    else scroll.current = attachTouchScroll(term.current!, host.current!.parentElement!);
    setFix(!fix);
  };

  const send = async () => {
    const report = { kind: 'scroll-check', steps: verdicts, note, pageLoads: loads, echo, fix, ua: navigator.userAgent };
    const bridge = (window as { ccArtifact?: { report(data: unknown): Promise<{ ok: boolean; code?: string }> } }).ccArtifact;
    try {
      const r = bridge ? await bridge.report(report) : { ok: false, code: 'NO_BRIDGE' };
      setStatus(r.ok ? 'Sent ✓' : `Not sent: ${r.code}`);
    } catch (e) {
      setStatus(`Not sent: ${(e as Error).message}`);
    }
  };

  return (
    <main>
      <h1>Swipe-scroll device test</h1>
      <div className="step">Page loads: {loads}</div>
      <div className="row">
        <button type="button" onClick={toggle}>Fix: {fix ? 'ON' : 'OFF'}</button>
      </div>
      <div className="hint">Terminal (strip above it is the title bar)</div>
      <div className="strip" style={{ padding: 8, background: '#ddd' }}>title bar</div>
      <div className="term">
        <div ref={host} style={{ height: '100%' }} />
      </div>
      <h2>Echo (bytes sent, in order)</h2>
      <pre>{echo}</pre>
      <h2>Checklist</h2>
      <ol>
        {STEPS.map((s) => (
          <li key={s.id}>
            <b>{s.id}</b> {s.text}
            <div className="row">
              {(['PASS', 'FAIL'] as const).map((v) => (
                <button key={v} type="button" className={verdicts[s.id] === v ? 'on' : ''}
                  onClick={() => setVerdicts((o) => ({ ...o, [s.id]: v }))}>{v}</button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <textarea className="log" rows={2} placeholder="Notes (zoom yes/no, anything odd)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <button type="button" onClick={() => void send()}>Send results</button>
        <span>{status}</span>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);
