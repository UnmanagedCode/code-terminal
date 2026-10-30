import { mock, test } from 'node:test';
import fsp from 'node:fs/promises';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLayoutStore } from '../lib/layoutStore.js';
import { validateLayout, LAYOUT_MAX_BYTES } from '../shared/layout.js';
import { tmpDir } from './helpers.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/layouts.json', import.meta.url), 'utf8'));
const pane = (id) => ({ kind: 'pane', id, sessionId: null, worktree: null });

function deepTree(depth) {
  let t = pane('leaf');
  for (let i = 0; i < depth; i++) t = { kind: 'split', dir: i % 2 ? 'row' : 'col', ratio: 0.5, a: pane(`p${i}`), b: t };
  return t;
}

test('the shared fixtures validate as labelled', () => {
  for (const t of fixtures.valid) assert.equal(validateLayout(t), null, JSON.stringify(t));
  for (const t of fixtures.invalid) assert.notEqual(validateLayout(t), null, JSON.stringify(t));
});

test('a tree nested 10,000 deep validates without a stack overflow', () => {
  assert.equal(validateLayout(deepTree(10_000)), null);
});

test('a layout round-trips per project, and projects do not share one', async () => {
  const store = createLayoutStore(tmpDir());
  const a = fixtures.valid[3];
  await store.put('alpha', a);
  await store.put('beta', pane('only-beta'));
  assert.deepEqual(await store.get('alpha'), a);
  assert.deepEqual(await store.get('beta'), pane('only-beta'));
  assert.equal(await store.get('gamma'), null);
});

test('an invalid or oversize tree is refused and the stored layout survives', async () => {
  const dir = tmpDir();
  const store = createLayoutStore(dir);
  await store.put('alpha', pane('kept'));
  await assert.rejects(store.put('alpha', fixtures.invalid[3]), (e) => e.status === 400);
  const big = deepTree(Math.ceil(LAYOUT_MAX_BYTES / 60));
  assert.ok(JSON.stringify(big).length > LAYOUT_MAX_BYTES);
  await assert.rejects(store.put('alpha', big), (e) => e.status === 413);
  assert.deepEqual(await store.get('alpha'), pane('kept'));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'layouts')), ['alpha.json'], 'no temp file is left behind');
});

test('a project name that could traverse out of the layouts directory is refused', async () => {
  const dir = tmpDir();
  const store = createLayoutStore(path.join(dir, 'data'));
  for (const name of ['..', '.', '../escape', 'a/b', '']) {
    await assert.rejects(store.put(name, pane('x')), (e) => e.status === 400, name);
    await assert.rejects(store.get(name), (e) => e.status === 400, name);
  }
  assert.deepEqual(fs.readdirSync(dir), ['data'].filter((d) => fs.existsSync(path.join(dir, d))));
});

test('a write that fails after its temp file is written leaves the old layout intact and no temp file', async () => {
  const dir = tmpDir();
  const store = createLayoutStore(dir);
  await store.put('alpha', pane('kept'));
  const rename = mock.method(fsp, 'rename', async () => { throw Object.assign(new Error('injected'), { code: 'EIO' }); });
  try {
    await assert.rejects(store.put('alpha', pane('lost')), /injected/);
  } finally { rename.mock.restore(); }
  assert.deepEqual(await store.get('alpha'), pane('kept'));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'layouts')), ['alpha.json']);
});

test('concurrent saves of one project all succeed and leave one of the saved layouts', async () => {
  const store = createLayoutStore(tmpDir());
  const trees = Array.from({ length: 8 }, (_, i) => pane(`p${i}`));
  await Promise.all(trees.map((t) => store.put('alpha', t)));
  const got = await store.get('alpha');
  assert.ok(trees.some((t) => t.id === got.id));
});
