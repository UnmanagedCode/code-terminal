// A phone-sized touch page: the extra-keys bar, its modifiers and arrows reach the shell,
// and tapping the bar never moves focus off the touch-input proxy, which takes the typing;
// a one-finger drag over the terminal scrolls the scrollback.
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
  const proxy = pane.locator('.xterm-touch-input');
  for (const [attr, value] of [['autocapitalize', 'off'], ['autocorrect', 'off'], ['autocomplete', 'off'], ['spellcheck', 'false']]) {
    assert.equal(await proxy.getAttribute(attr), value, attr);
  }
  assert.equal(await pane.locator('.xterm-helper-textarea').isDisabled(), true, 'xterm\'s own textarea is out of the touch path');
  await shot('mobile-1-bar.png');

  // A tap on the terminal puts focus on the proxy; typed text reaches the shell once.
  await pane.locator('.xterm-screen').tap();
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'xterm-touch-input', 'a tap focuses the proxy');
  await page.keyboard.insertText('echo caps-ok');
  await page.keyboard.press('Enter');
  await until(async () => (await proxy.inputValue()) === '', 'the proxy emptied after Enter');
  await waitText(pane, /^caps-ok$/m, 'the typed command output');
  assert.doesNotMatch(await pane.innerText(), /command not found/);

  const tap = async (name) => {
    await bar.getByRole('button', { name, exact: true }).tap();
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'xterm-touch-input', `focus stays on the proxy after ${name}`);
  };

  await typeLine(page, pane, 'sleep 100');
  await tap('Control');
  await page.keyboard.type('c');
  await typeLine(page, pane, 'echo after-int');
  await waitText(pane, /^after-int$/m, 'the prompt after Ctrl+C');

  await tap('Up arrow');
  await waitUnwrapped(pane, /\$ echo after-int\s*$/, 'the recalled command');
  await page.keyboard.press('Control+u');

  // Both taps in one burst: separate awaited tap() round trips could straddle DOUBLE_TAP_MS.
  const box = await bar.getByRole('button', { name: 'Control' }).boundingBox();
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await Promise.all([page.touchscreen.tap(x, y), page.touchscreen.tap(x, y)]);
  await until(async () => (await bar.getByRole('button', { name: 'Control' }).getAttribute('data-mod-state')) === 'locked', 'Ctrl to lock');
  await shot('mobile-2-locked.png');
  await tap('Control');
  assert.equal(await bar.getByRole('button', { name: 'Control' }).getAttribute('data-mod-state'), 'off');

  await typeLine(page, pane, "printf '\\e[?1h'; cat -v");
  await tap('Up arrow');
  await waitText(pane, '^[OA', 'application-cursor Up as ^[OA');
  await shot('mobile-3-app-cursor.png');
  await page.keyboard.press('Control+c');

  // The proxy's focus and blur reach xterm: DECSET 1004 reports arrive through the disabled textarea.
  await typeLine(page, pane, "printf '\\e[?1004h'; echo mode-set; cat -v");
  await waitText(pane, /^mode-set$/m, 'DECSET 1004 to be on');
  await proxy.evaluate((el) => el.blur());
  await proxy.focus();
  await waitText(pane, '^[[O', 'the focus-out report');
  await waitText(pane, '^[[I', 'the focus-in report');
  await shot('mobile-4-focus-reports.png');

  // A one-finger drag scrolls the scrollback (xterm has no touch scrolling of its own) and focus stays.
  await page.keyboard.press('Control+c');
  await typeLine(page, pane, 'seq 1 300');
  await waitText(pane, /^300$/m, 'the end of seq');
  const rowsText = () => pane.locator('.xterm-rows').innerText();
  const cdp = await page.context().newCDPSession(page);
  const screen = (await pane.locator('.xterm-screen').boundingBox());
  const sx = screen.x + screen.width / 2;
  const drag = async (fromY, toY) => {
    const at = (y) => [{ x: sx, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(fromY) });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(fromY + ((toY - fromY) * i) / 10) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const top = screen.y + 10;
  const bottom = screen.y + screen.height - 10;
  assert.match(await rowsText(), /\$/, 'the prompt is visible before the swipe');
  await drag(top, bottom);
  await until(async () => !/\$/.test(await rowsText()), 'a swipe down scrolled the prompt out of view');
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'xterm-touch-input', 'a swipe keeps focus on the proxy');
  await shot('mobile-5-scrolled.png');
  await drag(bottom, top);
  await drag(bottom, top);
  await until(async () => /\$/.test(await rowsText()), 'a swipe up brought the prompt back');
  await pane.locator('.xterm-screen').tap();
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'xterm-touch-input', 'a tap after a swipe focuses the proxy');
}
