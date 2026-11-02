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
  compLine,
  focusLine,
  type Snap,
} from './captureLog';

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
    expect(obsLine('A', 'yes', 'no')).toBe('!A strip=yes caps=no');
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
    expect(VARIANT_STEPS.A).toHaveLength(6);
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
