// SwiftKey event-capture page: one variant at a time (an xterm helper textarea with different
// attributes, or a plain input). It logs every keyboard and input event on the field, the bytes
// xterm sends, and the field after each event settles, then checks fixed typing steps against
// what the shell would receive. The log is copied back by hand. Spec: see captureLog.ts.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { attachCapsPlaceholder, PLACEHOLDER } from '@/terminal/capsPlaceholder';
import { disableTextAssist } from '@/terminal/softKeyboard';
import { TOUCH_QUERY } from '@/terminal/useTouchDevice';
import {
  EMPTY_LINE,
  STEPS,
  VARIANT_STEPS,
  compLine,
  feedLine,
  focusLine,
  formatVar,
  headerCap,
  headerVp,
  inputLine,
  isRepeat,
  keyLine,
  lineText,
  obsLine,
  q,
  resultLine,
  snapLine,
  stepRedo,
  stepStart,
  tally,
  txLine,
  type Answer,
  type Line,
  type Snap,
  type VariantId,
} from './captureLog';
import './page.css';

const VARIANT_IDS = Object.keys(VARIANT_STEPS) as VariantId[];
const STORAGE_KEY = 'capture-log';
const ATTRIBUTES = ['autocomplete', 'autocorrect', 'autocapitalize', 'spellcheck'];

interface Setup {
  question: string;
  kind: 'xterm' | 'input';
  placeholder?: boolean;
  inputmode?: string;
}

const SETUP: Record<VariantId, Setup> = {
  A: { kind: 'xterm', placeholder: true, question: 'As shipped: text-assist attributes plus the caps placeholder.' },
  B: { kind: 'xterm', question: 'Text-assist attributes only, no placeholder. Is the placeholder involved?' },
  C: { kind: 'xterm', inputmode: 'email', question: 'Attributes plus inputmode=email. Do suggestions, autospace and caps stop?' },
  D: { kind: 'xterm', inputmode: 'url', question: 'Attributes plus inputmode=url. The same question for the URL type.' },
  E: { kind: 'input', question: 'Plain input, created as a password field, then switched to text. Does the suggestion strip hide?' },
};

type Obs = { strip: Answer; caps: Answer };
const UNANSWERED: Obs = { strip: '?', caps: '?' };

interface View {
  step: number;
  done: boolean;
  text: string;
}

const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const isVariant = (s: string | null): s is VariantId => s !== null && Object.hasOwn(SETUP, s);
const initialVariant = (): VariantId => {
  const v = new URLSearchParams(location.search).get('v');
  return isVariant(v) ? v : 'A';
};
const loadLog = (): string[] => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
const stepWant = (id: string) => STEPS.find((s) => s.id === id)!.want;

function Page() {
  const [variant, setVariant] = useState<VariantId>(initialVariant);
  const [run, setRun] = useState(0);
  const [lines, setLines] = useState<string[]>(loadLog);
  const linesRef = useRef(lines);
  const [view, setView] = useState<View>({ step: 0, done: false, text: '' });
  const [obs, setObs] = useState<Partial<Record<VariantId, Obs>>>({});
  const obsRef = useRef(obs);
  const [note, setNote] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const sessionRef = useRef<{ redo: () => void } | null>(null);
  const touch = matchMedia(TOUCH_QUERY).matches;

  const append = (line: string) => {
    linesRef.current = [...linesRef.current, line];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(linesRef.current));
    setLines(linesRef.current);
  };

  const writeHeaders = () => {
    append(headerCap(isoNow(), navigator.userAgent));
    append(headerVp(innerWidth, innerHeight, devicePixelRatio, touch));
  };

  // Once per page load: the header lines. The variant effect below runs after it, so `#var` follows.
  useEffect(writeHeaders, []);

  // One session per variant: it builds the field, owns the listeners, and runs the steps.
  useEffect(() => {
    const setup = SETUP[variant];
    const steps = VARIANT_STEPS[variant];
    const host = hostRef.current!;
    host.replaceChildren();

    let alive = true;
    let t0 = performance.now();
    let line: Line = EMPTY_LINE;
    let step = 0;
    let done = false;
    let last: Snap | null = null;
    let term: Terminal | undefined;
    let detach = () => {};
    let dataSub: { dispose(): void } | undefined;
    const off: (() => void)[] = [];

    // Built before first focus: Chrome copies the attributes into Android's EditorInfo on focus.
    let field: HTMLTextAreaElement | HTMLInputElement;
    if (setup.kind === 'xterm') {
      term = new Terminal({ fontSize: 13, rows: 6, cursorBlink: true });
      term.open(host);
      const ta = term.textarea!;
      disableTextAssist(ta);
      if (setup.inputmode) ta.setAttribute('inputmode', setup.inputmode);
      if (setup.placeholder) detach = attachCapsPlaceholder(term);
      field = ta;
    } else {
      const input = document.createElement('input');
      input.type = 'password';
      host.append(input);
      input.type = 'text';
      // disableTextAssist only calls setAttribute, so an input element serves as the textarea.
      disableTextAssist(input as unknown as HTMLTextAreaElement);
      field = input;
    }

    const attrs: Record<string, string | null> = {};
    if (setup.kind === 'input') attrs.type = field.getAttribute('type');
    for (const n of [...ATTRIBUTES, 'inputmode']) attrs[n] = field.getAttribute(n);
    if (setup.kind === 'xterm') attrs.placeholder = setup.placeholder ? q(PLACEHOLDER) : null;
    append(formatVar(variant, setup.kind === 'xterm' ? 'ta' : 'input', attrs));

    const ms = () => Math.round(performance.now() - t0);
    const snap = (): Snap => ({ v: field.value, s0: field.selectionStart ?? 0, s1: field.selectionEnd ?? 0 });
    const record = (text: string, s: Snap) => { last = s; append(text); };
    const sync = () => setView({
      step,
      done,
      text: setup.kind === 'xterm' ? lineText(line) : field.value,
    });

    const begin = () => {
      t0 = performance.now();
      line = EMPTY_LINE;
      append(stepStart(variant, steps[step], stepWant(steps[step])));
    };

    const endStep = (got: string) => {
      const id = steps[step];
      append(resultLine(variant, id, got, stepWant(id)));
      if (step === steps.length - 1) {
        done = true;
        const o = obsRef.current[variant] ?? UNANSWERED;
        append(obsLine(variant, o.strip, o.caps));
        sync();
        return;
      }
      step++;
      begin();
      sync();
    };

    // The settled snapshot runs after xterm's own 0 ms timers and the placeholder's: the first
    // timer is queued here, before theirs, and the nested one after them.
    const settle = () => {
      setTimeout(() => setTimeout(() => {
        if (!alive) return;
        const s = snap();
        if (!isRepeat(last, s)) record(snapLine(ms(), s), s);
        sync();
      }, 0), 0);
    };

    // Capture phase on window: runs before xterm's and the placeholder's own listeners.
    const on = (type: string, fn: (e: Event) => void) => {
      const h = (e: Event) => { if (alive && e.target === field) fn(e); };
      window.addEventListener(type, h, true);
      off.push(() => window.removeEventListener(type, h, true));
    };
    on('keydown', (e) => {
      const k = e as KeyboardEvent;
      const s = snap();
      record(keyLine(ms(), 'kd', k.key, k.code, k.keyCode, s), s);
      if (setup.kind === 'input' && k.key === 'Enter') {
        const got = field.value;
        field.value = '';
        endStep(got);
      }
    });
    on('keyup', (e) => {
      const k = e as KeyboardEvent;
      const s = snap();
      record(keyLine(ms(), 'ku', k.key, k.code, k.keyCode, s), s);
      settle();
    });
    on('beforeinput', (e) => {
      const i = e as InputEvent;
      const s = snap();
      record(inputLine(ms(), 'bi', i.inputType, i.data, i.isComposing, s), s);
    });
    on('input', (e) => {
      const i = e as InputEvent;
      const s = snap();
      record(inputLine(ms(), 'in', i.inputType, i.data, i.isComposing, s), s);
      settle();
    });
    on('compositionstart', (e) => { const s = snap(); record(compLine(ms(), 'cs', (e as CompositionEvent).data, s), s); });
    on('compositionupdate', (e) => { const s = snap(); record(compLine(ms(), 'cu', (e as CompositionEvent).data, s), s); });
    on('compositionend', (e) => { const s = snap(); record(compLine(ms(), 'ce', (e as CompositionEvent).data, s), s); settle(); });
    on('focus', () => { const s = snap(); record(focusLine(ms(), 'fo', s), s); });
    on('blur', () => { const s = snap(); record(focusLine(ms(), 'bl', s), s); settle(); });

    if (term) {
      dataSub = term.onData((d) => {
        append(txLine(ms(), d));
        const was = line.ended;
        line = feedLine(line, d);
        if (!was && line.ended) endStep(lineText(line));
        else sync();
      });
    }

    const redo = () => {
      if (!alive) return;
      append(stepRedo(variant, steps[step]));
      line = EMPTY_LINE;
      t0 = performance.now();
      done = false;
      if (setup.kind === 'input') field.value = '';
      sync();
    };
    sessionRef.current = { redo };

    begin();
    sync();

    return () => {
      alive = false;
      sessionRef.current = null;
      off.forEach((f) => f());
      dataSub?.dispose();
      detach();
      term?.dispose();
      host.replaceChildren();
    };
  }, [variant, run]);

  const switchTo = (v: VariantId) => {
    setView({ step: 0, done: false, text: '' });
    history.replaceState(null, '', `${location.pathname}?v=${v}`);
    setVariant(v);
  };

  const answer = (key: keyof Obs, value: Answer) => {
    const current = obsRef.current[variant] ?? UNANSWERED;
    const next = { ...obsRef.current, [variant]: { ...current, [key]: value } };
    obsRef.current = next;
    setObs(next);
  };

  const clearLog = () => {
    if (!window.confirm('Clear the capture log on this phone?')) return;
    linesRef.current = [];
    setLines([]);
    setNote('');
    writeHeaders();
    // Re-running the variant session writes its `#var` header and restarts at the first step.
    setView({ step: 0, done: false, text: '' });
    setRun((r) => r + 1);
  };

  const copyLog = async () => {
    const count = linesRef.current.length;
    try {
      await navigator.clipboard.writeText(linesRef.current.join('\n'));
      setNote(`Copied ${count} lines`);
      return;
    } catch {
      // Fall through to the selectable box.
    }
    const box = boxRef.current!;
    box.focus();
    box.select();
    setNote(document.execCommand('copy') ? `Copied ${count} lines` : 'Select and copy the box below');
  };

  const steps = VARIANT_STEPS[variant];
  const current = steps[Math.min(view.step, steps.length - 1)];
  const o = obs[variant] ?? UNANSWERED;
  const counts = tally(lines);
  const pressed = (on: boolean) => ({ 'aria-pressed': on, className: on ? 'on' : '' });
  // Every button keeps the soft keyboard up: a prevented pointerdown suppresses the focus change.
  const keep = (e: { preventDefault(): void }) => e.preventDefault();

  return (
    <main>
      <h1>SwiftKey event capture</h1>
      <nav aria-label="Variant">
        {VARIANT_IDS.map((v) => (
          <button key={v} type="button" tabIndex={-1} onPointerDown={keep} onClick={() => switchTo(v)} {...pressed(v === variant)}>
            {v}
          </button>
        ))}
      </nav>
      <div>{SETUP[variant].question}</div>
      {SETUP[variant].placeholder && !touch && (
        <div role="alert" className="warn">Not a touch device ({TOUCH_QUERY} did not match). This page is for phones.</div>
      )}
      <div className="hint">Tap the black box to focus, then type.</div>
      <div className="term" ref={hostRef} />
      <div className="step">
        {view.done ? (
          <strong>All steps done. Redo step re-runs {current}.</strong>
        ) : (
          <>Type <code>{stepWant(current)}</code> then press Enter.</>
        )}
        <div className="hint">Tap keys only: no swipe, no suggestions, no voice.</div>
      </div>
      <div className="shell">
        {SETUP[variant].kind === 'xterm' ? 'Shell would see' : 'Field would send'}: <code>{view.text}</code>
      </div>
      <div className="row">
        <button type="button" tabIndex={-1} onPointerDown={keep} onClick={() => sessionRef.current?.redo()}>Redo step</button>
        <span className="tally">{VARIANT_IDS.map((v) => `${v} ${counts[v]}/${VARIANT_STEPS[v].length}`).join(' · ')}</span>
      </div>
      <fieldset className="obs">
        <legend>Answer after the first step, while the strip still shows</legend>
        {(['strip', 'caps'] as const).map((key) => (
          <div key={key} className="row">
            <span>{key === 'strip' ? 'Suggestion strip shown?' : 'First letter capitalized?'}</span>
            {(['yes', 'no'] as const).map((value) => (
              <button key={value} type="button" tabIndex={-1} onPointerDown={keep} onClick={() => answer(key, value)} {...pressed(o[key] === value)}>
                {value === 'yes' ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
        ))}
      </fieldset>
      <div className="row">
        <button type="button" tabIndex={-1} onPointerDown={keep} onClick={copyLog}>Copy log</button>
        <button type="button" tabIndex={-1} onPointerDown={keep} onClick={clearLog}>Clear log</button>
        <span role="status">{note}</span>
      </div>
      <textarea ref={boxRef} className="log" readOnly rows={3} aria-label="Capture log" value={lines.join('\n')} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);
