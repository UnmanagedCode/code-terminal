import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeCc, projectRow } from './fakeCc.mjs';
import { api, startPlugin } from './helpers.mjs';

const fixedSpec = { specFor: async ({ project }) => ({ project, worktree: null, cols: 80, rows: 24 }) };

test('shells are numbered per project in creation order, and a number is never reused after a close', async () => {
  const fake = await startFakeCc({ projects: [projectRow('alpha'), projectRow('beta')] });
  const plugin = await startPlugin({ fake, shellLaunch: fixedSpec });
  const open = async (project) => (await api(plugin.port, 'POST', '/api/sessions', { project, worktree: null, cols: 80, rows: 24 })).json.id;
  const ordinals = async () => Object.fromEntries((await api(plugin.port, 'GET', '/api/sessions')).json.sessions.map((s) => [s.id, `${s.project}#${s.ordinal}`]));
  try {
    const a1 = await open('alpha');
    const a2 = await open('alpha');
    const b1 = await open('beta');
    assert.deepEqual(await ordinals(), { [a1]: 'alpha#1', [a2]: 'alpha#2', [b1]: 'beta#1' });
    await api(plugin.port, 'DELETE', `/api/sessions/${a2}`);
    const a3 = await open('alpha');
    assert.deepEqual(await ordinals(), { [a1]: 'alpha#1', [b1]: 'beta#1', [a3]: 'alpha#3' });
  } finally {
    await plugin.close();
    await fake.close();
  }
});

// Invariant: kill-on-close is per checkout.
test('killCheckout kills the sessions of that exact checkout only, and counts them', async () => {
  const { createSessionManager } = await import('../lib/sessionManager.js');
  const { quietLog } = await import('./helpers.mjs');
  const fake = await startFakeCc({ projects: [projectRow('alpha'), projectRow('beta')] });
  const manager = createSessionManager({
    cc: (await import('../lib/ccClient.js')).createCcClient(fake.url),
    shellLaunch: fixedSpec,
    probe: { noteRefusal() {}, noteSuccess() {} },
    log: quietLog,
  });
  const open = (project, worktree) => manager.create({ project, worktree, cols: 80, rows: 24 });
  try {
    const mainA = await open('alpha', null);
    const featA = await open('alpha', 'feat');
    const mainB = await open('beta', null);
    assert.equal(manager.killCheckout('alpha', null), 1);
    assert.deepEqual(manager.list().map((s) => s.id).sort(), [featA.id, mainB.id].sort());
    assert.equal(manager.killCheckout('alpha', null), 0);
    assert.equal(mainA.info.project, 'alpha');
  } finally {
    manager.closeAll();
    await fake.close();
  }
});
