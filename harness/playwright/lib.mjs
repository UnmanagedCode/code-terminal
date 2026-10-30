// Page helpers shared by the scenarios: they drive the plugin page the way a
// person does (sidebar buttons, typing into a pane) and read xterm's DOM rows.

export const panes = (page) => page.locator('section.pane');
export const focusedPane = (page) => page.locator('section.pane.pane-focused');
export const paneById = (page, id) => page.locator(`section.pane[data-pane-id="${id}"]`);

export async function until(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function openProject(page, scratch, project) {
  await page.goto(`${scratch.pluginBase}?project=${encodeURIComponent(project)}`);
  await page.getByRole('group', { name: project }).waitFor();
}

export async function waitRunning(pane) {
  await until(async () => (await pane.getAttribute('data-state')) === 'running', 'a running pane');
}

// Opens a shell from the sidebar; resolves the new (focused) pane, running.
export async function newShell(page, project) {
  const before = await panes(page).count();
  await page.getByRole('button', { name: `New shell in ${project}` }).click();
  await until(async () => (await panes(page).count()) === before + 1, 'a new pane');
  const id = await focusedPane(page).getAttribute('data-pane-id');
  const pane = paneById(page, id);
  await waitRunning(pane);
  return pane;
}

// Splits `pane` ('Split side by side' | 'Split stacked'); resolves the new pane, running.
export async function splitPane(page, pane, how) {
  const before = await panes(page).count();
  await pane.getByRole('button', { name: how }).click();
  await until(async () => (await panes(page).count()) === before + 1, 'the split pane');
  const id = await focusedPane(page).getAttribute('data-pane-id');
  const added = paneById(page, id);
  await waitRunning(added);
  return added;
}

export const paneText = (pane) => pane.locator('.xterm-rows').innerText();

export async function waitText(pane, pattern, what = String(pattern), ms) {
  return until(async () => {
    const text = await paneText(pane);
    return typeof pattern === 'string' ? text.includes(pattern) && text : pattern.exec(text);
  }, what, ms);
}

// Types a line into `pane`'s terminal.
export async function typeLine(page, pane, text) {
  await pane.locator('.pane-terminal').click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

// The pane's own `stty size`, compared by the caller with its data-rows/data-cols.
export async function sttySize(page, pane) {
  const tag = `SZ${Math.random().toString(36).slice(2, 7)}`;
  await typeLine(page, pane, `echo ${tag}=$(stty size)=`);
  const m = await waitText(pane, new RegExp(`${tag}=(\\d+) (\\d+)=`), `${tag} stty size`);
  return { rows: Number(m[1]), cols: Number(m[2]) };
}

export async function paneSize(pane) {
  return { rows: Number(await pane.getAttribute('data-rows')), cols: Number(await pane.getAttribute('data-cols')) };
}
