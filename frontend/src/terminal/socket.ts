// The attach socket of one pane (docs/protocol.md → Session I/O). A dropped
// socket reattaches with backoff while the backend still has the session; a
// refused or dropped one whose session is gone means the session ended.
import { listSessions, type SessionState } from '../api';

export type ConnState = SessionState | { kind: 'connecting' } | { kind: 'reconnecting' } | { kind: 'detached' };

export interface ConnHandlers {
  // Sent before the replay: the terminal is reset, then the snapshot arrives as bytes.
  onHello(state: SessionState, title: string): void;
  onBytes(data: Uint8Array): void;
  onState(state: ConnState): void;
}

export interface Connection {
  sendInput(data: string | Uint8Array<ArrayBuffer>): void;
  resize(cols: number, rows: number): void;
  reattach(): void;
  close(): void;
}

// The backend's browser-socket close codes (lib/session.js).
const CLOSE_DETACHED = 4000;
const CLOSE_KILLED = 4001;
const RETRY_MIN_MS = 250;
const RETRY_MAX_MS = 5000;

export function connectSession(id: string, size: () => { cols: number; rows: number }, h: ConnHandlers): Connection {
  let ws: WebSocket | null = null;
  let closed = false;
  let delay = RETRY_MIN_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const encoder = new TextEncoder();

  const stillExists = () => listSessions().then((list) => list.some((s) => s.id === id), () => true);

  function open() {
    const { cols, rows } = size();
    const url = new URL(`api/sessions/${encodeURIComponent(id)}/io?cols=${cols}&rows=${rows}`, location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const s = new WebSocket(url);
    s.binaryType = 'arraybuffer';
    ws = s;
    s.onopen = () => { delay = RETRY_MIN_MS; };
    s.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return h.onBytes(new Uint8Array(ev.data as ArrayBuffer));
      let m: { type?: string; state?: SessionState; title?: string };
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'hello' && m.state) {
        h.onHello(m.state, typeof m.title === 'string' ? m.title : '');
        h.onState(m.state);
      } else if (m.type === 'state' && m.state) {
        h.onState(m.state);
      }
    };
    s.onclose = (ev) => {
      if (ws !== s || closed) return;
      ws = null;
      if (ev.code === CLOSE_DETACHED) return h.onState({ kind: 'detached' });
      if (ev.code === CLOSE_KILLED) return h.onState({ kind: 'ended' });
      h.onState({ kind: 'reconnecting' });
      void stillExists().then((exists) => {
        if (closed) return;
        if (!exists) return h.onState({ kind: 'ended' });
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      });
    };
  }

  h.onState({ kind: 'connecting' });
  open();
  return {
    sendInput(data) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(typeof data === 'string' ? encoder.encode(data) : data);
    },
    resize(cols, rows) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    },
    reattach() {
      if (closed || ws) return;
      h.onState({ kind: 'connecting' });
      open();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
