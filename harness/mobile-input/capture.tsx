// SwiftKey event-capture page: one variant at a time (the shipped touch input, an xterm helper
// textarea with different attributes, or a plain input). It logs every keyboard and input event
// on the field, the bytes xterm sends, and the field after each event settles, then checks fixed
// typing steps against what the shell would receive. The log goes back through "Send results"
// (a report to the session that published the page) or is copied by hand. Spec: see captureLog.ts.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { AUTOFILL_OPT_OUT, disableTextAssist, optOutOfAutofill } from '@/terminal/softKeyboard';
import { attachTouchInput, type TouchInput } from '@/terminal/touchInput';
import { TOUCH_QUERY } from '@/terminal/useTouchDevice';
import {
  EMPTY_LINE,
  buildReport,
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
  resultLine,
  snapLine,
  stepRedo,
  stepStart,
  tally,
  sinceLastCapture,
  xfLine,
  xfResult,
  txLine,
  type Answer,
  type Line,
  type Report,
  type Snap,
  type VariantId,
} from './captureLog';
import './page.css';

const VARIANT_IDS = Object.keys(VARIANT_STEPS) as VariantId[];
const STORAGE_KEY = 'capture-log';
const ATTRIBUTES = ['autocomplete', 'autocorrect', 'autocapitalize', 'spellcheck', ...Object.keys(AUTOFILL_OPT_OUT)];

interface Setup {
  question: string;
  kind: 'xterm' | 'input';
  // The shipped setup: typing goes through `attachTouchInput`, and the logged field is its proxy.
  touchInput?: boolean;
  // Diagnostic: the touch input keeps its field empty after every committed edit.
  emptyField?: boolean;
  // Diagnostic: a bare 229 keydown/keyup pair is treated as a Backspace.
  bareBackspace?: boolean;
  inputmode?: string;
  // How a plain input (kind `input`) is treated beyond E's create-as-password-then-text:
  // `optout` the shipped attribute set, `nope` an unrecognized autocomplete token, `late` the
  // switch to text happens on first focus, `replaced` the element is swapped for a clone after the switch.
  treat?: 'optout' | 'nope' | 'late' | 'replaced';
}

const SETUP: Record<VariantId, Setup> = {
  A: { kind: 'xterm', touchInput: true, question: 'Shipped: touch input, a hidden input built like E. Expect no suggestion strip and no capitals.' },
  J: { kind: 'xterm', touchInput: true, emptyField: true, question: 'Diagnostic: the shipped touch input, but its field is kept empty after every edit. Do all steps pass, S7 and S8 included?' },
  K: { kind: 'xterm', touchInput: true, bareBackspace: true, question: 'Diagnostic: the shipped touch input, plus a bare Backspace key pair sends a DEL. Do S7, S8, S9 and S10 all pass?' },
  B: { kind: 'xterm', question: 'Diagnostic: xterm textarea with the text-assist attributes only.' },
  C: { kind: 'xterm', inputmode: 'email', question: 'Attributes plus inputmode=email. Do suggestions, autospace and caps stop?' },
  D: { kind: 'xterm', inputmode: 'url', question: 'Attributes plus inputmode=url. The same question for the URL type.' },
  E: { kind: 'input', question: 'Plain input, created as a password field, then switched to text. Does the suggestion strip hide?' },
  F: { kind: 'input', treat: 'optout', question: 'Like E plus the shipped autofill opt-out attributes. Is a Bitwarden/autofill suggestion shown? Is the strip still hidden?' },
  G: { kind: 'input', treat: 'nope', question: 'Like E with autocomplete="nope" (an unrecognized token). Bitwarden/autofill suggestion? Strip?' },
  H: { kind: 'input', treat: 'late', question: 'Like E, but stays a password field until it is first focused. Bitwarden/autofill suggestion? Strip?' },
  I: { kind: 'input', treat: 'replaced', question: 'Like E, then replaced by a clone (never a password field). Bitwarden/autofill suggestion? Strip? (Expected: suggestion gone but the strip back.)' },
};

type Obs = { strip: Answer; caps: Answer; fill: Answer; save: Answer };
const UNANSWERED: Obs = { strip: '?', caps: '?', fill: '?', save: '?' };

interface View {
  step: number;
  done: boolean;
  text: string;
  xf?: boolean; // variant A: xterm's element has its `focus` class
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
  // Variants run since this page loaded (the log may hold older runs): A is always required.
  const ranRef = useRef(new Set<VariantId>(['A']));
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const sessionRef = useRef<{ redo: () => void; blur: () => void } | null>(null);
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
    ranRef.current.add(variant);
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
    let touch: TouchInput | undefined;
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
      if (setup.touchInput) {
        touch = attachTouchInput(term, undefined, { emptyField: setup.emptyField, bareBackspace: setup.bareBackspace });
        field = host.querySelector<HTMLInputElement>('.xterm-touch-input')!;
      } else field = ta;
    } else {
      let input = document.createElement('input');
      input.type = 'password';
      host.append(input);
      if (setup.treat === 'late') {
        input.addEventListener('focus', () => { input.type = 'text'; }, { once: true });
      } else input.type = 'text';
      disableTextAssist(input);
      if (setup.treat === 'optout') optOutOfAutofill(input);
      if (setup.treat === 'nope') input.setAttribute('autocomplete', 'nope');
      if (setup.treat === 'replaced') {
        const copy = input.cloneNode() as HTMLInputElement;
        input.replaceWith(copy);
        input = copy;
      }
      field = input;
    }

    const attrs: Record<string, string | null> = {};
    if (setup.kind === 'input' || setup.touchInput) attrs.type = field.getAttribute('type');
    for (const n of [...ATTRIBUTES, 'inputmode']) attrs[n] = field.getAttribute(n);
    append(formatVar(variant, setup.kind === 'input' || setup.touchInput ? 'input' : 'ta', attrs));

    const ms = () => Math.round(performance.now() - t0);
    const snap = (): Snap => ({ v: field.value, s0: field.selectionStart ?? 0, s1: field.selectionEnd ?? 0 });
    const record = (text: string, s: Snap) => { last = s; append(text); };
    // xterm's `focus` class follows the synthetic focus/blur the touch input relays to its disabled textarea.
    const xtermFocused = () => term!.element!.classList.contains('focus');
    const sync = () => setView({
      step,
      done,
      text: setup.kind === 'xterm' ? lineText(line) : field.value,
      xf: setup.touchInput ? xtermFocused() : undefined,
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
        append(obsLine(variant, o.strip, o.caps, o.fill, o.save));
        sync();
        return;
      }
      step++;
      begin();
      sync();
    };

    // The settled snapshot runs after xterm's own 0 ms timers: the first timer is queued here,
    // before theirs, and the nested one after them.
    const settle = () => {
      setTimeout(() => setTimeout(() => {
        if (!alive) return;
        const s = snap();
        if (!isRepeat(last, s)) record(snapLine(ms(), s), s);
        sync();
      }, 0), 0);
    };

    // Capture phase on window: runs before xterm's and the touch input's own listeners.
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
    // The class flips in the field's own listeners, after this capture listener: read it in a timeout.
    const focusRecord = (kind: 'fo' | 'bl') => {
      const s = snap();
      const t = ms();
      if (!setup.touchInput) { record(focusLine(t, kind, s), s); return; }
      // After the field's own listeners (the relay to xterm) have run, however the event was dispatched.
      setTimeout(() => { if (alive) { record(focusLine(t, kind, s, xtermFocused()), s); sync(); } }, 0);
    };
    on('focus', () => focusRecord('fo'));
    on('blur', () => { focusRecord('bl'); settle(); });

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
      touch?.clear();
      sync();
    };
    sessionRef.current = { redo, blur: () => field.blur() };

    begin();
    sync();

    return () => {
      alive = false;
      sessionRef.current = null;
      off.forEach((f) => f());
      dataSub?.dispose();
      touch?.dispose();
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

  // What must be answered before the report is worth sending: the strip, caps and autofill toggles
  // of every variant run since the page loaded (A always), and A's two xterm focus results
  // (focus the box, then tap Blur field).
  const missingForReport = (): string[] => {
    const out: string[] = [];
    // The shipped variant always, and every other variant that has been run.
    for (const v of VARIANT_IDS.filter((id) => ranRef.current.has(id))) {
      const o = obsRef.current[v] ?? UNANSWERED;
      for (const [k, label] of [['strip', 'suggestion strip'], ['caps', 'capitals'], ['fill', 'autofill/Bitwarden'], ['save', 'save-password offer']] as const) {
        if (o[k] === '?') out.push(`${v}: ${label} answer`);
      }
    }
    // Each run touch-input variant needs its own focus and blur result from this page load.
    const page = sinceLastCapture(linesRef.current);
    for (const v of VARIANT_IDS.filter((id) => ranRef.current.has(id) && SETUP[id].touchInput)) {
      const xf = xfResult(page, v);
      if (xf.focus === null) out.push(`${v}: a focus (tap the box)`);
      if (xf.blur === null) out.push(`${v}: a blur (tap Blur field)`);
    }
    return out;
  };

  const sendResults = async () => {
    // The answers are logged here, not only at the last step, so they are never stale or missing.
    for (const v of VARIANT_IDS.filter((id) => ranRef.current.has(id))) {
      const o = obsRef.current[v] ?? UNANSWERED;
      append(obsLine(v, o.strip, o.caps, o.fill, o.save));
      if (SETUP[v].touchInput) append(xfLine(v, xfResult(sinceLastCapture(linesRef.current), v)));
    }
    setSending(true);
    let result: { ok: boolean; code?: string };
    try {
      const report: Report = buildReport(linesRef.current);
      const bridge = (window as { ccArtifact?: { report(data: unknown): Promise<{ ok: boolean; code?: string }> } }).ccArtifact;
      result = bridge ? await bridge.report(report) : { ok: false, code: 'NO_BRIDGE' };
    } catch (e) {
      result = { ok: false, code: (e as Error).message };
    }
    setSending(false);
    if (result.ok) { setNote('Sent ✓'); return; }
    const hint = result.code === 'NO_BRIDGE' ? ': open this page from cc\'s artifact link, or use Copy log'
      : result.code === 'RATE_LIMITED' ? ': wait a minute' : '';
    setNote(`Not sent: ${result.code}${hint}`);
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
  // Read from the refs on every render; `lines` and `obs` are the state that triggers it.
  const missing = missingForReport();
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
      {SETUP[variant].touchInput && !touch && (
        <div role="alert" className="warn">Not a touch device ({TOUCH_QUERY} did not match). This page is for phones.</div>
      )}
      <div className="hint">
        Tap the black box to focus, then type.
        {SETUP[variant].touchInput && ' The terminal cursor must be solid while focused and hollow after Blur field; the line below says what xterm believes.'}
      </div>
      <div className="term" ref={hostRef} />
      <div className="step">
        {view.done ? (
          <strong>All steps done. Redo step re-runs {current}.</strong>
        ) : (
          current === 'S7' ? (
            <>Type <code>abc</code>, press Backspace 4 times (one too many), type <code>d</code>, then Enter.</>
          ) : current === 'S9' ? (
            <>Type <code>abc</code>, then tap shift, tap ?123 and back, open and close the emoji panel, and swipe the spacebar. Then Enter. Nothing should be deleted: expect <code>abc</code>.</>
          ) : current === 'S10' ? (
            <>Type <code>abcdef</code>, hold Backspace until the field is visibly empty, then Enter. Expect an empty line.</>
          ) : current === 'S8' ? (
            <>Type <code>abc</code>, then leave the screen untouched for about 5 seconds, press Backspace twice, then Enter. Expect <code>a</code>.</>
          ) : (
            <>Type <code>{stepWant(current)}</code> then press Enter.</>
          )
        )}
        <div className="hint">Tap keys only: no swipe, no suggestions, no voice.</div>
      </div>
      <div className="shell">
        {SETUP[variant].kind === 'xterm' ? 'Shell would see' : 'Field would send'}: <code>{view.text}</code>
      </div>
      {SETUP[variant].touchInput && (
        <div className="row">
          <span>Cursor: <strong>{view.xf ? 'solid (focused)' : 'hollow (blurred)'}</strong> · xterm focus class: {view.xf ? 'yes' : 'no'}</span>
          <button type="button" tabIndex={-1} onPointerDown={keep} onClick={() => sessionRef.current?.blur()}>Blur field</button>
        </div>
      )}
      <div className="row">
        <button type="button" tabIndex={-1} onPointerDown={keep} onClick={() => sessionRef.current?.redo()}>Redo step</button>
        <span className="tally">{VARIANT_IDS.map((v) => `${v} ${counts[v]}/${VARIANT_STEPS[v].length}`).join(' · ')}</span>
      </div>
      <fieldset className="obs">
        <legend>Answer after the first step</legend>
        {(['strip', 'caps', 'fill', 'save'] as const).map((key) => (
          <div key={key} className="row">
            <span>{key === 'strip' ? 'Suggestion strip shown?' : key === 'caps' ? 'First letter capitalized?' : key === 'fill' ? 'Bitwarden / autofill suggestion shown?' : 'Save-password offer shown?'}</span>
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
        <button type="button" tabIndex={-1} onPointerDown={keep} disabled={sending || missing.length > 0} onClick={() => void sendResults()}>Send results</button>
        <button type="button" tabIndex={-1} onPointerDown={keep} onClick={clearLog}>Clear log</button>
        <span role="status">{note}</span>
        {missing.length > 0 && <span className="warn">Send results needs: {missing.join(', ')}</span>}
      </div>
      <textarea ref={boxRef} className="log" readOnly rows={3} aria-label="Capture log" value={lines.join('\n')} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);
