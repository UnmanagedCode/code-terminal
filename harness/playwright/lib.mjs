// Page helpers shared by the scenarios: they drive the plugin page the way a
// person does (tabs, the picker, typing into a pane) and read xterm's DOM rows.

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

export const activeTab = (page) => page.getByRole('tab', { selected: true });

// Opens the page on a project's main checkout through the route (the `?project=` link) and waits for its tab.
export async function openProject(page, scratch, project) {
  await page.goto(`${scratch.pluginBase}?project=${encodeURIComponent(project)}`);
  await page.getByRole('tab', { name: project, exact: true }).waitFor();
}

export async function waitRunning(pane) {
  await until(async () => (await pane.getAttribute('data-state')) === 'running', 'a running pane');
}

// Opens a shell from the empty checkout's New shell button; resolves the new (focused) pane, running.
export async function newShell(page) {
  const before = await panes(page).count();
  await page.getByRole('button', { name: 'New shell' }).click();
  await until(async () => (await panes(page).count()) === before + 1, 'a new pane');
  const id = await focusedPane(page).getAttribute('data-pane-id');
  const pane = paneById(page, id);
  await waitRunning(pane);
  return pane;
}

// Picks a checkout in the picker (the main checkout, or `worktree`); resolves once its tab is active.
export async function openCheckout(page, project, worktree = null) {
  await page.getByRole('button', { name: 'Open checkout' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Filter projects' }).fill(project);
  if (worktree) {
    await dialog.getByRole('button', { name: `Show checkouts of ${project}` }).click();
    await dialog.getByRole('list', { name: `Checkouts of ${project}` }).getByRole('button', { name: worktree }).click();
  } else {
    await dialog.getByRole('button', { name: project, exact: true }).click();
  }
  const label = worktree ? `${project}/${worktree}` : project;
  await until(async () => (await activeTab(page).innerText().catch(() => '')) === label, `the ${label} tab to be active`);
  await waitRunning(panes(page).first());
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

// Like waitText over the pane's text with its rows joined: a long command line soft-wraps at the pane's width.
export async function waitUnwrapped(pane, pattern, what = String(pattern), ms) {
  return until(async () => pattern.exec((await paneText(pane)).replaceAll('\n', '')), what, ms);
}

// Types a line into `pane`'s terminal.
export async function typeLine(page, pane, text) {
  await pane.locator('.pane-terminal').click();
  // A menu that just closed hands focus back to its trigger; keys typed before the terminal has it go astray.
  // On touch the hidden proxy takes the keys and xterm's own textarea is disabled.
  const input = pane.locator('textarea.xterm-helper-textarea:not(:disabled), input.xterm-touch-input');
  await until(() => input.evaluate((el) => el === el.ownerDocument.activeElement && el.ownerDocument.hasFocus()), 'the terminal to have focus');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

// The pane's working directory name, read from the shell itself. `page` is the real Page (its keyboard
// types into the focused frame); `pane` may come from a frame locator.
export async function cwdName(page, pane) {
  const tag = `CWD${Math.random().toString(36).slice(2, 7)}`;
  await typeLine(page, pane, `echo ${tag}=$(basename "$PWD")=`);
  return (await waitText(pane, new RegExp(`${tag}=([A-Za-z0-9._-]+)=`), `${tag} cwd`))[1];
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
