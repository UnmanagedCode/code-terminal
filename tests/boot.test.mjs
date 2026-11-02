import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeCc } from './fakeCc.mjs';
import { tmpDir } from './helpers.mjs';

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

async function freePort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

// Spawns `node server.js` with exactly `env`; resolves when `ready(stdout)` holds or the child exits.
function boot(env, ready = () => false) {
  const child = spawn(process.execPath, [server], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const r = { child, stdout: '', stderr: '', code: undefined };
  child.stdout.on('data', (d) => { r.stdout += d; });
  child.stderr.on('data', (d) => { r.stderr += d; });
  r.done = new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(r); }, 10_000);
    const poll = setInterval(() => { if (ready(r.stdout)) { clearInterval(poll); clearTimeout(timer); resolve(r); } }, 10);
    child.once('exit', (code) => { r.code = code; clearInterval(poll); clearTimeout(timer); resolve(r); });
  });
  return r;
}

// Invariant: cc mode without a data dir var exits non-zero at boot and names the var.
test('CONDUCTOR_URL without CONDUCTOR_PLUGIN_DATA_DIR fails at boot', async () => {
  const r = await boot({ CONDUCTOR_URL: 'http://127.0.0.1:1', PORT: String(await freePort()) }).done;
  assert.notEqual(r.code, 0);
  assert.notEqual(r.code, undefined);
  assert.match(r.stderr, /CONDUCTOR_PLUGIN_DATA_DIR/);
});

// Invariant: a conflicting legacy + populated data dir stops the boot before listening and changes neither.
test('legacy plus a non-empty data dir exits before listening, both untouched', async () => {
  const root = tmpDir();
  const legacy = path.join(root, '.code-terminal');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(legacy, 'history'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'history', 'alpha'), 'ls\n');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'keep'), 'k');
  const r = await boot({ CONDUCTOR_URL: 'http://127.0.0.1:1', CONDUCTOR_PLUGIN_DATA_DIR: dataDir, PROJECTS_ROOT: root, PORT: String(await freePort()) }).done;
  assert.notEqual(r.code, 0);
  assert.notEqual(r.code, undefined);
  assert.doesNotMatch(r.stdout, /listening/);
  assert.equal(fs.readFileSync(path.join(legacy, 'history', 'alpha'), 'utf8'), 'ls\n');
  assert.deepEqual(fs.readdirSync(dataDir), ['keep']);
});

// Invariant: the migration has run by the time the backend listens.
test('legacy plus an absent data dir is moved before the backend listens', async () => {
  const fake = await startFakeCc();
  const root = tmpDir();
  const legacy = path.join(root, '.code-terminal');
  const dataDir = path.join(root, '.code-conductor', 'plugins', 'data', 'code-terminal');
  fs.mkdirSync(path.join(legacy, 'history'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'history', 'alpha'), 'ls\n');
  const r = boot({ CONDUCTOR_URL: fake.url, CONDUCTOR_PLUGIN_DATA_DIR: dataDir, PROJECTS_ROOT: root, PORT: String(await freePort()) }, (o) => /listening/.test(o));
  try {
    await r.done;
    assert.match(r.stdout, /listening/);
    assert.equal(fs.existsSync(legacy), false);
    assert.equal(fs.readFileSync(path.join(dataDir, 'history', 'alpha'), 'utf8'), 'ls\n');
  } finally {
    r.child.kill('SIGKILL');
    await fake.close?.();
  }
});
