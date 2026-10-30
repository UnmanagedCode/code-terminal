// A command run in alpha is in a second alpha shell's history and not in beta's.
import { newShell, openProject, splitPane, typeLine, waitText } from '../lib.mjs';

export async function run({ page, scratch, shot }) {
  await openProject(page, scratch, 'alpha');
  const a1 = await newShell(page, 'alpha');
  const nonce = `only-in-alpha-${Date.now()}`;
  await typeLine(page, a1, `echo ${nonce}`);
  await waitText(a1, new RegExp(`^${nonce}$`, 'm'), 'the echo output');

  await page.getByRole('button', { name: 'beta', exact: true }).click();
  const b = await newShell(page, 'beta');
  await b.locator('.pane-terminal').click();
  await page.keyboard.press('Control+r');
  await page.keyboard.type(nonce);
  await waitText(b, /failed reverse-i-search/, "beta's failed reverse search");
  await shot('history-1-beta-no-match.png');
  await page.keyboard.press('Control+c');

  await page.getByRole('button', { name: 'alpha', exact: true }).click();
  await waitText(a1, nonce, 'alpha pane back');
  const a2 = await splitPane(page, a1, 'Split side by side');
  await a2.locator('.pane-terminal').click();
  await page.keyboard.press('ArrowUp');
  await waitText(a2, new RegExp(`\\$ echo ${nonce}`), "the command at alpha's second prompt");
  await shot('history-2-alpha-arrow-up.png');
}
