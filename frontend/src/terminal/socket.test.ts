import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { connectSession, type ConnState } from './socket';

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(readonly url: URL) { FakeSocket.all.push(this); }
  send() {}
  close() {}
  open() { this.readyState = 1; this.onopen?.(); }
  drop(code: number) { this.readyState = 3; this.onclose?.({ code }); }
}

const ID = '0b7c1f5e-3c1a-4c1e-9d2a-1f2e3d4c5b6a';
let sessions: { id: string }[];
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sessions }), { status: 200, headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  FakeSocket.all = [];
  sessions = [{ id: ID }];
  fetchMock.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function connect() {
  const states: ConnState['kind'][] = [];
  const conn = connectSession(ID, () => ({ cols: 80, rows: 24 }), { onHello() {}, onBytes() {}, onState: (s) => states.push(s.kind) });
  FakeSocket.all[0].open();
  return { conn, states };
}

describe('connectSession', () => {
  test('attaches to the session io URL relative to the page, with the size', () => {
    connect();
    const u = FakeSocket.all[0].url;
    expect(u.pathname.endsWith(`/api/sessions/${ID}/io`)).toBe(true);
    expect(u.searchParams.get('cols')).toBe('80');
    expect(['ws:', 'wss:']).toContain(u.protocol);
  });

  test('close 4000 (attached elsewhere) means detached, with no automatic reattach', async () => {
    const { states } = connect();
    FakeSocket.all[0].drop(4000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toBe('detached');
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('reattach() after a detach attaches again', async () => {
    const { conn, states } = connect();
    FakeSocket.all[0].drop(4000);
    conn.reattach();
    expect(FakeSocket.all).toHaveLength(2);
    expect(states.at(-1)).toBe('connecting');
  });

  test('close 4001 (session killed) means ended, with no automatic reattach', async () => {
    const { states } = connect();
    FakeSocket.all[0].drop(4001);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toBe('ended');
    expect(FakeSocket.all).toHaveLength(1);
  });

  test('a dropped socket whose session still exists reattaches by itself', async () => {
    const { states } = connect();
    FakeSocket.all[0].drop(1006);
    expect(states.at(-1)).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeSocket.all.length).toBeGreaterThanOrEqual(2);
  });

  test('a dropped or refused socket whose session is gone means ended, with no reattach', async () => {
    const { states } = connect();
    sessions = [];
    FakeSocket.all[0].drop(1006);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toBe('ended');
    expect(FakeSocket.all).toHaveLength(1);
  });
});
