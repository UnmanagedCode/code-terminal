// A phone-sized touch page: the extra-keys bar, its modifiers and arrows reach the shell,
// and tapping the bar never moves focus off the terminal's textarea.
import assert from 'node:assert/strict';
import { newShell, openProject, typeLine, waitText, waitUnwrapped, until } from '../lib.mjs';

export const contextOptions = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };

export async function run({ page, scratch, shot }) {
  await scratch.api('POST', '/api/projects', { name: 'mobile-demo', noProjectConventions: true });
  await openProject(page, scratch, 'mobile-demo');
  assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true, 'touch emulation yields (hover: none)');
  const pane = await newShell(page);
  const bar = pane.getByRole('toolbar', { name: 'Extra keys' });
  await bar.waitFor();
  const textarea = pane.locator('.xterm-helper-textarea');
  for (const [attr, value] of [['autocapitalize', 'off'], ['autocorrect', 'off'], ['autocomplete', 'off'], ['spellcheck', 'false']]) {
    assert.equal(await textarea.getAttribute(attr), value, attr);
  }
  await shot('mobile-1-bar.png');

  const tap = async (name) => {
    await bar.getByRole('button', { name, exact: true }).tap();
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'xterm-helper-textarea', `focus stays on the textarea after ${name}`);
  };
  await textarea.focus();

  await typeLine(page, pane, 'sleep 100');
  await tap('Control');
  await page.keyboard.type('c');
  await typeLine(page, pane, 'echo after-int');
  await waitText(pane, /^after-int$/m, 'the prompt after Ctrl+C');

  await tap('Up arrow');
  await waitUnwrapped(pane, /\$ echo after-int\s*$/, 'the recalled command');
  await page.keyboard.press('Control+u');

  await tap('Control');
  await tap('Control');
  await until(async () => (await bar.getByRole('button', { name: 'Control' }).getAttribute('data-mod-state')) === 'locked', 'Ctrl to lock');
  await shot('mobile-2-locked.png');
  await tap('Control');
  assert.equal(await bar.getByRole('button', { name: 'Control' }).getAttribute('data-mod-state'), 'off');

  await typeLine(page, pane, "printf '\\e[?1h'; cat -v");
  await tap('Up arrow');
  await waitText(pane, '^[OA', 'application-cursor Up as ^[OA');
  await shot('mobile-3-app-cursor.png');
}
