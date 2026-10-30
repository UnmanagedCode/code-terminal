// cc's REST and terminal endpoints as the plugin backend uses them, every call
// bounded by a deadline and a byte cap (docs/protocol.md → What the backend sends cc).
import WebSocket from 'ws';
import { Refusal } from './refusal.js';

export const REFUSAL_BODY_MAX_BYTES = 64 * 1024;
const RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
// Above cc's own deadline for starting a terminal, so cc's refusal arrives first.
const OPEN_TIMEOUT_MS = 45_000;


const unreachable = (what, e) => new Refusal(502, 'HOST_UNREACHABLE', `${what}: code-conductor is unreachable (${e.message})`);

function parseRefusal(status, text, what) {
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  const error = typeof body?.error === 'string' ? body.error : `${what}: code-conductor answered ${status}`;
  return new Refusal(status, typeof body?.code === 'string' ? body.code : null, error.slice(0, REFUSAL_BODY_MAX_BYTES));
}

async function readCapped(stream, max) {
  const chunks = [];
  let n = 0;
  for await (const c of stream) {
    n += c.length;
    if (n > max) { chunks.push(c.subarray(0, c.length - (n - max))); break; }
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createCcClient(baseUrl, { openTimeoutMs = OPEN_TIMEOUT_MS, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  async function call(method, path, body) {
    const what = `${method} ${path}`;
    let res;
    try {
      res = await fetch(new URL(path, baseUrl), {
        method,
        signal: AbortSignal.timeout(requestTimeoutMs),
        ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      if (e.name === 'TimeoutError') throw new Refusal(504, 'HOST_TIMEOUT', `${what}: code-conductor did not answer in ${requestTimeoutMs} ms`);
      throw unreachable(what, e);
    }
    const text = await readCapped(res.body ?? [], RESPONSE_MAX_BYTES);
    if (!res.ok) throw parseRefusal(res.status, text, what);
    try { return JSON.parse(text); } catch { throw new Refusal(502, 'HOST_BAD_RESPONSE', `${what}: code-conductor's answer is not JSON`); }
  }

  return {
    listProjects: () => call('GET', '/api/projects'),
    // `{name, system, remoteId, path}`: placement without the git work listProjects does.
    projectLocation: (name) => call('GET', `/api/projects/${encodeURIComponent(name)}/location`),
    exec: (body) => call('POST', '/api/exec', body),

    // An open terminal (a `ws` socket, binary as Buffers), or a Refusal.
    // No `origin` option: cc refuses any request that carries one.
    openTerminal(spec) {
      const url = new URL('/api/terminal', baseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('spec', JSON.stringify(spec));
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: RESPONSE_MAX_BYTES });
        ws.binaryType = 'nodebuffer';
        let settled = false;
        const settle = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
        const timer = setTimeout(() => {
          ws.terminate();
          settle(reject, new Refusal(504, 'HOST_TIMEOUT', `terminal: code-conductor did not open the terminal in ${openTimeoutMs} ms`));
        }, openTimeoutMs);
        ws.once('unexpected-response', (_req, res) => {
          readCapped(res, REFUSAL_BODY_MAX_BYTES)
            .then((text) => settle(reject, parseRefusal(res.statusCode, text, 'terminal')),
              (e) => settle(reject, unreachable('terminal', e)))
            .finally(() => ws.terminate());
        });
        ws.once('open', () => settle(resolve, ws));
        ws.on('error', (e) => settle(reject, unreachable('terminal', e)));
      });
    },
  };
}
