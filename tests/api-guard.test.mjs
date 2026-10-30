import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startFakeCc, projectRow } from './fakeCc.mjs';
import { CC_HOST, CC_ORIGIN, api, request, startPlugin } from './helpers.mjs';

const fixedSpec = { specFor: async () => ({ project: 'alpha', worktree: null, cols: 80, rows: 24 }) };
const TREE = { kind: 'pane', id: 'p1', sessionId: null, worktree: null };

async function withPlugin(fn) {
  const fake = await startFakeCc({ projects: [projectRow('alpha')] });
  const plugin = await startPlugin({ fake, shellLaunch: fixedSpec });
  try { await fn({ fake, plugin }); } finally {
    await plugin.close();
    await fake.close();
  }
}

// Each a cross-site or non-JSON form of a state-changing request.
function hostileVariants(port) {
  return [
    { headers: { host: CC_HOST, 'content-type': 'application/json' }, why: 'no Origin' },
    { headers: { host: CC_HOST, origin: 'http://evil.test', 'content-type': 'application/json' }, why: 'cross-origin' },
    { headers: { host: CC_HOST, origin: 'null', 'content-type': 'application/json' }, why: 'null Origin' },
    { headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, why: 'direct dial' },
    { headers: { host: CC_HOST, origin: CC_ORIGIN, 'content-type': 'text/plain' }, why: 'text/plain', status: 415 },
    { headers: { host: CC_HOST, origin: CC_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, why: 'form', status: 415 },
    { headers: { host: CC_HOST, origin: CC_ORIGIN }, why: 'no content type', status: 415 },
  ];
}

test('a cross-site or non-JSON POST creates no session and opens no terminal', async () => {
  await withPlugin(async ({ fake, plugin }) => {
    for (const v of hostileVariants(plugin.port)) {
      const r = await request(plugin.port, { method: 'POST', path: '/api/sessions', headers: v.headers, body: JSON.stringify({ project: 'alpha', worktree: null, cols: 80, rows: 24 }) });
      assert.equal(r.status, v.status ?? 403, v.why);
    }
    assert.equal(fake.opens.length, 0);
    assert.deepEqual((await api(plugin.port, 'GET', '/api/sessions')).json.sessions, []);
  });
});

test('a cross-site or non-JSON DELETE kills nothing', async () => {
  await withPlugin(async ({ fake, plugin }) => {
    const { json } = await api(plugin.port, 'POST', '/api/sessions', { project: 'alpha', worktree: null, cols: 80, rows: 24 });
    for (const v of hostileVariants(plugin.port)) {
      const r = await request(plugin.port, { method: 'DELETE', path: `/api/sessions/${json.id}`, headers: v.headers });
      assert.equal(r.status, v.status ?? 403, v.why);
    }
    assert.equal(fake.terminals[0].closed, null);
    assert.equal((await api(plugin.port, 'GET', '/api/sessions')).json.sessions.length, 1);
    assert.equal((await api(plugin.port, 'DELETE', `/api/sessions/${json.id}`)).status, 204);
  });
});

test('a cross-site or non-JSON PUT writes no layout', async () => {
  await withPlugin(async ({ plugin }) => {
    for (const v of hostileVariants(plugin.port)) {
      const r = await request(plugin.port, { method: 'PUT', path: '/api/layouts/alpha', headers: v.headers, body: JSON.stringify({ tree: TREE }) });
      assert.equal(r.status, v.status ?? 403, v.why);
    }
    assert.equal(fs.existsSync(path.join(plugin.dataDir, 'layouts', 'alpha.json')), false);
    assert.equal((await api(plugin.port, 'PUT', '/api/layouts/alpha', { tree: TREE })).status, 204);
  });
});

test("a GET whose Host names the backend's own port is refused (a direct dial, or rebinding onto that port)", async () => {
  await withPlugin(async ({ plugin }) => {
    const r = await request(plugin.port, { path: '/api/sessions', headers: { host: `evil.test:${plugin.port}` } });
    assert.equal(r.status, 403);
    assert.equal((await request(plugin.port, { path: '/api/sessions', headers: { host: CC_HOST } })).status, 200);
  });
});

test('no API response grants cross-site read access (no Access-Control-Allow-Origin), whatever the request', async () => {
  await withPlugin(async ({ plugin }) => {
    await api(plugin.port, 'PUT', '/api/layouts/alpha', { tree: TREE });
    const evil = 'http://evil.test';
    for (const p of ['/api/projects', '/api/sessions', '/api/layouts/alpha']) {
      for (const headers of [
        { host: CC_HOST },
        { host: CC_HOST, origin: CC_ORIGIN },
        { host: CC_HOST, origin: evil },
        { host: 'evil.test:3999', origin: 'http://evil.test:3999' },
      ]) {
        for (const method of ['GET', 'OPTIONS']) {
          const r = await request(plugin.port, {
            method, path: p,
            headers: { ...headers, ...(method === 'OPTIONS' ? { 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' } : {}) },
          });
          for (const h of Object.keys(r.headers)) assert.ok(!h.startsWith('access-control-'), `${method} ${p} ${JSON.stringify(headers)} sent ${h}`);
        }
      }
    }
  });
});
