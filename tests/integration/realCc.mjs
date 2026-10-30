// Plumbing for the tests that run against a real (scratch) code-conductor.
// They are skipped unless RUN_REAL_CC=1.
import WebSocket from 'ws';

export const SKIP = process.env.RUN_REAL_CC === '1' ? false : 'set RUN_REAL_CC=1 to run against a scratch cc';

// A request to the plugin through cc's proxy, as its page makes it.
export async function pluginApi(scratch, method, p, body) {
  const res = await fetch(`${scratch.pluginBase}${p}`, {
    method,
    headers: { origin: scratch.url, ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, text };
}

// A browser-side attach through cc's proxy; collects output as text.
export function attach(scratch, id, { cols = 80, rows = 24 } = {}) {
  const url = `${scratch.pluginBase.replace(/^http/, 'ws')}api/sessions/${id}/io?cols=${cols}&rows=${rows}`;
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { origin: scratch.url, perMessageDeflate: false });
    ws.binaryType = 'nodebuffer';
    const t = {
      ws, out: '', messages: [], status: 101, closed: null,
      send: (text) => ws.send(Buffer.from(text, 'utf8'), { binary: true }),
      resize: (c, r) => ws.send(JSON.stringify({ type: 'resize', cols: c, rows: r })),
      async waitFor(pattern, ms = 15000) {
        const end = Date.now() + ms;
        for (;;) {
          const m = typeof pattern === 'string' ? (t.out.includes(pattern) ? [pattern] : null) : pattern.exec(t.out);
          if (m) return m;
          if (Date.now() > end) throw new Error(`timed out waiting for ${pattern}; output so far:\n${t.out.slice(-2000)}`);
          await new Promise((r) => setTimeout(r, 20));
        }
      },
      // Runs `cmd` in the shell and resolves the output between two markers.
      async run(cmd, ms) {
        const tag = `M${Math.random().toString(36).slice(2, 8)}`;
        t.send(`echo ${tag}-start; ${cmd}; echo ${tag}-end\r`);
        const m = await t.waitFor(new RegExp(`${tag}-start\\r?\\n([\\s\\S]*?)${tag}-end`), ms);
        return m[1];
      },
      close: () => ws.close(),
    };
    ws.on('message', (data, isBinary) => {
      if (isBinary) t.out += data.toString('utf8');
      else t.messages.push(JSON.parse(data.toString('utf8')));
    });
    ws.on('close', (code) => { t.closed = code; });
    ws.once('unexpected-response', (_req, res) => { res.resume(); resolve({ status: res.statusCode }); });
    ws.once('open', () => resolve(t));
    ws.on('error', () => {});
  });
}

export async function newShell(scratch, body) {
  const r = await pluginApi(scratch, 'POST', 'api/sessions', { worktree: null, cols: 80, rows: 24, ...body });
  if (r.status !== 201) throw new Error(`create session → ${r.status}: ${r.text}`);
  return r.json.id;
}
