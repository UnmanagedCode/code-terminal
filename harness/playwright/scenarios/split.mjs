// Vertical then horizontal split; every pane's program size equals its rendered
// size; a divider drag resizes the program too.
import assert from 'node:assert/strict';
import { newShell, openProject, paneSize, panes, splitPane, sttySize, until } from '../lib.mjs';

export async function run({ page, scratch, shot }) {
  await scratch.api('POST', '/api/projects', { name: 'split-demo', noProjectConventions: true });
  await openProject(page, scratch, 'split-demo');
  const first = await newShell(page, 'split-demo');
  const second = await splitPane(page, first, 'Split side by side');
  await shot('split-1-vertical.png');
  const third = await splitPane(page, second, 'Split stacked');
  assert.equal(await panes(page).count(), 3);
  for (const pane of [first, second, third]) {
    assert.deepEqual(await sttySize(page, pane), await paneSize(pane));
  }
  await shot('split-2-horizontal.png');

  // Drag the side-by-side divider left; the first pane narrows, and so does its program.
  const before = await paneSize(first);
  const divider = page.getByRole('separator').first();
  const box = await divider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 250, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await until(async () => (await paneSize(first)).cols < before.cols, 'the first pane to narrow');
  assert.deepEqual(await sttySize(page, first), await paneSize(first));
  assert.deepEqual(await sttySize(page, second), await paneSize(second));
  await shot('split-3-dragged.png');
}
