import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';

async function withServer(distDir, fn) {
  const server = createServer({ distDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

function tmpDist(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-terminal-dist-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('health route answers ok with the CSP', async () => {
  const dist = tmpDist({});
  await withServer(dist, async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  });
  fs.rmSync(dist, { recursive: true });
});

test('serves the built index and 404s host URLs standalone', async () => {
  const dist = tmpDist({ 'index.html': '<h1>built</h1>' });
  await withServer(dist, async (base) => {
    assert.equal(await (await fetch(`${base}/`)).text(), '<h1>built</h1>');
    assert.equal((await fetch(`${base}/pluginBridge.js`)).status, 404);
    assert.equal((await fetch(`${base}/pluginTheme.css`)).status, 404);
  });
  fs.rmSync(dist, { recursive: true });
});

test('unbuilt UI: HTML entry answers 503, health stays up', async () => {
  const dist = path.join(os.tmpdir(), 'code-terminal-missing-dist');
  await withServer(dist, async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 503);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/pluginBridge.js`)).status, 404);
  });
});

const EXPECTED_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

function assertSecurityHeaders(headers, what) {
  assert.equal(headers['content-security-policy'], EXPECTED_CSP, what);
  assert.equal(headers['x-content-type-options'], 'nosniff', what);
}

test('every response carries the CSP and nosniff: 200, 404, 503, 500, API refusals and a malformed request', async () => {
  const dist = tmpDist({ 'index.html': '<h1>built</h1>' });
  const brokenDist = path.join(os.tmpdir(), 'code-terminal-missing-dist');
  const { request, startPlugin } = await import('./helpers.mjs');
  const net = await import('node:net');
  const plugin = await startPlugin({ distDir: dist });
  const unbuilt = await startPlugin({ distDir: brokenDist });
  try {
    const cc = { host: 'cc.test:3999' };
    assertSecurityHeaders((await request(plugin.port, { path: '/', headers: cc })).headers, '200');
    assertSecurityHeaders((await request(plugin.port, { path: '/nope', headers: cc })).headers, '404');
    assertSecurityHeaders((await request(unbuilt.port, { path: '/', headers: cc })).headers, '503 unbuilt');
    assertSecurityHeaders((await request(plugin.port, { path: '/api/sessions', headers: cc })).headers, '503 standalone api');
    assertSecurityHeaders((await request(plugin.port, { path: '/%E0%A4%A', headers: cc })).headers, 'bad escape');
    // A dist entry that is a directory makes sendFile fail with a 500-class error.
    fs.mkdirSync(path.join(dist, 'assets', 'dir.js'), { recursive: true });
    const r500 = await request(plugin.port, { path: '/assets/dir.js', headers: cc });
    assert.ok(r500.status >= 400, `${r500.status}`);
    assertSecurityHeaders(r500.headers, `${r500.status} from sendFile`);
    // A request node's own parser rejects.
    const raw = await new Promise((resolve) => {
      const s = net.connect(plugin.port, '127.0.0.1', () => s.write('GET / HTTP/1.1\r\nHost: x\r\nBad Header\r\n\r\n'));
      let out = '';
      s.on('data', (d) => { out += d; });
      s.on('close', () => resolve(out));
    });
    assert.match(raw, /^HTTP\/1\.1 400/);
    assert.ok(raw.includes(`Content-Security-Policy: ${EXPECTED_CSP}\r\n`));
    assert.ok(raw.includes('X-Content-Type-Options: nosniff\r\n'));
  } finally {
    await plugin.close();
    await unbuilt.close();
    fs.rmSync(dist, { recursive: true });
  }
});

test('standalone, every api route but health answers 503 HOST_UNAVAILABLE', async () => {
  const { api, startPlugin } = await import('./helpers.mjs');
  const plugin = await startPlugin();
  try {
    for (const [m, p, body] of [['GET', '/api/projects'], ['GET', '/api/sessions'], ['POST', '/api/sessions', {}], ['GET', '/api/layouts/a']]) {
      const r = await api(plugin.port, m, p, body);
      assert.equal(r.status, 503, `${m} ${p}`);
      assert.equal(r.json.code, 'HOST_UNAVAILABLE');
    }
    assert.equal((await api(plugin.port, 'GET', '/api/health')).status, 200);
  } finally { await plugin.close(); }
});
