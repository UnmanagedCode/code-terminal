import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { startScratchCc, PLUGIN_ID } from '../../harness/scratch-cc.mjs';
import { buildSpec } from '../../lib/shellLaunch.js';
import { SKIP, attach, newShell, pluginApi } from './realCc.mjs';

let scratch;
let feature;

before(async () => {
  if (SKIP) return;
  scratch = await startScratchCc();
  const res = await fetch(`${scratch.url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_worktree', arguments: { project: 'alpha', name: 'feature' } } }),
  });
  feature = JSON.parse((await res.json()).result.content[0].text);
}, { timeout: 300_000 });

after(async () => { if (scratch) await scratch.stop(); });

const opts = { skip: SKIP, timeout: 120_000 };

const getJson = (port, p, headers) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, headers, setHost: false }, (res) => {
    let text = '';
    res.on('data', (d) => { text += d; });
    res.on('end', () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

test('a shell opens in the chosen worktree, or the main checkout', opts, async () => {
  const main = await attach(scratch, await newShell(scratch, { project: 'alpha' }));
  assert.equal((await main.run('pwd')).trim(), feature.parentPath);
  const wt = await attach(scratch, await newShell(scratch, { project: 'alpha', worktree: feature.worktree }));
  assert.equal((await wt.run('pwd')).trim(), feature.worktreePath);
  main.close();
  wt.close();
});

test("the program's terminal size follows the attach size and every resize", opts, async () => {
  const t = await attach(scratch, await newShell(scratch, { project: 'alpha' }), { cols: 100, rows: 30 });
  assert.equal((await t.run('stty size')).trim(), '30 100');
  t.resize(132, 41);
  assert.equal((await t.run('stty size')).trim(), '41 132');
  t.close();
});

test('history is per project through cc\'s real pty (the login shell, via the plugin)', opts, async () => {
  const nonce = `only-in-alpha-${Date.now()}`;
  const a1 = await attach(scratch, await newShell(scratch, { project: 'alpha' }));
  const running = await attach(scratch, await newShell(scratch, { project: 'alpha' }));
  await a1.run(`echo ${nonce} >/dev/null`);
  await running.run('true');
  assert.match(await running.run('history'), new RegExp(nonce));
  const a2 = await attach(scratch, await newShell(scratch, { project: 'alpha' }));
  assert.match(await a2.run('history'), new RegExp(nonce));
  const b = await attach(scratch, await newShell(scratch, { project: 'beta' }));
  assert.doesNotMatch(await b.run('history'), new RegExp(nonce));
  for (const t of [a1, running, a2, b]) t.close();
});

test('history is per project through cc\'s real pty (zsh, with the integration the plugin installed)', { ...opts, skip: SKIP || (fs.existsSync('/usr/bin/zsh') ? false : 'zsh is not installed') }, async () => {
  // The plugin installs the integration on its first open on this System.
  (await attach(scratch, await newShell(scratch, { project: 'alpha' }))).close();
  const base = path.join(scratch.tmp, 'projects', '.code-terminal');
  const [hash] = fs.readdirSync(path.join(base, 'shell')).filter((d) => !d.startsWith('.'));
  const open = (project) => new Promise((resolve, reject) => {
    const spec = buildSpec({ shell: '/usr/bin/zsh', base, dir: path.join(base, 'shell', hash), project, worktree: null, cols: 80, rows: 24 });
    const ws = new WebSocket(`${scratch.url.replace(/^http/, 'ws')}/api/terminal?spec=${encodeURIComponent(JSON.stringify(spec))}`, { perMessageDeflate: false });
    const t = { out: '' };
    ws.on('message', (d, bin) => { if (bin) t.out += d.toString('utf8'); });
    ws.once('open', () => resolve(Object.assign(t, {
      async run(cmd) {
        const tag = `Z${Math.random().toString(36).slice(2, 8)}`;
        ws.send(Buffer.from(`echo ${tag}-start; ${cmd}; echo ${tag}-end\r`), { binary: true });
        const re = new RegExp(`${tag}-start\\r?\\n([\\s\\S]*?)${tag}-end`);
        const end = Date.now() + 15000;
        for (;;) {
          const m = re.exec(t.out);
          if (m) return m[1];
          if (Date.now() > end) throw new Error(`zsh: timed out on ${cmd}:\n${t.out.slice(-1500)}`);
          await new Promise((r) => setTimeout(r, 20));
        }
      },
      close: () => ws.close(),
    })));
    ws.once('error', reject);
  });
  const nonce = `zsh-only-in-alpha-${Date.now()}`;
  const a1 = await open('alpha');
  const running = await open('alpha');
  await a1.run(`echo ${nonce} >/dev/null`);
  await running.run('true');
  assert.match(await running.run('fc -ln 1'), new RegExp(nonce));
  const a2 = await open('alpha');
  assert.match(await a2.run('fc -ln 1'), new RegExp(nonce));
  const b = await open('beta');
  assert.doesNotMatch(await b.run('fc -ln 1'), new RegExp(nonce));
  for (const t of [a1, running, a2, b]) t.close();
});

test('restarting the plugin makes an old session id 404 on attach', opts, async () => {
  const id = await newShell(scratch, { project: 'alpha' });
  await scratch.api('POST', `/api/plugins/${PLUGIN_ID}/restart`);
  const r = await attach(scratch, id);
  assert.equal(r.status, 404);
  assert.deepEqual((await pluginApi(scratch, 'GET', 'api/sessions')).json.sessions, []);
});

// Last: it takes cc down.
test('killing cc turns a session ended; the plugin backend survives', opts, async () => {
  const id = await newShell(scratch, { project: 'alpha' });
  const t = await attach(scratch, id);
  await t.run('true');
  const { port: pluginPort } = await scratch.pluginRuntime();
  assert.ok(pluginPort);
  scratch.killCc();
  // Straight to the backend now that the proxy is gone; any Host but the backend's own port passes a GET.
  const end = Date.now() + 15000;
  let state;
  for (;;) {
    const body = await getJson(pluginPort, '/api/sessions', { host: 'cc.test:1' }).catch(() => null);
    state = body?.sessions?.find((s) => s.id === id)?.state;
    if (state?.kind === 'ended' || Date.now() > end) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.deepEqual(state, { kind: 'ended' });
  t.close();
});
