// "Open terminal" in code-conductor's own project and worktree ⋮ menus: a click opens (or reuses) that
// checkout's tab in the plugin frame without reloading it, and an untrusted param shows only as text.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createWorktree } from '../../scratch-cc.mjs';
import { activeTab, cwdName, panes, until, waitRunning } from '../lib.mjs';

export async function run({ page, scratch, shot }) {
  await scratch.api('POST', '/api/projects', { name: 'menu-demo', noProjectConventions: true });
  const wt = await createWorktree(scratch, 'menu-demo', 'feat');
  const label = `menu-demo/${wt.name}`;
  await page.goto(scratch.url);
  await page.getByRole('tab', { name: 'Projects' }).click();

  // Opens `Open terminal` from the ⋮ of a sidebar row (`selector` finds the row) and returns the plugin frame.
  async function openTerminal(row, trigger) {
    await row.hover();
    await row.getByRole('button', { name: trigger, exact: true }).click();
    await page.getByRole('group', { name: 'Code Terminal' }).getByRole('menuitem', { name: 'Open terminal' }).click();
    return page.frameLocator('iframe[data-plugin-frame]');
  }
  const projectRow = page.locator('[data-project-row="menu-demo"]');
  const worktreeRow = () => page.locator(`[data-worktree-row="${wt.name}"]`);
  await projectRow.waitFor();
  await page.getByRole('button', { name: /^Worktrees/ }).click();
  await worktreeRow().waitFor();

  // Worktree row: the worktree's tab, one shell, running in the worktree.
  const frame = await openTerminal(worktreeRow(), 'Worktree menu');
  await until(async () => (await activeTab(frame).innerText().catch(() => '')) === label, `the ${label} tab to be active`);
  await waitRunning(panes(frame).first());
  assert.equal(await cwdName(page, panes(frame).first()), path.basename(wt.path));
  await shot('menu-1-worktree.png');

  // Project row: the same frame retargets in place (no reload) to the main checkout.
  await frame.locator('body').evaluate(() => { window.__menuMark = 1; });
  await openTerminal(projectRow, 'Project menu');
  await until(async () => (await activeTab(frame).innerText().catch(() => '')) === 'menu-demo', 'the menu-demo tab to be active');
  await waitRunning(panes(frame).first());
  assert.equal(await frame.locator('body').evaluate(() => window.__menuMark), 1, 'the plugin frame was reloaded');
  assert.deepEqual(await frame.getByRole('tab').allInnerTexts(), [label, 'menu-demo']);
  assert.equal(await cwdName(page, panes(frame).first()), 'menu-demo');
  await shot('menu-2-project-retarget.png');

  // Worktree again: its tab is reused, with no extra shell.
  const shells = await panes(frame).count();
  await openTerminal(worktreeRow(), 'Worktree menu');
  await until(async () => (await activeTab(frame).innerText().catch(() => '')) === label, 'the worktree tab to be reused');
  await waitRunning(panes(frame).first());
  assert.equal((await frame.getByRole('tab').allInnerTexts()).length, 2);
  assert.equal(await panes(frame).count(), shells);

  // An unknown, markup-bearing name is text in an alert; the stored tabs stay.
  await page.goto(`${scratch.pluginBase}?ccProject=${encodeURIComponent('<b>nope</b>')}`);
  const alert = page.getByRole('alert');
  await alert.waitFor();
  assert.ok((await alert.innerText()).includes('<b>nope</b>'));
  assert.equal(await page.locator('.alert b').count(), 0);
  assert.deepEqual(await page.getByRole('tab').allInnerTexts(), [label, 'menu-demo']);
  await shot('menu-3-invalid.png');
}
