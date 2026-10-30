import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addProviderProject, startScratchCc } from '../../harness/scratch-cc.mjs';
import { SKIP, attach, newShell, pluginApi } from './realCc.mjs';

let scratch;
let remotePath;

before(async () => {
  if (SKIP) return;
  scratch = await startScratchCc();
  remotePath = await addProviderProject(scratch, { system: 'ref', name: 'remote1' });
  await addProviderProject(scratch, { system: 'nopty', name: 'remote2', args: ['--no-pty'] });
}, { timeout: 300_000 });

after(async () => { if (scratch) await scratch.stop(); });

const opts = { skip: SKIP, timeout: 120_000 };

test("a project on a provider System opens a shell there, with history under the target's $HOME", opts, async () => {
  const t = await attach(scratch, await newShell(scratch, { project: 'remote1' }));
  assert.equal((await t.run('pwd')).trim(), remotePath);
  const histfile = path.join(scratch.home, '.local/state/code-terminal/history/remote1');
  assert.equal((await t.run('echo $HISTFILE')).trim(), histfile);
  const nonce = `remote-${Date.now()}`;
  await t.run(`echo ${nonce} >/dev/null`);
  await t.run('true');
  assert.match(fs.readFileSync(histfile, 'utf8'), new RegExp(nonce));
  t.close();
});

test('a project on a System without a pty is disabled, naming the provider', opts, async () => {
  const { json } = await pluginApi(scratch, 'GET', 'api/projects');
  const remote2 = json.projects.find((p) => p.name === 'remote2');
  assert.equal(remote2.terminal.state, 'unavailable');
  assert.equal(remote2.terminal.code, 'SYSTEM_NO_PTY');
  assert.match(remote2.terminal.reason, /nopty/);
  assert.match(remote2.terminal.reason, /does not support terminals/);
  assert.equal(json.projects.find((p) => p.name === 'remote1').terminal.state, 'available');
  const r = await pluginApi(scratch, 'POST', 'api/sessions', { project: 'remote2', worktree: null, cols: 80, rows: 24 });
  assert.equal(r.status, 501);
  assert.equal(r.json.code, 'SYSTEM_NO_PTY');
});
