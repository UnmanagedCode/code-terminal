import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLayoutStore } from '../lib/layoutStore.js';
import { migrateLegacyDataDir } from '../lib/migrateLegacyDataDir.js';
import { tmpDir } from './helpers.mjs';

const TREE = { kind: 'pane', id: 'p1', sessionId: null };

function setup() {
  const root = tmpDir();
  return {
    root,
    legacy: path.join(root, '.code-terminal'), // the contract under test
    dataDir: path.join(root, '.code-conductor', 'plugins', 'data', 'code-terminal'),
    lines: [],
    log: null,
  };
}
const withLog = (s) => { s.log = { log: (m) => s.lines.push(m) }; return s; };
const run = (s) => migrateLegacyDataDir({ projectsRoot: s.root, dataDir: s.dataDir, log: s.log });

function seed(dir) {
  fs.mkdirSync(path.join(dir, 'layouts', 'alpha'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'layouts', 'alpha', 'main.json'), JSON.stringify(TREE), { mode: 0o600 });
  fs.mkdirSync(path.join(dir, 'history'), { mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'history', 'alpha'), 'ls\n', { mode: 0o600 });
  fs.mkdirSync(path.join(dir, 'shell', 'abc'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'shell', 'abc', '.complete'), '', { mode: 0o600 });
}
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}
const mode = (p) => fs.statSync(p).mode & 0o777;

// Invariant: with no legacy dir the migration does nothing — it creates nothing and logs nothing (also the "already migrated" case).
test('no legacy dir, or no projects root: a no-op', () => {
  const s = withLog(setup());
  run(s);
  migrateLegacyDataDir({ projectsRoot: null, dataDir: s.dataDir, log: s.log });
  assert.equal(fs.existsSync(s.dataDir), false);
  assert.equal(fs.existsSync(path.join(s.root, '.code-conductor')), false);
  assert.deepEqual(s.lines, []);
});

// Invariant: the whole legacy store (layouts, history, installed integration) arrives intact, modes kept, readable by the layout store.
test('a legacy store moves whole into a missing data dir and parent', () => {
  const s = withLog(setup());
  seed(s.legacy);
  const before = snapshot(s.legacy);
  run(s);
  assert.equal(fs.existsSync(s.legacy), false);
  assert.deepEqual(snapshot(s.dataDir), before);
  assert.equal(mode(path.join(s.dataDir, 'history', 'alpha')), 0o600);
  assert.equal(mode(path.join(s.dataDir, 'history')), 0o700);
  assert.equal(mode(path.join(s.dataDir, 'layouts', 'alpha', 'main.json')), 0o600);
  assert.equal(fs.existsSync(path.join(s.dataDir, 'shell', 'abc', '.complete')), true);
  assert.equal(s.lines.length, 1);
  assert.ok(s.lines[0].includes(s.legacy) && s.lines[0].includes(s.dataDir));
  return createLayoutStore(s.dataDir).get({ project: 'alpha', worktree: null }).then((t) => assert.deepEqual(t, TREE));
});

// Invariant: an existing but empty data dir does not block the move.
test('an empty existing data dir is replaced by the move', () => {
  const s = withLog(setup());
  seed(s.legacy);
  fs.mkdirSync(s.dataDir, { recursive: true });
  run(s);
  assert.equal(fs.existsSync(s.legacy), false);
  assert.equal(fs.readFileSync(path.join(s.dataDir, 'history', 'alpha'), 'utf8'), 'ls\n');
});

// Invariant: running twice is safe, and a non-empty data dir without a legacy dir is never touched.
test('idempotent: a second run, and a populated data dir with no legacy, change nothing', () => {
  const s = withLog(setup());
  seed(s.legacy);
  run(s);
  const after = snapshot(s.dataDir);
  run(s);
  assert.deepEqual(snapshot(s.dataDir), after);
  assert.equal(s.lines.length, 1);
});

// Invariant: when both stores hold data the migration refuses and touches neither (no data is merged or lost).
test('a non-empty data dir with a legacy dir present throws and leaves both untouched', () => {
  const s = withLog(setup());
  seed(s.legacy);
  fs.mkdirSync(s.dataDir, { recursive: true });
  fs.writeFileSync(path.join(s.dataDir, 'other'), 'x');
  const a = snapshot(s.legacy);
  const b = snapshot(s.dataDir);
  assert.throws(() => run(s), (e) => e.message.includes(s.legacy) && e.message.includes(s.dataDir));
  assert.deepEqual(snapshot(s.legacy), a);
  assert.deepEqual(snapshot(s.dataDir), b);
});

// Invariant: a legacy path that is not a directory is refused, not moved.
test('a legacy path that is a file throws and nothing moves', () => {
  const s = withLog(setup());
  fs.writeFileSync(s.legacy, 'not a dir');
  assert.throws(() => run(s), (e) => e.message.includes(s.legacy));
  assert.equal(fs.readFileSync(s.legacy, 'utf8'), 'not a dir');
  assert.equal(fs.existsSync(s.dataDir), false);
});
