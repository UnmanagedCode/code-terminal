// Pure formatting and line model for the SwiftKey event-capture page: no DOM or xterm imports.
// Every record is one line; every string is JSON-escaped so the log pastes back losslessly.

export type VariantId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
export type StepId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7';
export type Verdict = 'PASS' | 'TRAIL' | 'FAIL';
export type Answer = 'yes' | 'no' | '?';

export const STEPS: { id: StepId; want: string }[] = [
  { id: 'S1', want: 'ls -all.' },
  { id: 'S2', want: 'ls -all x.' },
  { id: 'S3', want: 'x.' },
  { id: 'S4', want: 'echo hi  there' },
  { id: 'S5', want: 'cd ..' },
  { id: 'S6', want: 'teh cat' },
  // Type abc, Backspace four times (one more than the field holds), then d.
  { id: 'S7', want: 'd' },
];

export const VARIANT_STEPS: Record<VariantId, StepId[]> = {
  A: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
  B: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  C: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  D: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  E: ['S1', 'S4', 'S6'],
  // Autofill diagnostics built like E (see capture.tsx): the same steps.
  F: ['S1', 'S4', 'S6'],
  G: ['S1', 'S4', 'S6'],
  H: ['S1', 'S4', 'S6'],
  I: ['S1', 'S4', 'S6'],
};

const DEL = '\x7f';

// JSON.stringify leaves DEL raw; the log shows it as \u007f so it is visible when pasted.
export const q = (s: string | null): string =>
  s === null ? 'null' : JSON.stringify(s).replace(/\x7f/g, '\\u007f');

// --- line model: what a shell would receive from the bytes xterm sent -------------------------

export interface Line {
  cells: string[];
  ended: boolean; // a CR ended the step; later bytes belong to the next step
}

export const EMPTY_LINE: Line = { cells: [], ended: false };

export function feedLine(line: Line, bytes: string): Line {
  if (line.ended) return line;
  const cells = [...line.cells];
  for (const c of bytes) {
    if (c === '\r') return { cells, ended: true };
    if (c === DEL) {
      cells.pop();
      continue;
    }
    const cp = c.codePointAt(0)!;
    cells.push(cp < 0x20 ? `\\x${cp.toString(16).padStart(2, '0')}` : c);
  }
  return { cells, ended: false };
}

export const lineText = (line: Line): string => line.cells.join('');

export function verdict(got: string, want: string): Verdict {
  if (got === want) return 'PASS';
  const untrailed = (s: string) => s.replace(/ +$/, '');
  return untrailed(got) === untrailed(want) ? 'TRAIL' : 'FAIL';
}

// --- records ------------------------------------------------------------------------------------

// A field's value and selection, read once per record.
export interface Snap {
  v: string;
  s0: number;
  s1: number;
}

const snapText = (s: Snap) => `v=${q(s.v)} s=${s.s0},${s.s1}`;
const at = (ms: number, code: string, ...parts: string[]) => [ms, code, ...parts].join(' ');

// The snapshot after an event is skipped when it repeats the last logged value and selection.
export const isRepeat = (last: Snap | null, now: Snap): boolean =>
  last !== null && last.v === now.v && last.s0 === now.s0 && last.s1 === now.s1;

export const keyLine = (ms: number, kind: 'kd' | 'ku', key: string, code: string, keyCode: number, snap: Snap) =>
  at(ms, kind, q(key), q(code), String(keyCode), snapText(snap));

export const inputLine = (ms: number, kind: 'bi' | 'in', inputType: string, data: string | null, composing: boolean, snap: Snap) =>
  at(ms, kind, q(inputType), q(data), composing ? 'c1' : 'c0', snapText(snap));

export const compLine = (ms: number, kind: 'cs' | 'cu' | 'ce', data: string, snap: Snap) =>
  at(ms, kind, q(data), snapText(snap));

// `xf` (variant A): whether xterm's element has its `focus` class after the event.
export const focusLine = (ms: number, kind: 'fo' | 'bl', snap: Snap, xf?: boolean) =>
  at(ms, kind, snapText(snap), ...(xf === undefined ? [] : [`xf=${xf ? 1 : 0}`]));

export const snapLine = (ms: number, snap: Snap) => at(ms, '~', snapText(snap));

export const txLine = (ms: number, bytes: string) => at(ms, 'tx', q(bytes));

// --- headers and steps --------------------------------------------------------------------------

export const headerCap = (iso: string, userAgent: string) => `#cap v1 ${iso} ${q(userAgent)}`;

export const headerVp = (width: number, height: number, dpr: number, touch: boolean) =>
  `#vp ${width}x${height}@${dpr} touch=${touch ? 1 : 0}`;

// Attribute values are already formatted by the caller; null means the attribute is absent.
export const formatVar = (id: VariantId, kind: 'ta' | 'input', attrs: Record<string, string | null>) =>
  [`#var ${id} ${kind}`, ...Object.entries(attrs).map(([k, v]) => `${k}=${v ?? '-'}`)].join(' ');

export const stepStart = (id: VariantId, step: StepId, want: string) => `@${id}.${step} want=${q(want)}`;

export const stepRedo = (id: VariantId, step: StepId) => `@${id}.${step} redo`;

export const resultLine = (id: VariantId, step: StepId, got: string, want: string) =>
  `=${id}.${step} got=${q(got)} want=${q(want)} ${verdict(got, want)}`;

// The last recorded xterm focus-class flag after a focus and after a blur (variant A logs `xf=`).
export function xfResult(lines: readonly string[]): { focus: boolean | null; blur: boolean | null } {
  const out: { focus: boolean | null; blur: boolean | null } = { focus: null, blur: null };
  for (const line of lines) {
    const m = /^\d+ (fo|bl) .* xf=([01])$/.exec(line);
    if (m) out[m[1] === 'fo' ? 'focus' : 'blur'] = m[2] === '1';
  }
  return out;
}

const flag = (v: boolean | null) => (v === null ? '?' : v ? '1' : '0');
export const xfLine = (r: { focus: boolean | null; blur: boolean | null }) => `!A xf focus=${flag(r.focus)} blur=${flag(r.blur)}`;

export const obsLine = (id: VariantId, strip: Answer, caps: Answer, fill: Answer = '?') =>
  `!${id} strip=${strip} caps=${caps} fill=${fill}`;

// Done steps per variant: distinct steps with a `=` result line, so a redo is counted once.
const RESULT = /^=([A-I])\.(S[1-7]) /;
export function tally(lines: readonly string[]): Record<VariantId, number> {
  const done = new Map<VariantId, Set<StepId>>();
  for (const line of lines) {
    const m = RESULT.exec(line);
    if (!m) continue;
    const variant = m[1] as VariantId;
    if (!done.has(variant)) done.set(variant, new Set());
    done.get(variant)!.add(m[2] as StepId);
  }
  return Object.fromEntries(
    (Object.keys(VARIANT_STEPS) as VariantId[]).map((v) => [v, done.get(v)?.size ?? 0]),
  ) as Record<VariantId, number>;
}

// --- parsing a log back into steps ----------------------------------------------------------------

type Pos = { v: string; s0: number; s1: number };
export type LogEvent = { ms: number } & (
  | ({ kind: 'kd' | 'ku'; key: string; code: string; keyCode: number } & Pos)
  | ({ kind: 'bi' | 'in'; inputType: string; data: string | null; composing: boolean } & Pos)
  | ({ kind: 'cs' | 'cu' | 'ce'; data: string } & Pos)
  | ({ kind: 'fo' | 'bl'; xf?: boolean } & Pos)
  | ({ kind: '~' } & Pos)
  | { kind: 'tx'; bytes: string }
);

export interface LogStep {
  variant: VariantId;
  id: StepId;
  want: string;
  redo: boolean;
  events: LogEvent[];
  got?: string;
  verdict?: Verdict;
}

const TOKEN = /(?:v=)?"(?:[^"\\]|\\.)*"|\S+/g;
const START = /^@([A-I])\.(S[1-7]) (?:want=(".*")|redo)$/;
const RESULT_LINE = /^=([A-I])\.(S[1-7]) got=(".*") want=(".*") (PASS|TRAIL|FAIL)$/;

function parseEvent(line: string): LogEvent {
  const tokens = line.match(TOKEN) ?? [];
  const [msText, kind, ...rest] = tokens;
  const ms = Number(msText);
  const str = (t: string) => JSON.parse(t) as string;
  // Trailing `v="…" s=a,b` (and `xf=`) are read from the end; the rest are positional.
  let xf: boolean | undefined;
  if (rest.at(-1)?.startsWith('xf=')) xf = rest.pop() === 'xf=1';
  const readPos = (): Pos => {
    const s = /^s=(\d+),(\d+)$/.exec(rest.pop() ?? '');
    const v = rest.pop() ?? '';
    if (!s || !v.startsWith('v=')) throw new Error(`malformed capture line: ${line}`);
    return { v: str(v.slice(2)), s0: Number(s[1]), s1: Number(s[2]) };
  };
  switch (kind) {
    case 'tx': return { ms, kind, bytes: str(rest[0]) };
    case 'kd': case 'ku': {
      const pos = readPos();
      return { ms, kind, key: str(rest[0]), code: str(rest[1]), keyCode: Number(rest[2]), ...pos };
    }
    case 'bi': case 'in': {
      const pos = readPos();
      return { ms, kind, inputType: str(rest[0]), data: rest[1] === 'null' ? null : str(rest[1]), composing: rest[2] === 'c1', ...pos };
    }
    case 'cs': case 'cu': case 'ce': {
      const pos = readPos();
      return { ms, kind, data: str(rest[0]), ...pos };
    }
    case 'fo': case 'bl': return { ms, kind, ...readPos(), ...(xf === undefined ? {} : { xf }) };
    case '~': return { ms, kind, ...readPos() };
    default: throw new Error(`unknown capture record: ${line}`);
  }
}

// Groups a log into steps: events between an `@` line and the next one belong to that step.
// Header, observation and blank lines carry no events and are skipped.
export function parseCaptureLog(text: string): LogStep[] {
  const steps: LogStep[] = [];
  let cur: LogStep | undefined;
  for (const line of text.split('\n')) {
    if (line === '' || line[0] === '#' || line[0] === '!') continue;
    if (line[0] === '@') {
      const m = START.exec(line);
      if (!m) throw new Error(`malformed step line: ${line}`);
      cur = { variant: m[1] as VariantId, id: m[2] as StepId, want: m[3] ? (JSON.parse(m[3]) as string) : '', redo: !m[3], events: [] };
      steps.push(cur);
    } else if (line[0] === '=') {
      const m = RESULT_LINE.exec(line);
      if (!m || !cur) throw new Error(`malformed result line: ${line}`);
      cur.got = JSON.parse(m[3]) as string;
      cur.verdict = m[5] as Verdict;
    } else {
      cur?.events.push(parseEvent(line));
    }
  }
  return steps;
}

// --- the report sent from the page ---------------------------------------------------------------

// Mirrors MAX_REPORT_BYTES in code-artifact's assets/relay.js: the UTF-8 size of the report JSON.
export const REPORT_LIMIT_BYTES = 32768;

export interface Report {
  kind: 'swiftkey-capture';
  v: 1;
  lines: string[];
}

const FOCUS_LINE = /^\d+ (?:fo|bl) /;

const utf8Size = (r: Report) => new TextEncoder().encode(JSON.stringify(r)).length;

// Headers, step starts, verdicts and observations always go; event lines only for steps that
// failed or never ended. Over the limit, the oldest events of the failed step with the most
// events left are dropped first, and the step's `@` line is followed by a marker saying how many.
export function buildReport(lines: readonly string[], limit = REPORT_LIMIT_BYTES): Report {
  type Group = { start: number; events: string[]; trimmed: number; failed: boolean };
  const groups: Group[] = [];
  const kept: (string | Group)[] = [];
  let cur: Group | undefined;
  for (const line of lines) {
    const c = line[0];
    if (c === '@') {
      cur = { start: kept.length, events: [], trimmed: 0, failed: true };
      groups.push(cur);
      kept.push(line, cur);
    } else if (c === '=') {
      if (cur && !line.endsWith(' FAIL')) cur.failed = false;
      kept.push(line);
    } else if (c === '#' || c === '!' || FOCUS_LINE.test(line)) {
      kept.push(line); // focus and blur lines carry the xterm focus result: kept for every step
    } else if (cur) {
      cur.events.push(line);
    }
  }
  const render = (): Report => ({
    kind: 'swiftkey-capture',
    v: 1,
    lines: kept.flatMap((k) => {
      if (typeof k === 'string') return [k];
      if (!k.failed) return [];
      return [...(k.trimmed ? [`… ${k.trimmed} earlier events trimmed`] : []), ...k.events];
    }),
  });
  const failed = groups.filter((g) => g.failed);
  const full = failed.map((g) => g.events);
  for (const g of failed) g.events = [];
  if (utf8Size(render()) > limit) throw new Error(`capture report over the ${limit}-byte limit without any event lines`);
  failed.forEach((g, i) => { g.events = full[i]; });
  while (utf8Size(render()) > limit) {
    const g = failed.reduce((a, b) => (b.events.length > a.events.length ? b : a));
    if (g.events.length === 0) throw new Error(`capture report over the ${limit}-byte limit`);
    g.events.shift();
    g.trimmed++;
  }
  return render();
}
