import { describe, expect, it } from 'vitest';
import {
  EMPTY_LINE,
  STEPS,
  VARIANT_STEPS,
  feedLine,
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
  stepStart,
  tally,
  txLine,
  verdict,
  buildReport,
  xfLine,
  xfResult,
  sinceLastCapture,
  parseCaptureLog,
  REPORT_LIMIT_BYTES,
  txLine as tx,
  compLine,
  focusLine,
  type Snap,
} from './captureLog';
import FIXTURE from '../../frontend/src/terminal/fixtures/swiftkey-capture-log.txt?raw';

// The n-th quoted string on a line, decoded: every string the page writes must survive JSON.parse.
const quoted = (line: string, n = 0) => JSON.parse(line.match(/"(?:[^"\\]|\\.)*"/g)![n]) as string;

describe('line model (what the shell would see)', () => {
  it('appends printable text in order', () => {
    expect(lineText(feedLine(EMPTY_LINE, 'ls -all.'))).toBe('ls -all.');
  });

  it('removes one character per DEL', () => {
    const l = feedLine(EMPTY_LINE, 'abc\x7f\x7f');
    expect(lineText(l)).toBe('a');
  });

  it('ignores a DEL on an empty line', () => {
    expect(lineText(feedLine(EMPTY_LINE, '\x7f\x7f'))).toBe('');
  });

  it('ends the step at CR and ignores the bytes after it', () => {
    const l = feedLine(EMPTY_LINE, 'ls\rxyz');
    expect(l.ended).toBe(true);
    expect(lineText(l)).toBe('ls');
  });

  it('keeps other control bytes as their escape and lets DEL remove the whole escape', () => {
    const withCtrl = feedLine(EMPTY_LINE, 'a\x03');
    expect(lineText(withCtrl)).toBe('a\\x03');
    expect(lineText(feedLine(withCtrl, '\x7f'))).toBe('a');
  });

  it('keeps a whole code point together for DEL', () => {
    expect(lineText(feedLine(EMPTY_LINE, '😀\x7f'))).toBe('');
  });
});

describe('verdict against the step want', () => {
  it('is PASS on an exact match', () => {
    expect(verdict('ls -all.', 'ls -all.')).toBe('PASS');
  });

  it('is TRAIL when the line differs only by trailing spaces', () => {
    expect(verdict('ls -all. ', 'ls -all.')).toBe('TRAIL');
    expect(verdict('echo hi  there  ', 'echo hi  there')).toBe('TRAIL');
  });

  it('is FAIL on any other difference, including a changed double space', () => {
    expect(verdict('ls all..', 'ls -all.')).toBe('FAIL');
    expect(verdict('echo hi there', 'echo hi  there')).toBe('FAIL');
  });
});

describe('record lines', () => {
  const snap: Snap = { v: 'xl', s0: 2, s1: 2 };

  it('writes a key event with key, code, keyCode, the pre-edit value and selection', () => {
    expect(keyLine(812, 'kd', 'Unidentified', '', 229, { v: 'x', s0: 1, s1: 1 }))
      .toBe('812 kd "Unidentified" "" 229 v="x" s=1,1');
  });

  it('writes an input event with inputType, data, composition flag and value', () => {
    expect(inputLine(813, 'in', 'insertText', 'l', false, snap)).toBe('813 in "insertText" "l" c0 v="xl" s=2,2');
    expect(inputLine(814, 'bi', 'deleteContentBackward', null, true, snap)).toBe('814 bi "deleteContentBackward" null c1 v="xl" s=2,2');
  });

  it('writes composition, focus and blur events', () => {
    expect(compLine(900, 'cu', 'ko', snap)).toBe('900 cu "ko" v="xl" s=2,2');
    expect(focusLine(0, 'fo', { v: 'x', s0: 1, s1: 1 })).toBe('0 fo v="x" s=1,1');
    expect(focusLine(5, 'bl', snap)).toBe('5 bl v="xl" s=2,2');
  });

  it('writes settled snapshots and transmitted bytes, escaped', () => {
    expect(snapLine(820, snap)).toBe('820 ~ v="xl" s=2,2');
    expect(txLine(815, '\x7f')).toBe('815 tx "\\u007f"');
    expect(txLine(816, '\r')).toBe('816 tx "\\r"');
  });

  it('writes step start, redo, result and observation lines', () => {
    expect(stepStart('A', 'S4', 'echo hi  there')).toBe('@A.S4 want="echo hi  there"');
    expect(resultLine('A', 'S1', 'ls all..', 'ls -all.')).toBe('=A.S1 got="ls all.." want="ls -all." FAIL');
    expect(obsLine('A', 'yes', 'no', 'no', 'no')).toBe('!A strip=yes caps=no fill=no save=no');
    expect(obsLine('F', 'no', 'no')).toBe('!F strip=no caps=no fill=? save=?');
  });

  it('writes headers, with the user agent and the attributes read back from the element', () => {
    expect(headerCap('2026-11-02T10:00:00Z', 'Mozilla "x"')).toBe('#cap v1 2026-11-02T10:00:00Z "Mozilla \\"x\\""');
    expect(headerVp(393, 851, 2.75, true)).toBe('#vp 393x851@2.75 touch=1');
    expect(formatVar('A', 'ta', { autocomplete: 'off', inputmode: null, placeholder: '"x"' }))
      .toBe('#var A ta autocomplete=off inputmode=- placeholder="x"');
  });

  it('round-trips escaped strings through JSON.parse, DEL included', () => {
    for (const s of ['\x7f', '\r', 'a "quoted" b', 'tab\there', '😀', 'x\x03\r']) {
      expect(quoted(txLine(1, s))).toBe(s);
      expect(quoted(compLine(1, 'ce', s, snap))).toBe(s);
      expect(quoted(inputLine(1, 'in', 'insertText', s, false, snap), 1)).toBe(s);
    }
    expect(quoted(inputLine(1, 'bi', 'deleteContentBackward', null, false, snap), 0)).toBe('deleteContentBackward');
    expect(txLine(1, '\x7f')).not.toContain('\x7f');
  });
});

describe('repeat suppression for snapshots', () => {
  it('treats the same value and selection as a repeat, and a changed one as new', () => {
    const a: Snap = { v: 'x', s0: 1, s1: 1 };
    expect(isRepeat(a, { ...a })).toBe(true);
    expect(isRepeat(a, { ...a, s0: 0 })).toBe(false);
    expect(isRepeat(null, a)).toBe(false);
  });
});

describe('step table and tally', () => {
  it('pins the double-space probe as the S4 want', () => {
    expect(STEPS.find((s) => s.id === 'S4')!.want).toBe('echo hi  there');
  });

  it('runs S1, S4 and S6 only for variant E', () => {
    expect(VARIANT_STEPS.E).toEqual(['S1', 'S4', 'S6']);
    expect(VARIANT_STEPS.A).toHaveLength(10);
    expect(VARIANT_STEPS.B).toHaveLength(6);
  });

  it('adds S7 for the shipped variant only: type past the start of the line, then d', () => {
    expect(STEPS.find((s) => s.id === 'S7')!.want).toBe('d');
    expect(VARIANT_STEPS.A.at(-1)).toBe('S10');
    expect(VARIANT_STEPS.J).toEqual(VARIANT_STEPS.A.slice(0, 8));
    expect(STEPS.find((s) => s.id === 'S8')!.want).toBe('a');
    expect(tally(['=A.S7 got="d" want="d" PASS']).A).toBe(1);
  });

  it('writes the xterm focus-class flag on focus and blur lines when given', () => {
    expect(focusLine(7, 'fo', { v: '', s0: 0, s1: 0 }, true)).toBe('7 fo v="" s=0,0 xf=1');
    expect(focusLine(8, 'bl', { v: '', s0: 0, s1: 0 }, false)).toBe('8 bl v="" s=0,0 xf=0');
  });

  it('counts distinct steps with a result per variant, ignoring other lines', () => {
    const lines = [
      '=A.S1 got="x" want="x" PASS',
      '=A.S1 got="x" want="x" PASS',
      '=A.S2 got="x" want="x" FAIL',
      '=B.S1 got="x" want="x" PASS',
      '@A.S3 want="x"',
      '!A strip=yes caps=no',
    ];
    const t = tally(lines);
    expect(t.A).toBe(2);
    expect(t.B).toBe(1);
    expect(t.C).toBe(0);
  });
});

const FIXTURE_LINES = FIXTURE.split('\n');

describe('parseCaptureLog', () => {
  const snap: Snap = { v: 'xl', s0: 2, s1: 2 };

  it('round-trips every record the formatter writes', () => {
    const text = [
      stepStart('A', 'S1', 'ls'),
      focusLine(1, 'fo', snap, true),
      keyLine(2, 'kd', 'Unidentified', '', 229, snap),
      inputLine(3, 'bi', 'insertText', 'l"\x7f', false, snap),
      inputLine(4, 'in', 'deleteContentBackward', null, true, snap),
      compLine(5, 'cu', 'ko', snap),
      snapLine(6, snap),
      txLine(7, '\x7f\r'),
      resultLine('A', 'S1', 'ls', 'ls'),
    ].join('\n');
    const [step] = parseCaptureLog(text);
    expect(step).toMatchObject({ variant: 'A', id: 'S1', want: 'ls', verdict: 'PASS' });
    expect(step.events).toEqual([
      { ms: 1, kind: 'fo', v: 'xl', s0: 2, s1: 2, xf: true },
      { ms: 2, kind: 'kd', key: 'Unidentified', code: '', keyCode: 229, v: 'xl', s0: 2, s1: 2 },
      { ms: 3, kind: 'bi', inputType: 'insertText', data: 'l"\x7f', composing: false, v: 'xl', s0: 2, s1: 2 },
      { ms: 4, kind: 'in', inputType: 'deleteContentBackward', data: null, composing: true, v: 'xl', s0: 2, s1: 2 },
      { ms: 5, kind: 'cu', data: 'ko', v: 'xl', s0: 2, s1: 2 },
      { ms: 6, kind: '~', v: 'xl', s0: 2, s1: 2 },
      { ms: 7, kind: 'tx', bytes: '\x7f\r' },
    ]);
  });

  it('groups the committed device log into its steps with their logged verdicts', () => {
    const steps = parseCaptureLog(FIXTURE);
    const ended = steps.filter((s) => s.verdict);
    expect(ended).toHaveLength(27);
    const e1 = steps.find((s) => s.variant === 'E' && s.id === 'S1')!;
    expect(e1.want).toBe('ls -all.');
    expect(e1.verdict).toBe('PASS');
    expect(e1.events.at(-1)).toMatchObject({ kind: 'kd', key: 'Enter', keyCode: 13 });
  });

  it('keeps a step that never ended, without a verdict', () => {
    const [step] = parseCaptureLog('@A.S1 want="ls"\n5 ~ v="" s=0,0');
    expect(step.verdict).toBeUndefined();
    expect(step.events).toHaveLength(1);
  });
});

describe('buildReport', () => {
  const step = (v: string, id: string, verdictWord: string, n: number) => [
    `@${v}.${id} want="x"`,
    ...Array.from({ length: n }, (_, i) => tx(i, `e${v}${id}-${i}`)),
    `=${v}.${id} got="x" want="x" ${verdictWord}`,
  ];
  const size = (r: unknown) => new TextEncoder().encode(JSON.stringify(r)).length;

  it('keeps every # @ = ! line and the events of FAIL steps only, in order (focus lines aside)', () => {
    const lines = ['#cap v1', ...step('A', 'S1', 'PASS', 2), ...step('A', 'S2', 'FAIL', 3), ...step('A', 'S3', 'TRAIL', 2), '!A strip=no caps=no'];
    const r = buildReport(lines);
    expect(r.kind).toBe('swiftkey-capture');
    expect(r.v).toBe(1);
    expect(r.lines.filter((l) => /^[#@=!]/.test(l))).toHaveLength(1 + 3 * 2 + 1);
    expect(r.lines.filter((l) => l.includes('eA'))).toEqual([0, 1, 2].map((i) => tx(i, `eAS2-${i}`)));
  });

  it('keeps the events of a step that never ended', () => {
    const r = buildReport(['@A.S1 want="x"', tx(1, 'a')]);
    expect(r.lines).toContain(tx(1, 'a'));
  });

  it('trims the oldest events of the failed step with most events to fit, and states how many', () => {
    const lines = [...step('A', 'S1', 'FAIL', 300), ...step('B', 'S1', 'FAIL', 20)];
    const limit = 4000;
    expect(size({ kind: 'swiftkey-capture', v: 1, lines })).toBeGreaterThan(limit);
    const r = buildReport(lines, limit);
    expect(size(r)).toBeLessThanOrEqual(limit);
    const a = r.lines.filter((l) => l.includes('eAS1-'));
    expect(a.at(-1)).toContain('eAS1-299');
    expect(r.lines.filter((l) => l.includes('eBS1-'))).toHaveLength(20);
    const dropped = 300 - a.length;
    expect(dropped).toBeGreaterThan(0);
    const at = r.lines.indexOf('@A.S1 want="x"');
    expect(r.lines[at + 1]).toBe(`… ${dropped} earlier events trimmed`);
    // what survives is the newest contiguous tail
    expect(a[0]).toContain(`eAS1-${dropped}"`);
  });

  it('throws when the kept lines alone exceed the limit', () => {
    expect(() => buildReport(step('A', 'S1', 'FAIL', 1), 50)).toThrow(/limit/);
  });

  it('fits the committed device log under the report limit with all 27 verdicts', () => {
    const r = buildReport(FIXTURE_LINES);
    expect(size(r)).toBeLessThanOrEqual(REPORT_LIMIT_BYTES);
    expect(REPORT_LIMIT_BYTES).toBe(32768);
    expect(r.lines.filter((l) => l.startsWith('='))).toHaveLength(27);
  });
});

describe('focus result lines', () => {
  it('keeps focus and blur lines of PASS steps in the report, so the xterm focus check always arrives', () => {
    const lines = ['@A.S1 want="x"', focusLine(1, 'fo', { v: '', s0: 0, s1: 0 }, true), txLine(2, 'x'), focusLine(3, 'bl', { v: '', s0: 0, s1: 0 }, false), '=A.S1 got="x" want="x" PASS'];
    const r = buildReport(lines);
    expect(r.lines).toContain(lines[1]);
    expect(r.lines).toContain(lines[3]);
    expect(r.lines).not.toContain(lines[2]);
  });

  it('reads the last recorded xf values of one variant, with null for one never recorded', () => {
    const snap = { v: '', s0: 0, s1: 0 };
    expect(xfResult([], 'A')).toEqual({ focus: null, blur: null });
    const lines = [
      '#var A input type=text', focusLine(1, 'fo', snap, false), focusLine(2, 'fo', snap, true), focusLine(3, 'bl', snap, true), focusLine(4, 'bl', snap, false), focusLine(5, 'fo', snap),
      '#var J input type=text', focusLine(6, 'fo', snap, true),
      '#var A input type=text',
    ];
    expect(xfResult(lines, 'A')).toEqual({ focus: true, blur: false });
    expect(xfResult(lines, 'J')).toEqual({ focus: true, blur: null });
    expect(xfResult(lines.slice(0, 2), 'A')).toEqual({ focus: false, blur: null });
  });

  it('writes the per-variant summary line, with ? for a missing value', () => {
    expect(xfLine('A', { focus: true, blur: false })).toBe('!A xf focus=1 blur=0');
    expect(xfLine('J', { focus: null, blur: null })).toBe('!J xf focus=? blur=?');
  });

  it('takes only the lines since the last capture header, so an earlier run cannot answer for this one', () => {
    const snap = { v: '', s0: 0, s1: 0 };
    const old = ['#cap v1 a', '#var A input', focusLine(1, 'bl', snap, true)];
    const now = ['#cap v1 b', '#var A input', focusLine(2, 'fo', snap, true)];
    expect(sinceLastCapture([...old, ...now])).toEqual(now);
    expect(xfResult(sinceLastCapture([...old, ...now]), 'A')).toEqual({ focus: true, blur: null });
    expect(sinceLastCapture(['x'])).toEqual(['x']);
  });
});

describe('parsing a trimmed report', () => {
  it('skips the trim marker lines', () => {
    const [step] = parseCaptureLog('@A.S7 want="d"\n… 5 earlier events trimmed\n5 ku "Unidentified" "" 229 v="a" s=1,1');
    expect(step.events).toHaveLength(1);
  });
});

describe('bare Backspace variant K and the no-op key steps', () => {
  it('runs S1 to S10 on A and K', () => {
    expect(VARIANT_STEPS.K).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']);
    expect(VARIANT_STEPS.A).toEqual(VARIANT_STEPS.K);
  });

  it('S9 expects abc untouched and S10 an empty line', () => {
    expect(STEPS.find((s) => s.id === 'S9')!.want).toBe('abc');
    expect(STEPS.find((s) => s.id === 'S10')!.want).toBe('');
  });

  it('counts, formats and parses two-digit steps and the empty want', () => {
    expect(tally(['=K.S10 got="" want="" PASS']).K).toBe(1);
    const [step] = parseCaptureLog('@K.S10 want=""\n=K.S10 got="" want="" PASS');
    expect(step).toMatchObject({ variant: 'K', id: 'S10', want: '', verdict: 'PASS' });
    expect(resultLine('K', 'S10', '', '')).toBe('=K.S10 got="" want="" PASS');
  });
});

describe('autofill diagnostic variants', () => {
  it('runs F to I like E: S1, S4 and S6 only', () => {
    for (const v of ['F', 'G', 'H', 'I'] as const) expect(VARIANT_STEPS[v]).toEqual(['S1', 'S4', 'S6']);
  });

  it('counts and parses their steps', () => {
    expect(tally(['=G.S1 got="x" want="x" PASS']).G).toBe(1);
    const [step] = parseCaptureLog('@I.S4 want="echo"\n=I.S4 got="echo" want="echo" PASS');
    expect(step).toMatchObject({ variant: 'I', id: 'S4', verdict: 'PASS' });
  });

  it('keeps every variant answer line in the report', () => {
    const r = buildReport([obsLine('A', 'no', 'no', 'no'), obsLine('F', 'no', 'no', 'yes')]);
    expect(r.lines).toEqual(['!A strip=no caps=no fill=no save=?', '!F strip=no caps=no fill=yes save=?']);
  });
});

describe('empty-field diagnostic variant J', () => {
  it('runs S1 to S8, the shipped variant\'s steps up to S8', () => {
    expect(VARIANT_STEPS.J).toEqual(VARIANT_STEPS.A.slice(0, 8));
  });
});
