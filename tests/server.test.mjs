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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-shell-dist-'));
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
  const dist = path.join(os.tmpdir(), 'code-shell-missing-dist');
  await withServer(dist, async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 503);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/pluginBridge.js`)).status, 404);
  });
});
