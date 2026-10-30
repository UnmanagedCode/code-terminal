import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestRefusal } from '../lib/requestGuard.js';
import { startFakeCc, projectRow } from './fakeCc.mjs';
import { CC_HOST, CC_ORIGIN, api, attach, startPlugin, upgrade, until } from './helpers.mjs';

const LISTEN = 4123;
const allowed = (headers, opts = { requireOrigin: true }) => requestRefusal(headers, LISTEN, opts) === null;

test('an upgrade or mutation without an Origin is refused', () => {
  assert.equal(allowed({ host: CC_HOST }), false);
});

test('an Origin of null, a cross-host Origin, or one with a path or userinfo is refused', () => {
  for (const origin of ['null', 'http://evil.test:3999', 'http://cc.test:4000', `${CC_ORIGIN}/`, `${CC_ORIGIN}/x`, 'http://u:p@cc.test:3999', 'ftp://cc.test:3999', 'not a url']) {
    assert.equal(allowed({ host: CC_HOST, origin }), false, origin);
  }
});

test('a Host with userinfo, a path or a query is refused', () => {
  for (const host of ['u@cc.test:3999', 'cc.test:3999/x', 'cc.test:3999?q', '']) {
    assert.equal(allowed({ host, origin: CC_ORIGIN }), false, host);
  }
  assert.equal(allowed({ origin: CC_ORIGIN }), false, 'no Host');
});

test("a Host naming the backend's own listen port is refused (direct dial, DNS rebinding)", () => {
  assert.equal(allowed({ host: `127.0.0.1:${LISTEN}`, origin: `http://127.0.0.1:${LISTEN}` }), false);
  assert.equal(allowed({ host: `evil.test:${LISTEN}`, origin: `http://evil.test:${LISTEN}` }), false);
  // A GET carries no Origin, and the port rule still applies.
  assert.equal(allowed({ host: `evil.test:${LISTEN}` }, { requireOrigin: false }), false);
});

test('the default port counts as the listen port when the backend listens on it', () => {
  assert.equal(requestRefusal({ host: 'evil.test', origin: 'http://evil.test' }, 80, { requireOrigin: true }) === null, false);
  assert.equal(requestRefusal({ host: 'pub', origin: 'https://pub' }, 443, { requireOrigin: true }) === null, false);
});

test('code-hub (https Origin, bare public Host) and a cc http Origin are accepted', () => {
  assert.equal(allowed({ host: 'pub', origin: 'https://pub' }), true);
  assert.equal(allowed({ host: 'PUB:443', origin: 'https://pub' }), true);
  assert.equal(allowed({ host: CC_HOST, origin: CC_ORIGIN }), true);
  assert.equal(allowed({ host: '[::1]:3999', origin: 'http://[::1]:3999' }), true);
  assert.equal(allowed({ host: 'cc.test:80', origin: 'http://cc.test' }), true);
});

test('a GET without Origin passes when its Host is not the listen port; a mismatched Origin on it does not', () => {
  assert.equal(allowed({ host: CC_HOST }, { requireOrigin: false }), true);
  assert.equal(allowed({ host: CC_HOST, origin: 'http://evil.test' }, { requireOrigin: false }), false);
});

test('a refused upgrade gets 403 and never reaches the session; an accepted one attaches', async () => {
  const fake = await startFakeCc({ projects: [projectRow('alpha')] });
  const plugin = await startPlugin({ fake, shellLaunch: { specFor: async () => ({ project: 'alpha', cols: 80, rows: 24 }) } });
  try {
    const created = await api(plugin.port, 'POST', '/api/sessions', { project: 'alpha', worktree: null, cols: 80, rows: 24 });
    assert.equal(created.status, 201);
    const term = fake.terminals[0];
    const io = `/api/sessions/${created.json.id}/io?cols=100&rows=30`;
    const refused = [
      { host: CC_HOST },
      { host: CC_HOST, origin: 'null' },
      { host: CC_HOST, origin: 'http://evil.test:3999' },
      { host: CC_HOST, origin: `${CC_ORIGIN}/path` },
      { host: CC_HOST, origin: 'http://u:p@cc.test:3999' },
      { host: `127.0.0.1:${plugin.port}`, origin: `http://127.0.0.1:${plugin.port}` },
      { host: `evil.test:${plugin.port}`, origin: `http://evil.test:${plugin.port}` },
    ];
    for (const headers of refused) {
      assert.equal((await upgrade(plugin.port, io, headers)).status, 403, JSON.stringify(headers));
    }
    assert.deepEqual(term.control, [], 'no refused attach resized the terminal');
    assert.equal(fake.opens.length, 1, 'no refused upgrade opened a terminal');

    for (const headers of [{ host: 'pub', origin: 'https://pub' }, { host: CC_HOST, origin: CC_ORIGIN }]) {
      const c = await attach(plugin.port, created.json.id, { cols: 100, rows: 30, headers });
      assert.equal(c.status, 101, JSON.stringify(headers));
      c.ws.close();
    }
    await until(() => term.control.length > 0, 2000, 'the accepted attach to resize');
  } finally {
    await plugin.close();
    await fake.close();
  }
});
