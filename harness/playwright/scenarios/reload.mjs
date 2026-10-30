// Output in two panes survives a browser reload: both reattach, the latest
// output is visible, and scrolling up shows the earliest lines.
import assert from 'node:assert/strict';
import { newShell, openProject, panes, splitPane, typeLine, until, waitRunning, waitText, paneText } from '../lib.mjs';

export async function run({ page, scratch, shot }) {
  await scratch.api('POST', '/api/projects', { name: 'reload-demo', noProjectConventions: true });
  await openProject(page, scratch, 'reload-demo');
  const a = await newShell(page, 'reload-demo');
  const b = await splitPane(page, a, 'Split side by side');
  const nonce = `NONCE${Date.now()}`;
  for (const [i, pane] of [a, b].entries()) {
    await typeLine(page, pane, `seq 1 2000; echo ${nonce}-${i}-done`);
    await waitText(pane, new RegExp(`^${nonce}-${i}-done`, 'm'), `nonce in pane ${i}`);
  }
  await shot('reload-1-before.png');

  await page.reload();
  await until(async () => (await panes(page).count()) === 2, 'both panes after reload');
  for (let i = 0; i < 2; i++) {
    const pane = panes(page).nth(i);
    await waitRunning(pane);
    await waitText(pane, new RegExp(`^${nonce}-${i}-done`, 'm'), `nonce in pane ${i} after reload`);
  }
  await shot('reload-2-after.png');

  // Scroll the first pane to the top of its scrollback.
  const first = panes(page).nth(0);
  await first.locator('.pane-terminal').hover();
  await until(async () => {
    for (let k = 0; k < 25; k++) await page.mouse.wheel(0, -5000);
    return /^1\n2\n3\n/m.test(await paneText(first));
  }, 'the earliest lines in scrollback', 60000);
  assert.match(await paneText(first), /^1\n2\n3\n/m);
  await shot('reload-3-scrolled-top.png');
}
