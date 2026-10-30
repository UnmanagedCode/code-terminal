// One terminal: the upstream socket to cc, a headless xterm mirror that holds
// its screen and bounded scrollback, and at most one attached browser client
// (docs/protocol.md → Session I/O; docs/architecture.md → Session lifecycle).
import xtermHeadless from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';

export const SCROLLBACK_LINES = 5000;
// Output handed to the browser socket and not yet written; past it the upstream is paused.
export const CLIENT_HIGH_WATER_BYTES = 256 * 1024;
// Output written to the mirror and not yet parsed; past it the upstream is paused.
const MIRROR_HIGH_WATER_BYTES = 1024 * 1024;
// cc's TERMINAL_WS_MAX_MESSAGE_BYTES (src/hostTerminal.ts): cc closes 1009 past it.
export const UPSTREAM_MAX_MESSAGE_BYTES = 64 * 1024;
// Input handed to the upstream and not yet written; past it browser input is paused.
const UPSTREAM_HIGH_WATER_BYTES = 256 * 1024;
// cc's PTY_DIM_MAX (src/systems/protocol.ts): a resize outside 1..PTY_DIM_MAX makes cc kill the program.
export const PTY_DIM_MAX = 4096;
const SNAPSHOT_CHUNK_BYTES = 64 * 1024;
const TITLE_MAX_CHARS = 256;

// Browser socket close codes (docs/protocol.md → Session I/O).
export const CLOSE_DETACHED = 4000;
export const CLOSE_KILLED = 4001;

export const isDim = (v) => Number.isInteger(v) && v >= 1 && v <= PTY_DIM_MAX;

function parseResize(buf) {
  let m;
  try { m = JSON.parse(buf.toString('utf8')); } catch { return null; }
  if (typeof m !== 'object' || m === null || Array.isArray(m) || m.type !== 'resize') return null;
  if (Object.keys(m).some((k) => k !== 'type' && k !== 'cols' && k !== 'rows')) return null;
  return isDim(m.cols) && isDim(m.rows) ? { cols: m.cols, rows: m.rows } : null;
}

const toBuffer = (data) => (Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data));

export class Session {
  #upstream;
  #mirror;
  #serializer;
  #log;
  #client = null;
  // Live output held while the attached client waits for its snapshot; null when live.
  #held = null;
  #clientOutstanding = 0;
  #mirrorOutstanding = 0;
  #upstreamOutstanding = 0;
  #upstreamPaused = false;
  #killed = false;

  constructor({ id, project, worktree, upstream, cols, rows, log }) {
    this.id = id;
    this.project = project;
    this.worktree = worktree;
    this.state = { kind: 'running' };
    this.title = '';
    this.#log = log;
    this.#upstream = upstream;
    this.#mirror = new xtermHeadless.Terminal({ cols, rows, scrollback: SCROLLBACK_LINES, allowProposedApi: true });
    this.#serializer = new serializeAddon.SerializeAddon();
    this.#mirror.loadAddon(this.#serializer);
    // The mirror's onData (its answers to terminal queries) is never read: only
    // the attached browser answers, so the program gets one reply, not two.
    this.#mirror.onTitleChange((t) => { this.title = t.slice(0, TITLE_MAX_CHARS); });
    upstream.on('message', (data, isBinary) => {
      if (this.#killed) return;
      if (isBinary) this.#output(toBuffer(data));
      else this.#control(toBuffer(data));
    });
    upstream.on('close', () => { if (this.state.kind === 'running') this.#setState({ kind: 'ended' }); });
    upstream.on('error', (e) => this.#log.warn(`session ${id}: upstream error: ${e.message}`));
  }

  get info() {
    return { id: this.id, project: this.project, worktree: this.worktree, state: this.state, title: this.title };
  }

  attach(client, { cols, rows }) {
    const previous = this.#client;
    if (previous) {
      this.#detach();
      previous.send(JSON.stringify({ type: 'detached' }));
      previous.close(CLOSE_DETACHED, 'attached elsewhere');
    }
    this.#client = client;
    this.#clientOutstanding = 0;
    client.on('message', (data, isBinary) => {
      if (this.#client !== client) return;
      if (isBinary) this.#input(toBuffer(data));
      else this.#browserControl(toBuffer(data));
    });
    client.on('close', () => { if (this.#client === client) this.#detach(); });
    client.on('error', (e) => this.#log.warn(`session ${this.id}: client error: ${e.message}`));
    if (isDim(cols) && isDim(rows)) this.#resize(cols, rows);
    // The snapshot is taken once the mirror has parsed everything written before
    // this point; output arriving meanwhile is held and sent after it.
    this.#held = [];
    this.#mirror.write('', () => {
      if (this.#client !== client) return;
      client.send(JSON.stringify({ type: 'hello', state: this.state, title: this.title, scrollback: SCROLLBACK_LINES }));
      const snapshot = Buffer.from(this.#serializer.serialize(), 'utf8');
      for (let at = 0; at < snapshot.length; at += SNAPSHOT_CHUNK_BYTES) {
        this.#toClient(snapshot.subarray(at, at + SNAPSHOT_CHUNK_BYTES));
      }
      const held = this.#held;
      this.#held = null;
      for (const b of held) this.#toClient(b);
    });
  }

  kill() {
    if (this.#killed) return;
    this.#killed = true;
    const client = this.#client;
    this.#detach();
    client?.close(CLOSE_KILLED, 'session closed');
    this.#upstream.close();
    this.#mirror.dispose();
  }

  #detach() {
    this.#client = null;
    this.#held = null;
    this.#clientOutstanding = 0;
    this.#upstreamOutstanding = 0;
    this.#updateUpstreamPause();
  }

  #output(buf) {
    this.#mirrorOutstanding += buf.length;
    this.#mirror.write(buf, () => {
      this.#mirrorOutstanding -= buf.length;
      this.#updateUpstreamPause();
    });
    if (this.#held) this.#held.push(buf);
    else if (this.#client) this.#toClient(buf);
    this.#updateUpstreamPause();
  }

  #toClient(buf) {
    const client = this.#client;
    this.#clientOutstanding += buf.length;
    client.send(buf, { binary: true }, () => {
      if (this.#client !== client) return;
      this.#clientOutstanding -= buf.length;
      this.#updateUpstreamPause();
    });
  }

  // Paused while the client or the mirror is behind; resumed only once both have caught up.
  #updateUpstreamPause() {
    const behind = this.#clientOutstanding >= CLIENT_HIGH_WATER_BYTES || this.#mirrorOutstanding >= MIRROR_HIGH_WATER_BYTES;
    const caughtUp = this.#clientOutstanding === 0 && this.#mirrorOutstanding < MIRROR_HIGH_WATER_BYTES;
    if (!this.#upstreamPaused && behind) {
      this.#upstreamPaused = true;
      this.#upstream.pause();
    } else if (this.#upstreamPaused && caughtUp) {
      this.#upstreamPaused = false;
      this.#upstream.resume();
    }
  }

  #control(buf) {
    let m;
    try { m = JSON.parse(buf.toString('utf8')); } catch { m = null; }
    if (m?.type === 'exit') this.#setState({ kind: 'exited', code: m.code ?? null, signal: m.signal ?? null });
    else if (m?.type === 'failed') this.#setState({ kind: 'failed', code: m.code ?? null, error: String(m.error ?? '') });
    else this.#log.warn(`session ${this.id}: unexpected text from cc: ${buf.toString('utf8').slice(0, 200)}`);
  }

  #setState(state) {
    this.state = state;
    this.#client?.send(JSON.stringify({ type: 'state', state }));
    this.#client?.resume();
  }

  #input(buf) {
    if (this.state.kind !== 'running') return;
    const client = this.#client;
    for (let at = 0; at < buf.length; at += UPSTREAM_MAX_MESSAGE_BYTES) {
      const chunk = buf.subarray(at, at + UPSTREAM_MAX_MESSAGE_BYTES);
      this.#upstreamOutstanding += chunk.length;
      this.#upstream.send(chunk, { binary: true }, () => {
        if (this.#client !== client) return;
        this.#upstreamOutstanding -= chunk.length;
        if (this.#upstreamOutstanding === 0) client.resume();
      });
    }
    if (this.#upstreamOutstanding >= UPSTREAM_HIGH_WATER_BYTES) client.pause();
  }

  #browserControl(buf) {
    const r = parseResize(buf);
    if (!r) {
      this.#log.warn(`session ${this.id}: dropped a browser text message that is not a valid resize`);
      return;
    }
    this.#resize(r.cols, r.rows);
  }

  #resize(cols, rows) {
    this.#mirror.resize(cols, rows);
    if (this.state.kind === 'running') this.#upstream.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}
