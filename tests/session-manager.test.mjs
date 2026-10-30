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
