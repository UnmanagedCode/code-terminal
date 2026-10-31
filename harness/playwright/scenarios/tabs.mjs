// One tab per checkout: the picker opens a worktree and a main checkout, each
// shell runs in its tab's checkout, Ctrl+digit switches tabs through xterm, tabs
// and the URL survive a reload, closing a tab asks and kills its shells, and a
// deleted worktree leaves a closable tab.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createWorktree } from '../../scratch-cc.mjs';
import { activeTab, openCheckout, openProject, paneText, panes, typeLine, until, waitRunning, waitText } from '../lib.mjs';

const tabNames = (page) => page.getByRole('tab').allInnerTexts();

// The pane's working directory name, read from the shell itself.
async function cwdName(page, pane) {
  const tag = `CWD${Math.random().toString(36).slice(2, 7)}`;
  await typeLine(page, pane, `echo ${tag}=$(basename "$PWD")=`);
  return (await waitText(pane, new RegExp(`${tag}=([A-Za-z0-9._-]+)=`), `${tag} cwd`))[1];
}

// The picker's rows for `project`: main checkout and each worktree, with their badges' text.
async function pickerRows(page, project) {
  await page.getByRole('button', { name: 'Open checkout' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: `Show checkouts of ${project}` }).click();
  const rows = await dialog.getByRole('list', { name: `Checkouts of ${project}` }).getByRole('button').allInnerTexts();
  return { dialog, rows };
}
const closePicker = (page) => page.keyboard.press('Escape');

export async function run({ page, scratch, shot }) {
  await scratch.api('POST', '/api/projects', { name: 'tabs-demo', noProjectConventions: true });
  const wt = await createWorktree(scratch, 'tabs-demo', 'feat');
  await page.goto(scratch.pluginBase);
  await page.getByText('No checkout open.').waitFor();

  // Pick the worktree: a tab named for it, with a shell in the worktree.
  await page.getByRole('button', { name: 'Open checkout' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Filter projects' }).fill('tabs');
  await page.getByRole('dialog').getByRole('button', { name: 'Show checkouts of tabs-demo' }).click();
  await shot('tabs-1-picker.png');
  await page.keyboard.press('Escape');
  await openCheckout(page, 'tabs-demo', wt.name);
  const featLabel = `tabs-demo/${wt.name}`;
  assert.deepEqual(await tabNames(page), [featLabel]);
  assert.equal(await cwdName(page, panes(page).first()), path.basename(wt.path));

  // Pick the main checkout: a second tab, a shell in the project directory.
  await openCheckout(page, 'tabs-demo');
  assert.deepEqual(await tabNames(page), [featLabel, 'tabs-demo']);
  assert.equal(await cwdName(page, panes(page).first()), 'tabs-demo');
  await shot('tabs-2-two-tabs.png');

  // Each checkout shows one running shell; picking an open checkout only focuses it.
  await until(async () => {
    const { rows } = await pickerRows(page, 'tabs-demo');
    await closePicker(page);
    return rows.length === 2 && rows.every((r) => /1 running/.test(r));
  }, 'a running count of 1 on both checkouts');
  await openCheckout(page, 'tabs-demo', wt.name);
  assert.deepEqual(await tabNames(page), [featLabel, 'tabs-demo']);
  assert.equal(await activeTab(page).innerText(), featLabel);

  // Ctrl+digit switches tabs from inside a terminal, and no byte reaches the shell.
  await typeLine(page, panes(page).first(), 'echo MARK-ready');
  await waitText(panes(page).first(), /^MARK-ready/m, 'the marker line');
  const before = await paneText(panes(page).first());
  await page.keyboard.press('Control+2');
  await until(async () => (await activeTab(page).innerText()) === 'tabs-demo', 'Control+2 to open the second tab');
  await page.keyboard.press('Control+1');
  await until(async () => (await activeTab(page).innerText()) === featLabel, 'Control+1 to open the first tab');
  // The pane reattaches and replays; the replay is what was there before, with nothing typed into it.
  await until(async () => (await paneText(panes(page).first())) === before, `the replayed screen to equal the earlier one (the terminal received the keys?) ${JSON.stringify(before)}`);
  await page.keyboard.press('Control+9');
  await until(async () => (await activeTab(page).innerText()) === 'tabs-demo', 'Control+9 to open the last tab');
  await page.keyboard.press('Control+1');
  await until(async () => (await activeTab(page).innerText()) === featLabel, 'the first tab again');

  // A reload restores both tabs, the URL's one active, and the panes reattach.
  await page.reload();
  await page.getByRole('tab', { name: featLabel }).waitFor();
  assert.deepEqual(await tabNames(page), [featLabel, 'tabs-demo']);
  assert.equal(await activeTab(page).innerText(), featLabel);
  await waitRunning(panes(page).first());
  // The plain ?project= link is the main checkout's tab.
  await openProject(page, scratch, 'tabs-demo');
  assert.deepEqual(await tabNames(page), [featLabel, 'tabs-demo']);
  assert.equal(await activeTab(page).innerText(), 'tabs-demo');
  await waitRunning(panes(page).first());

  // Closing the worktree's tab asks, then kills its shell.
  await page.getByRole('button', { name: `Close ${featLabel}` }).click();
  await page.getByRole('button', { name: 'Kill shells and close' }).waitFor();
  await shot('tabs-3-confirm-close.png');
  await page.getByRole('button', { name: 'Kill shells and close' }).click();
  await until(async () => (await tabNames(page)).length === 1, 'the worktree tab to close');
  const sessions = await page.evaluate(async () => (await (await fetch('api/sessions')).json()).sessions);
  assert.deepEqual(sessions.filter((s) => s.project === 'tabs-demo').map((s) => s.worktree), [null], 'only the main checkout\'s shell is left');
  const { rows } = await pickerRows(page, 'tabs-demo');
  assert.ok(!/running/.test(rows[1]), `the closed checkout still shows a count: ${rows[1]}`);
  await closePicker(page);

  // Reopen the worktree, then delete it in cc: the tab stays, marked gone, and can be closed.
  await openCheckout(page, 'tabs-demo', wt.name);
  await scratch.api('DELETE', `/api/projects/tabs-demo/worktrees/${encodeURIComponent(wt.name)}?force=1`);
  await page.reload();
  await page.getByText(/no longer exists in code-conductor \(its worktree was deleted\)/).waitFor();
  await shot('tabs-4-gone.png');
  await page.getByRole('button', { name: 'Close tab', exact: true }).click();
  await page.getByRole('button', { name: 'Kill shells and close' }).click();
  await until(async () => (await tabNames(page)).length === 1, 'the gone tab to close');
  assert.equal(await activeTab(page).innerText(), 'tabs-demo');
  await shot('tabs-5-after-close.png');
}
