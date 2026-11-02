// Pure formatting and line model for the SwiftKey event-capture page: no DOM or xterm imports.
// Every record is one line; every string is JSON-escaped so the log pastes back losslessly.

export type VariantId = 'A' | 'B' | 'C' | 'D' | 'E';
export type StepId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
export type Verdict = 'PASS' | 'TRAIL' | 'FAIL';
export type Answer = 'yes' | 'no' | '?';

export const STEPS: { id: StepId; want: string }[] = [
  { id: 'S1', want: 'ls -all.' },
  { id: 'S2', want: 'ls -all x.' },
  { id: 'S3', want: 'x.' },
  { id: 'S4', want: 'echo hi  there' },
  { id: 'S5', want: 'cd ..' },
  { id: 'S6', want: 'teh cat' },
];

export const VARIANT_STEPS: Record<VariantId, StepId[]> = {
  A: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  B: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  C: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  D: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  E: ['S1', 'S4', 'S6'],
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

export const focusLine = (ms: number, kind: 'fo' | 'bl', snap: Snap) => at(ms, kind, snapText(snap));

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

export const obsLine = (id: VariantId, strip: Answer, caps: Answer) => `!${id} strip=${strip} caps=${caps}`;

// Done steps per variant: distinct steps with a `=` result line, so a redo is counted once.
const RESULT = /^=([A-E])\.(S[1-6]) /;
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
