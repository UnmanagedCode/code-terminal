import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import xtermHeadless from '@xterm/headless';
import {
  Session, SCROLLBACK_LINES, CLIENT_HIGH_WATER_BYTES, MIRROR_HIGH_WATER_BYTES, UPSTREAM_MAX_MESSAGE_BYTES, CLOSE_DETACHED, CLOSE_KILLED,
} from '../lib/session.js';
import { quietLog, until } from './helpers.mjs';

// A socket double with the `ws` surface Session uses. Send callbacks are held
// until `flush()`, so a test decides when bytes count as written.
class StubSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.pending = [];
    this.paused = false;
    this.closed = null;
    this.autoFlush = true;
  }
  send(data, opts, cb) {
    const binary = typeof opts === 'object' ? opts.binary !== false : true;
    this.sent.push({ data: Buffer.isBuffer(data) ? Buffer.from(data) : data, binary: binary && typeof data !== 'string' });
    if (cb) { if (this.autoFlush) queueMicrotask(cb); else this.pending.push(cb); }
  }
  flush() { for (const cb of this.pending.splice(0)) cb(); }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  close(code) { this.closed = code ?? 1000; this.emit('close', this.closed); }
  terminate() { this.close(1006); }
  binaryOut() { return Buffer.concat(this.sent.filter((s) => s.binary).map((s) => s.data)); }
  textOut() { return this.sent.filter((s) => !s.binary).map((s) => JSON.parse(s.data)); }
}

function newSession({ cols = 40, rows = 10 } = {}) {
  const upstream = new StubSocket();
  const s = new Session({ id: 'id-1', project: 'alpha', worktree: null, upstream, cols, rows, log: quietLog });
  return { s, upstream };
}

const output = (upstream, text) => upstream.emit('message', Buffer.from(text), true);

// Feed what a client received into a fresh terminal, as the browser does.
async function replay(bytes, { cols = 40, rows = 10, scrollback = SCROLLBACK_LINES * 2 } = {}) {
  const t = new xtermHeadless.Terminal({ cols, rows, scrollback, allowProposedApi: true });
  await new Promise((r) => t.write(bytes, r));
  return t;
}
const lineText = (t, buf, i) => buf.getLine(i)?.translateToString(true) ?? '';

async function attached(s, opts = {}) {
  const client = new StubSocket();
  s.attach(client, { cols: 40, rows: 10, ...opts });
  await until(() => client.textOut().some((m) => m.type === 'hello'), 2000, 'hello');
  return client;
}

test('a reattach replays earlier output and restores an alternate-screen app to the alternate screen', async () => {
  const { s, upstream } = newSession();
  output(upstream, 'shell line one\r\nshell line two\r\n');
  output(upstream, '\x1b[?1049h\x1b[Hvim screen\x1b[?2004h');
  const first = await attached(s);
  first.close(1001);
  const second = await attached(s);
  await until(() => second.binaryOut().includes('vim screen'), 2000, 'replay');
  const t = await replay(second.binaryOut());
  assert.equal(t.buffer.active.type, 'alternate');
  assert.match(lineText(t, t.buffer.active, 0), /vim screen/);
  assert.equal(t.modes.bracketedPasteMode, true);
  assert.match(lineText(t, t.buffer.normal, 0), /shell line one/);
  s.kill();
});

test('output that arrives while a client attaches reaches it after the snapshot, in order', async () => {
  const { s, upstream } = newSession();
  output(upstream, 'before\r\n');
  const client = new StubSocket();
  s.attach(client, { cols: 40, rows: 10 });
  output(upstream, 'after\r\n');
  await until(() => client.binaryOut().includes('after'), 2000, 'live output');
  const text = client.binaryOut().toString('utf8');
  assert.ok(text.indexOf('before') < text.indexOf('after'));
  assert.equal(text.split('after').length - 1, 1, 'live bytes are not duplicated into the snapshot');
  s.kill();
});

test('the replayed scrollback stays bounded at SCROLLBACK_LINES', async () => {
  const { s, upstream } = newSession();
  const total = SCROLLBACK_LINES + 500;
  let chunk = '';
  for (let i = 0; i < total; i++) chunk += `line-${i}\r\n`;
  output(upstream, chunk);
  const client = await attached(s);
  await until(() => client.binaryOut().includes(`line-${total - 1}`), 5000, 'replay');
  const t = await replay(client.binaryOut());
  assert.ok(t.buffer.normal.length <= SCROLLBACK_LINES + 10, `${t.buffer.normal.length} lines`);
  assert.ok(!client.binaryOut().includes('line-0\r'), 'the oldest line was dropped');
  s.kill();
});

test('a second attach detaches the first', async () => {
  const { s } = newSession();
  const first = await attached(s);
  const second = await attached(s);
  assert.ok(first.textOut().some((m) => m.type === 'detached'));
  assert.equal(first.closed, CLOSE_DETACHED);
  assert.equal(CLOSE_DETACHED, 4000);
  assert.equal(second.closed, null);
  s.kill();
});

test('input over 64 KiB reaches the upstream in chunks of at most 64 KiB, in order', async () => {
  const { s, upstream } = newSession();
  const client = await attached(s);
  const big = Buffer.alloc(UPSTREAM_MAX_MESSAGE_BYTES * 3 + 123);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  client.emit('message', big, true);
  const chunks = upstream.sent.filter((m) => m.binary);
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((c) => c.data.length <= UPSTREAM_MAX_MESSAGE_BYTES));
  assert.deepEqual(Buffer.concat(chunks.map((c) => c.data)), big);
  s.kill();
});

test('an invalid resize or any other text from the browser is never forwarded upstream', async () => {
  const { s, upstream } = newSession();
  const client = await attached(s);
  const before = upstream.sent.length;
  for (const m of [
    { type: 'resize', cols: 0, rows: 10 }, { type: 'resize', cols: 4097, rows: 10 }, { type: 'resize', cols: 1.5, rows: 10 },
    { type: 'resize', cols: '80', rows: 10 }, { type: 'resize', cols: 80 }, { type: 'kill' }, 'not json',
  ]) {
    client.emit('message', Buffer.from(typeof m === 'string' ? m : JSON.stringify(m)), false);
  }
  assert.equal(upstream.sent.length, before);
  client.emit('message', Buffer.from(JSON.stringify({ type: 'resize', cols: 100, rows: 30 })), false);
  assert.deepEqual(upstream.textOut().at(-1), { type: 'resize', cols: 100, rows: 30 });
  s.kill();
});

test('a slow client pauses the upstream, which resumes once the client drains; nothing is dropped', async () => {
  const { s, upstream } = newSession();
  const client = await attached(s);
  client.autoFlush = false;
  const piece = 'y'.repeat(32 * 1024);
  let sent = 0;
  while (!upstream.paused) {
    output(upstream, piece);
    sent += piece.length;
    assert.ok(sent < CLIENT_HIGH_WATER_BYTES * 4, 'upstream was never paused');
  }
  assert.ok(sent >= CLIENT_HIGH_WATER_BYTES);
  client.flush();
  await until(() => !upstream.paused, 2000, 'resume');
  assert.equal(client.binaryOut().toString('utf8').split('y').length - 1 >= sent, true);
  s.kill();
});

test('a backed-up upstream pauses browser input until it drains', async () => {
  const { s, upstream } = newSession();
  const client = await attached(s);
  upstream.autoFlush = false;
  client.emit('message', Buffer.alloc(CLIENT_HIGH_WATER_BYTES + 1), true);
  assert.equal(client.paused, true);
  upstream.flush();
  await until(() => !client.paused, 2000, 'input resume');
  s.kill();
});

test("the mirror's own query replies never reach the upstream, as binary or text", async () => {
  const { s, upstream } = newSession();
  output(upstream, '\x1b[c\x1b[6n\x1b[>c');
  // The snapshot is taken after the mirror has parsed everything before it, queries included.
  await attached(s, { cols: 40, rows: 10 });
  assert.deepEqual(upstream.sent, [{ data: JSON.stringify({ type: 'resize', cols: 40, rows: 10 }), binary: false }],
    'the upstream got the attach resize and nothing else');
  s.kill();
});

test('a killed session closes its client with 4001', async () => {
  const { s } = newSession();
  const client = await attached(s);
  s.kill();
  assert.equal(client.closed, CLOSE_KILLED);
  assert.equal(CLOSE_KILLED, 4001);
});

test('output the mirror has not parsed yet pauses the upstream past MIRROR_HIGH_WATER_BYTES with no client, and resumes once parsed', async () => {
  const { s, upstream } = newSession();
  const piece = 'z'.repeat(64 * 1024);
  let sent = 0;
  while (!upstream.paused && sent <= MIRROR_HIGH_WATER_BYTES + piece.length) {
    output(upstream, piece);
    sent += piece.length;
  }
  assert.equal(upstream.paused, true, `not paused after ${sent} unparsed bytes`);
  assert.ok(sent >= MIRROR_HIGH_WATER_BYTES);
  await until(() => !upstream.paused, 10000, 'the mirror to catch up');
  s.kill();
});

test('a detached session still reads upstream output into its mirror', async () => {
  const { s, upstream } = newSession();
  const first = await attached(s);
  first.close(1001);
  output(upstream, 'while away\r\n');
  assert.equal(upstream.paused, false);
  const second = await attached(s);
  await until(() => second.binaryOut().includes('while away'), 2000, 'replay');
  s.kill();
});

test('the attached client hears every state change', async () => {
  const { s, upstream } = newSession();
  const client = await attached(s);
  upstream.emit('message', Buffer.from(JSON.stringify({ type: 'exit', code: null, signal: 'SIGHUP' })), false);
  upstream.close(1000);
  assert.deepEqual(client.textOut().at(-1), { type: 'state', state: { kind: 'exited', code: null, signal: 'SIGHUP' } });
});
