import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createCcClient } from '../lib/ccClient.js';
import { Refusal } from '../lib/refusal.js';
import { startFakeCc, projectRow } from './fakeCc.mjs';
import { api, startPlugin, until } from './helpers.mjs';

const SPEC = { project: 'alpha', worktree: null, cols: 80, rows: 24, term: 'xterm-256color', argv: ['bash'], env: { HISTFILE: '/h/alpha' } };
const fixedSpec = { specFor: async () => SPEC };

test('the terminal dial to cc carries no Origin and delivers the spec unchanged', async () => {
  const fake = await startFakeCc();
  try {
    const ws = await createCcClient(fake.url).openTerminal(SPEC);
    assert.equal(fake.opens.length, 1);
    assert.equal(fake.opens[0].headers.origin, undefined);
    assert.deepEqual(fake.opens[0].spec, SPEC);
    ws.close();
  } finally { await fake.close(); }
});

test("a refused open surfaces cc's status, code and error unchanged", async () => {
  const body = { error: "terminal: system 'box' is served by prov, which does not support terminals", code: 'SYSTEM_NO_PTY' };
  const fake = await startFakeCc({ terminal: () => ({ refuse: { status: 501, body } }) });
  try {
    await assert.rejects(createCcClient(fake.url).openTerminal(SPEC), (e) => {
      assert.ok(e instanceof Refusal);
      assert.deepEqual({ status: e.status, code: e.code, error: e.error }, { status: 501, ...body });
      return true;
    });
  } finally { await fake.close(); }
});

test('an unreachable cc is a 502 refusal, not a crash', async () => {
  const fake = await startFakeCc();
  const url = fake.url;
  await fake.close();
  await assert.rejects(createCcClient(url).openTerminal(SPEC), (e) => e instanceof Refusal && e.status === 502);
  await assert.rejects(createCcClient(url).listProjects(), (e) => e instanceof Refusal && e.status === 502);
});

test('a terminal open that never completes is abandoned at the deadline', async () => {
  // A peer that accepts the connection and never answers the handshake.
  const silent = net.createServer(() => {});
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(createCcClient(`http://127.0.0.1:${silent.address().port}`, { openTimeoutMs: 50 }).openTerminal(SPEC),
      (e) => e instanceof Refusal && e.status === 504);
  } finally {
    silent.close();
  }
});

test('an over-large refusal body is capped, not buffered whole', async () => {
  const fake = await startFakeCc({ terminal: () => ({ refuse: { status: 500, body: { error: 'x'.repeat(200 * 1024) } } }) });
  try {
    await assert.rejects(createCcClient(fake.url).openTerminal(SPEC), (e) => e instanceof Refusal && e.status === 500 && e.error.length <= 64 * 1024);
  } finally { await fake.close(); }
});

async function sessionState(port, id) {
  const r = await api(port, 'GET', '/api/sessions');
  return r.json.sessions.find((s) => s.id === id)?.state;
}

async function withSession(fn) {
  const fake = await startFakeCc({ projects: [projectRow('alpha')] });
  const plugin = await startPlugin({ fake, shellLaunch: fixedSpec });
  try {
    const r = await api(plugin.port, 'POST', '/api/sessions', { project: 'alpha', worktree: null, cols: 80, rows: 24 });
    assert.equal(r.status, 201);
    await fn({ id: r.json.id, term: fake.terminals[0], port: plugin.port });
  } finally {
    await plugin.close();
    await fake.close();
  }
}

test('cc closing the terminal without a message (1006, cc exited) makes the session ended', async () => {
  await withSession(async ({ id, term, port }) => {
    term.ws.terminate();
    await until(async () => (await sessionState(port, id))?.kind === 'ended', 2000, 'ended');
  });
});

test('an exit message makes the session exited with its code and signal', async () => {
  await withSession(async ({ id, term, port }) => {
    term.ws.send(JSON.stringify({ type: 'exit', code: 3, signal: null }));
    term.ws.close(1000);
    await until(async () => (await sessionState(port, id))?.kind === 'exited', 2000, 'exited');
    assert.deepEqual(await sessionState(port, id), { kind: 'exited', code: 3, signal: null });
  });
});

test('a failed message makes the session failed with its error', async () => {
  await withSession(async ({ id, term, port }) => {
    term.ws.send(JSON.stringify({ type: 'failed', code: 'ETRANSPORT', error: 'provider died' }));
    term.ws.close(1011);
    await until(async () => (await sessionState(port, id))?.kind === 'failed', 2000, 'failed');
    assert.deepEqual(await sessionState(port, id), { kind: 'failed', code: 'ETRANSPORT', error: 'provider died' });
  });
});
