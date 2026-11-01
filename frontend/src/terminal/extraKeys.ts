// The extra-keys bar's catalog, the bytes each key sends, and the Ctrl/Alt modifier
// state machine. Pure: no React, no DOM.

export type ExtraKeyId = 'esc' | 'tab' | 'ctrl' | 'alt' | 'tilde' | 'pipe' | 'slash' | 'dash' | 'left' | 'up' | 'down' | 'right';
export type ExtraKey = { id: ExtraKeyId; label: string; name: string; kind: 'mod' | 'key' };

export const EXTRA_KEYS: readonly ExtraKey[] = [
  { id: 'esc', label: 'Esc', name: 'Escape', kind: 'key' },
  { id: 'tab', label: 'Tab', name: 'Tab', kind: 'key' },
  { id: 'ctrl', label: 'Ctrl', name: 'Control', kind: 'mod' },
  { id: 'alt', label: 'Alt', name: 'Alt', kind: 'mod' },
  { id: 'tilde', label: '~', name: 'Tilde', kind: 'key' },
  { id: 'pipe', label: '|', name: 'Pipe', kind: 'key' },
  { id: 'slash', label: '/', name: 'Slash', kind: 'key' },
  { id: 'dash', label: '-', name: 'Dash', kind: 'key' },
  { id: 'left', label: '←', name: 'Left arrow', kind: 'key' },
  { id: 'up', label: '↑', name: 'Up arrow', kind: 'key' },
  { id: 'down', label: '↓', name: 'Down arrow', kind: 'key' },
  { id: 'right', label: '→', name: 'Right arrow', kind: 'key' },
];

const LITERAL: Partial<Record<ExtraKeyId, string>> = { esc: '\x1b', tab: '\t', tilde: '~', pipe: '|', slash: '/', dash: '-' };
const ARROW: Partial<Record<ExtraKeyId, string>> = { up: 'A', down: 'B', right: 'C', left: 'D' };

// The bytes a key sends; arrows follow the terminal's application-cursor mode (DECCKM).
export function keySequence(id: ExtraKeyId, appCursor: boolean): string {
  const arrow = ARROW[id];
  if (arrow) return `${appCursor ? '\x1bO' : '\x1b['}${arrow}`;
  const lit = LITERAL[id];
  if (lit === undefined) throw new Error(`no byte sequence for key ${id}`);
  return lit;
}

export type ModifierFlags = { ctrl: boolean; alt: boolean };

const ARROW_SEQ = /^\x1b[[O]([ABCD])$/;

function ctrlChar(ch: string): string {
  if (ch === ' ') return '\x00';
  if (ch === '?') return '\x7f';
  if (/^[a-zA-Z@[\\\]^_]$/.test(ch)) return String.fromCharCode(ch.charCodeAt(0) & 0x1f);
  return ch;
}

// Applies Ctrl/Alt to one keystroke's data. null: the data is not a keystroke (a terminal
// report such as a DSR reply, mouse report, focus event or bracketed paste, or empty data) and must pass
// through unmodified.
export function applyModifiers(data: string, { ctrl, alt }: ModifierFlags): string | null {
  if (data === '') return null;
  const arrow = ARROW_SEQ.exec(data);
  if (arrow) {
    if (!ctrl && !alt) return data;
    return `\x1b[1;${1 + (alt ? 2 : 0) + (ctrl ? 4 : 0)}${arrow[1]}`;
  }
  if (data.startsWith('\x1b') && data !== '\x1b') return null;
  const first = String.fromCodePoint(data.codePointAt(0)!);
  const rest = data.slice(first.length);
  return `${alt ? '\x1b' : ''}${ctrl ? ctrlChar(first) : first}${rest}`;
}

export const DOUBLE_TAP_MS = 300;

export type ModState = 'off' | 'once' | 'locked';
export type ModSnapshot = { ctrl: ModState; alt: ModState };
export type ModName = 'ctrl' | 'alt';

export class Modifiers {
  private snapshot: ModSnapshot = { ctrl: 'off', alt: 'off' };
  private lastTap: Record<ModName, number> = { ctrl: -Infinity, alt: -Infinity };
  private listeners = new Set<() => void>();

  constructor(private now: () => number = () => performance.now()) {}

  get = (): ModSnapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  tap(mod: ModName): void {
    const t = this.now();
    const cur = this.snapshot[mod];
    const next: ModState = cur === 'off' ? 'once' : cur === 'once' && t - this.lastTap[mod] < DOUBLE_TAP_MS ? 'locked' : 'off';
    this.lastTap[mod] = t;
    this.set({ ...this.snapshot, [mod]: next });
  }

  apply(data: string): string {
    const { ctrl, alt } = this.snapshot;
    if (ctrl === 'off' && alt === 'off') return data;
    const out = applyModifiers(data, { ctrl: ctrl !== 'off', alt: alt !== 'off' });
    if (out === null) return data;
    this.set({ ctrl: ctrl === 'once' ? 'off' : ctrl, alt: alt === 'once' ? 'off' : alt });
    return out;
  }

  private set(next: ModSnapshot): void {
    this.snapshot = next;
    for (const fn of [...this.listeners]) fn();
  }
}
