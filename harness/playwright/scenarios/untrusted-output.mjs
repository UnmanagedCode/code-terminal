// Hostile terminal output: OSC 52 cannot write the clipboard, a title is text,
// an OSC 8 javascript: link opens nothing, an http link opens a stub popup
// with no opener; vi and htop render; 256-colour and truecolor show.
import assert from 'node:assert/strict';
import { newShell, openProject, paneText, typeLine, until, waitText } from '../lib.mjs';

const STUB = 'http://stub.code-terminal.test/landing';

async function ctrlClickText(page, pane, text) {
  const span = pane.locator('.xterm-rows span', { hasText: text }).first();
  const box = await span.boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.click(box.x + 6, box.y + box.height / 2);
  await page.keyboard.up('Control');
}

export async function run({ page, context, scratch, shot, issues }) {
  await scratch.api('POST', '/api/projects', { name: 'untrusted-demo', noProjectConventions: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: scratch.url });
  await context.route('http://stub.code-terminal.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>stub</p>' }));
  const popups = [];
  context.on('page', (p) => popups.push(p));

  await openProject(page, scratch, 'untrusted-demo');
  const pane = await newShell(page, 'untrusted-demo');

  // OSC 52: the program asks to set the clipboard.
  await page.evaluate(() => navigator.clipboard.writeText('SENTINEL'));
  await typeLine(page, pane, `printf '\\033]52;c;%s\\a' "$(printf PWNED | base64)"; echo osc52-sent`);
  await waitText(pane, /^osc52-sent/m, 'osc52 sent');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'SENTINEL');

  // A title carrying markup.
  const title = '<img src=x onerror=alert(1)>';
  await typeLine(page, pane, `printf '\\033]0;%s\\a' '${title}'; echo title-sent`);
  await waitText(pane, /^title-sent/m, 'title sent');
  await until(async () => (await pane.locator('.pane-title').innerText()) === title, 'the title as text');
  assert.equal(await page.locator('img').count(), 0);

  // OSC 8 links: javascript: must open nothing; http opens the stub with no opener.
  await typeLine(page, pane, "clear; printf '\\033]8;;javascript:alert(document.domain)\\aCLICKJS\\033]8;;\\a\\n'; echo " + STUB);
  await waitText(pane, STUB, 'links printed');
  await ctrlClickText(page, pane, 'CLICKJS');
  await page.waitForTimeout(300);
  assert.equal(popups.length, 0, 'a javascript: OSC 8 link opened a window');
  const popupWait = context.waitForEvent('page', { timeout: 10000 });
  await ctrlClickText(page, pane, 'stub.code-terminal.test');
  const popup = await popupWait;
  await popup.waitForLoadState();
  assert.equal(popup.url(), STUB);
  assert.equal(await popup.evaluate(() => window.opener), null);
  await popup.close();
  await shot('untrusted-1-output.png');

  // Full-screen programs and colours.
  await typeLine(page, pane, 'clear; vi -u NONE /tmp/code-terminal-vi-demo.txt');
  await waitText(pane, /code-terminal-vi-demo\.txt/, 'vi open');
  await page.keyboard.type('ihello from vi');
  await page.keyboard.press('Escape');
  await waitText(pane, /^hello from vi/m, 'the text typed into vi');
  await shot('untrusted-2-vi.png');
  await page.keyboard.type(':q!');
  await page.keyboard.press('Enter');
  await typeLine(page, pane, 'clear; htop');
  await waitText(pane, /F10|Quit/, 'htop open');
  await shot('untrusted-3-htop.png');
  await page.keyboard.press('q');
  await typeLine(page, pane, 'clear; for i in $(seq 0 255); do printf "\\033[48;5;%sm  " $i; [ $((i % 32)) = 31 ] && printf "\\033[0m\\n"; done; for i in $(seq 0 4 255); do printf "\\033[48;2;%s;80;%sm " $i $((255 - i)); done; printf "\\033[0m\\ncolours-done\\n"');
  await waitText(pane, /^colours-done/m, 'colours printed');
  await shot('untrusted-4-colours.png');
  assert.ok(!(await paneText(pane)).includes('PWNED'));
  assert.deepEqual(issues.dialogs, [], 'a dialog opened');
}
