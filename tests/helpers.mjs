// Shared test plumbing: a plugin backend wired to a fake cc, and raw HTTP/upgrade
// requests with full control over Host and Origin.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server.js';

// A Host/Origin pair as cc's proxy delivers it (cc's own port, never the backend's).
export const CC_HOST = 'cc.test:3999';
export const CC_ORIGIN = `http://${CC_HOST}`;

export function tmpDir(prefix = 'code-terminal-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const quietLog = { log() {}, warn() {}, error() {} };

export async function startPlugin({ fake, dataDir = tmpDir(), distDir = tmpDir(), ...rest } = {}) {
  const server = createServer({ distDir, conductorUrl: fake?.url ?? null, dataDir: fake ? dataDir : null, log: quietLog, ...rest });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    server, port, dataDir,
    async close() {
      server.closeAllConnections?.();
      await server.shutdown?.();
      await new Promise((r) => server.close(r));
    },
  };
}

// One HTTP request; `headers` may set Host and Origin freely.
export function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers, setHost: !('host' in headers) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// A JSON mutation as the plugin page sends it through cc's proxy.
export function api(port, method, p, body) {
  return request(port, {
    method, path: p, body,
    headers: { host: CC_HOST, origin: CC_ORIGIN, ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}) },
  });
}

// A WebSocket upgrade with explicit headers; resolves {status} for a refusal or {status: 101, ws}.
export function upgrade(port, p, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${p}`, { headers, perMessageDeflate: false });
    ws.binaryType = 'nodebuffer';
    ws.once('unexpected-response', (_req, res) => { resolve({ status: res.statusCode }); res.resume(); ws.terminate(); });
    ws.once('upgrade', () => { /* opened below */ });
    ws.once('open', () => resolve({ status: 101, ws }));
    ws.once('error', (e) => { if (!/Unexpected server response/.test(e.message)) reject(e); });
  });
}

// Attach a browser-side client to a session, collecting what arrives.
export async function attach(port, id, { cols = 80, rows = 24, headers = { host: CC_HOST, origin: CC_ORIGIN } } = {}) {
  const r = await upgrade(port, `/api/sessions/${id}/io?cols=${cols}&rows=${rows}`, headers);
  if (r.status !== 101) return r;
  const client = { ws: r.ws, status: 101, text: [], bytes: [], closed: null };
  r.ws.on('message', (data, isBinary) => {
    if (isBinary) client.bytes.push(Buffer.from(data));
    else client.text.push(JSON.parse(data.toString('utf8')));
  });
  r.ws.on('close', (code) => { client.closed = code; });
  client.output = () => Buffer.concat(client.bytes).toString('utf8');
  return client;
}

// Poll `fn` until it returns truthy; fails after `ms`.
export async function until(fn, ms = 2000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
