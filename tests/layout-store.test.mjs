import { mock, test } from 'node:test';
import fsp from 'node:fs/promises';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLayoutStore } from '../lib/layoutStore.js';
import { validateLayout, LAYOUT_MAX_BYTES } from '../shared/layout.js';
import { tmpDir } from './helpers.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/layouts.json', import.meta.url), 'utf8'));
const pane = (id) => ({ kind: 'pane', id, sessionId: null });
const main = (project) => ({ project, worktree: null });
const wt = (project, worktree) => ({ project, worktree });

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

// Invariant: layouts are keyed by checkout, never shared.
test('the main and worktree layouts of one project round-trip independently, and one worktree name in two projects is two layouts', async () => {
  const dir = tmpDir();
  const store = createLayoutStore(dir);
  await store.put(main('alpha'), pane('main-a'));
  await store.put(wt('alpha', 'feat'), pane('feat-a'));
  await store.put(wt('beta', 'feat'), pane('feat-b'));
  assert.deepEqual(await store.get(main('alpha')), pane('main-a'));
  assert.deepEqual(await store.get(wt('alpha', 'feat')), pane('feat-a'));
  assert.deepEqual(await store.get(wt('beta', 'feat')), pane('feat-b'));
  assert.equal(await store.get(main('beta')), null);
  assert.equal(await store.get(wt('alpha', 'other')), null);
  assert.ok(fs.existsSync(path.join(dir, 'layouts', 'alpha', 'main.json')));
  assert.ok(fs.existsSync(path.join(dir, 'layouts', 'alpha', 'worktrees', 'feat.json')));
});

// Invariant: closing a tab drops exactly that checkout's layout.
test('remove deletes one checkout layout only, and removing an absent one is fine', async () => {
  const store = createLayoutStore(tmpDir());
  await store.put(main('alpha'), pane('m'));
  await store.put(wt('alpha', 'feat'), pane('f'));
  await store.remove(wt('alpha', 'feat'));
  assert.equal(await store.get(wt('alpha', 'feat')), null);
  assert.deepEqual(await store.get(main('alpha')), pane('m'));
  await store.remove(wt('alpha', 'never'));
});

test('an invalid or oversize tree is refused and the stored layout survives', async () => {
  const dir = tmpDir();
  const store = createLayoutStore(dir);
  await store.put(main('alpha'), pane('kept'));
  await assert.rejects(store.put(main('alpha'), fixtures.invalid[3]), (e) => e.status === 400);
  const big = deepTree(Math.ceil(LAYOUT_MAX_BYTES / 60));
  assert.ok(JSON.stringify(big).length > LAYOUT_MAX_BYTES);
  await assert.rejects(store.put(main('alpha'), big), (e) => e.status === 413);
  assert.deepEqual(await store.get(main('alpha')), pane('kept'));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'layouts', 'alpha')), ['main.json'], 'no temp file is left behind');
});

// Invariant: no path traversal through the project or worktree segment.
test('a project or worktree name that could traverse out of the layouts directory is refused', async () => {
  const dir = tmpDir();
  const store = createLayoutStore(path.join(dir, 'data'));
  for (const name of ['..', '.', '../escape', 'a/b', '']) {
    for (const c of [main(name), wt('alpha', name)]) {
      await assert.rejects(store.put(c, pane('x')), (e) => e.status === 400, JSON.stringify(c));
      await assert.rejects(store.get(c), (e) => e.status === 400, JSON.stringify(c));
      await assert.rejects(store.remove(c), (e) => e.status === 400, JSON.stringify(c));
    }
  }
  assert.deepEqual(fs.readdirSync(dir), ['data'].filter((d) => fs.existsSync(path.join(dir, d))));
});

test('a write that fails after its temp file is written leaves the old layout intact and no temp file', async () => {
  const dir = tmpDir();
  const store = createLayoutStore(dir);
  await store.put(main('alpha'), pane('kept'));
  const rename = mock.method(fsp, 'rename', async () => { throw Object.assign(new Error('injected'), { code: 'EIO' }); });
  try {
    await assert.rejects(store.put(main('alpha'), pane('lost')), /injected/);
  } finally { rename.mock.restore(); }
  assert.deepEqual(await store.get(main('alpha')), pane('kept'));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'layouts', 'alpha')), ['main.json']);
});

test('concurrent saves of one checkout all succeed and leave one of the saved layouts', async () => {
  const store = createLayoutStore(tmpDir());
  const trees = Array.from({ length: 8 }, (_, i) => pane(`p${i}`));
  await Promise.all(trees.map((t) => store.put(main('alpha'), t)));
  const got = await store.get(main('alpha'));
  assert.ok(trees.some((t) => t.id === got.id));
});
