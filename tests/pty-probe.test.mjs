import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeCc, projectRow } from './fakeCc.mjs';
import { api, startPlugin } from './helpers.mjs';

const NO_PTY = "terminal: system 'box' is served by prov, which does not support terminals (no pty capability)";
const fixedSpec = { specFor: async ({ project }) => ({ project, worktree: null, cols: 80, rows: 24 }) };

async function withPlugin(projects, terminal, fn) {
  const fake = await startFakeCc({ projects, terminal });
  const plugin = await startPlugin({ fake, shellLaunch: fixedSpec });
  try { await fn({ fake, plugin }); } finally {
    await plugin.close();
    await fake.close();
  }
}

const listed = async (port) => Object.fromEntries((await api(port, 'GET', '/api/projects')).json.projects.map((p) => [p.name, p.terminal]));

test("a System without a pty disables its projects with cc's exact text", async () => {
  const rows = [projectRow('alpha'), projectRow('remote1', { system: 'box', path: '/srv/remote1' })];
  const terminal = (spec) => (spec.project === 'remote1' ? { refuse: { status: 501, body: { error: NO_PTY, code: 'SYSTEM_NO_PTY' } } } : undefined);
  await withPlugin(rows, terminal, async ({ plugin }) => {
    const t = await listed(plugin.port);
    assert.deepEqual(t.remote1, { state: 'unavailable', code: 'SYSTEM_NO_PTY', reason: NO_PTY });
    assert.deepEqual(t.alpha, { state: 'available' });
  });
});

test('the probe runs once per System, not per project or per listing', async () => {
  const rows = [projectRow('a1'), projectRow('a2'), projectRow('b1', { system: 'box' }), projectRow('b2', { system: 'box' })];
  await withPlugin(rows, undefined, async ({ fake, plugin }) => {
    await listed(plugin.port);
    await listed(plugin.port);
    const probes = fake.opens.filter((o) => o.spec.argv?.join(' ') === 'sh -c exit 0');
    assert.equal(probes.length, 2);
    assert.deepEqual(probes.map((p) => [p.spec.cols, p.spec.rows]), [[1, 1], [1, 1]]);
  });
});

test('targets of one System are probed separately', async () => {
  const rows = [projectRow('x', { system: 'box', remoteId: 'one' }), projectRow('y', { system: 'box', remoteId: 'two' })];
  await withPlugin(rows, undefined, async ({ fake, plugin }) => {
    await listed(plugin.port);
    assert.equal(fake.opens.length, 2);
  });
});

test('a later real-open refusal updates the cached state, and a later success clears it', async () => {
  let refuse = false;
  const terminal = () => (refuse ? { refuse: { status: 501, body: { error: NO_PTY, code: 'SYSTEM_NO_PTY' } } } : undefined);
  await withPlugin([projectRow('alpha')], terminal, async ({ plugin }) => {
    assert.equal((await listed(plugin.port)).alpha.state, 'available');
    refuse = true;
    const r = await api(plugin.port, 'POST', '/api/sessions', { project: 'alpha', worktree: null, cols: 80, rows: 24 });
    assert.deepEqual({ status: r.status, ...r.json }, { status: 501, code: 'SYSTEM_NO_PTY', error: NO_PTY });
    assert.equal((await listed(plugin.port)).alpha.state, 'unavailable');
    refuse = false;
    assert.equal((await api(plugin.port, 'POST', '/api/sessions', { project: 'alpha', worktree: null, cols: 80, rows: 24 })).status, 201);
    assert.equal((await listed(plugin.port)).alpha.state, 'available');
  });
});

test('an unreachable System is reported as unreachable, and a project cc could not reach carries its reason', async () => {
  const rows = [projectRow('alpha', { system: 'down' }), { ...projectRow('beta', { system: 'gone' }), systemUnreachable: 'system gone is down' }];
  const terminal = () => ({ refuse: { status: 502, body: { error: 'terminal: provider died', code: 'SYSTEM_UNREACHABLE' } } });
  await withPlugin(rows, terminal, async ({ fake, plugin }) => {
    const t = await listed(plugin.port);
    assert.deepEqual(t.alpha, { state: 'unreachable', code: 'SYSTEM_UNREACHABLE', reason: 'terminal: provider died' });
    assert.deepEqual(t.beta, { state: 'unreachable', code: null, reason: 'system gone is down' });
    assert.equal(fake.opens.filter((o) => o.spec.project === 'beta').length, 0);
  });
});
