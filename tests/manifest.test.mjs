import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../conductor.plugin.json', import.meta.url), 'utf8'));

// Invariant: both row menus offer "Open terminal", and it points at the one page the server serves.
test('the manifest adds "Open terminal" to project and worktree menus, pointing at /', () => {
  assert.deepEqual(manifest.menuItems, [
    { label: 'Open terminal', scope: 'project', path: '/' },
    { label: 'Open terminal', scope: 'worktree', path: '/' },
  ]);
  assert.equal(manifest.frontend.path, '/');
});
