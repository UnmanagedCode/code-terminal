import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../lib/config.js';

// Invariant: in cc mode the store is exactly CONDUCTOR_PLUGIN_DATA_DIR, never derived from PROJECTS_ROOT.
test('cc mode takes the data dir from CONDUCTOR_PLUGIN_DATA_DIR', () => {
  const c = loadConfig({ CONDUCTOR_URL: 'http://cc.test', CONDUCTOR_PLUGIN_DATA_DIR: '/data/ct', PROJECTS_ROOT: '/unrelated', PORT: '4100' });
  assert.deepEqual(c, { port: 4100, conductorUrl: 'http://cc.test', dataDir: '/data/ct' });
});

// Invariant: cc mode without a usable absolute data dir fails loudly instead of running without a store.
test('cc mode refuses a missing, empty or relative data dir', () => {
  const base = { CONDUCTOR_URL: 'http://cc.test', PROJECTS_ROOT: '/root' };
  assert.throws(() => loadConfig(base), /CONDUCTOR_PLUGIN_DATA_DIR/);
  assert.throws(() => loadConfig({ ...base, CONDUCTOR_PLUGIN_DATA_DIR: '' }), /CONDUCTOR_PLUGIN_DATA_DIR/);
  assert.throws(() => loadConfig({ ...base, CONDUCTOR_PLUGIN_DATA_DIR: 'rel/dir' }), /absolute.*rel\/dir/);
});

// Invariant: without CONDUCTOR_URL the backend is standalone whatever else is set.
test('standalone ignores PROJECTS_ROOT and the data dir var', () => {
  for (const env of [{}, { PROJECTS_ROOT: '/root' }, { CONDUCTOR_PLUGIN_DATA_DIR: '/d' }, { PROJECTS_ROOT: '/root', CONDUCTOR_PLUGIN_DATA_DIR: '/d' }]) {
    const c = loadConfig(env);
    assert.equal(c.conductorUrl, null);
    assert.equal(c.dataDir, null);
  }
});
