import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeCc, projectRow } from './fakeCc.mjs';
import { api, startPlugin, until } from './helpers.mjs';

const fixedSpec = { specFor: async ({ project, worktree }) => ({ project, worktree, cols: 80, rows: 24 }) };
const pane = (id) => ({ kind: 'pane', id, sessionId: null });

async function withPlugin(projects, fn) {
  const fake = await startFakeCc({ projects });
  const plugin = await startPlugin({ fake, shellLaunch: fixedSpec });
  try { await fn({ fake, plugin }); } finally {
    await plugin.close();
    await fake.close();
  }
}

const open = async (plugin, project, worktree) => (await api(plugin.port, 'POST', '/api/sessions', { project, worktree, cols: 80, rows: 24 })).json.id;

// Invariant: the backend kills every shell of a closed checkout, including ones the page never knew, and drops only its layout.
test('DELETE /api/checkouts kills that checkout\'s sessions and layout and leaves the others', async () => {
  await withPlugin([projectRow('alpha'), projectRow('beta')], async ({ fake, plugin }) => {
    const featId = await open(plugin, 'alpha', 'feat');
    const mainId = await open(plugin, 'alpha', null);
    const betaFeat = await open(plugin, 'beta', 'feat');
    await api(plugin.port, 'PUT', '/api/layouts/alpha?worktree=feat', { tree: pane('f') });
    await api(plugin.port, 'PUT', '/api/layouts/alpha', { tree: pane('m') });
    const r = await api(plugin.port, 'DELETE', '/api/checkouts/alpha?worktree=feat');
    assert.equal(r.status, 204);
    const ids = (await api(plugin.port, 'GET', '/api/sessions')).json.sessions.map((s) => s.id).sort();
    assert.deepEqual(ids, [mainId, betaFeat].sort());
    assert.ok(!ids.includes(featId));
    await until(() => fake.terminals.filter((t) => t.closed !== null).length === 1, 2000, 'the upstream close');
    assert.equal((await api(plugin.port, 'GET', '/api/layouts/alpha?worktree=feat')).json.tree, null);
    assert.deepEqual((await api(plugin.port, 'GET', '/api/layouts/alpha')).json.tree, pane('m'));
    assert.equal((await api(plugin.port, 'DELETE', '/api/checkouts/alpha')).status, 204);
    assert.deepEqual((await api(plugin.port, 'GET', '/api/sessions')).json.sessions.map((s) => s.id), [betaFeat]);
    assert.equal((await api(plugin.port, 'GET', '/api/layouts/alpha')).json.tree, null);
  });
});

test('DELETE /api/checkouts refuses an unusable project or worktree name', async () => {
  await withPlugin([projectRow('alpha')], async ({ plugin }) => {
    for (const p of ['/api/checkouts/alpha?worktree=', '/api/checkouts/alpha?worktree=a%2Fb', '/api/checkouts/alpha?worktree=..', '/api/checkouts/alpha?worktree=a&worktree=b', '/api/checkouts/a%2Fb']) {
      const r = await api(plugin.port, 'DELETE', p);
      assert.equal(r.status, 400, p);
      assert.equal(r.json.code, 'INVALID_ARGUMENT', p);
    }
  });
});

// Invariant: layout routes are keyed by checkout.
test('layout GET and PUT keep the main checkout and each worktree apart, and refuse an empty worktree', async () => {
  await withPlugin([projectRow('alpha')], async ({ plugin }) => {
    assert.equal((await api(plugin.port, 'PUT', '/api/layouts/alpha?worktree=feat', { tree: pane('f') })).status, 204);
    assert.deepEqual((await api(plugin.port, 'GET', '/api/layouts/alpha?worktree=feat')).json.tree, pane('f'));
    assert.equal((await api(plugin.port, 'GET', '/api/layouts/alpha')).json.tree, null);
    assert.equal((await api(plugin.port, 'GET', '/api/layouts/alpha?worktree=other')).json.tree, null);
    assert.equal((await api(plugin.port, 'GET', '/api/layouts/alpha?worktree=')).status, 400);
    assert.equal((await api(plugin.port, 'PUT', '/api/layouts/alpha?worktree=', { tree: pane('x') })).status, 400);
  });
});

// Invariant: the picker's grouping input is delivered.
test('GET /api/projects carries each project\'s workspace, or null', async () => {
  await withPlugin([projectRow('alpha', { workspace: 'team' }), projectRow('beta')], async ({ plugin }) => {
    const { projects } = (await api(plugin.port, 'GET', '/api/projects')).json;
    assert.deepEqual(projects.map((p) => [p.name, p.workspace]), [['alpha', 'team'], ['beta', null]]);
  });
});
