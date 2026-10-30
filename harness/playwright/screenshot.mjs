// Boots the plugin backend, screenshots the placeholder page, tears down.
// Usage: node harness/playwright/screenshot.mjs [out.png]   (needs CC_PROJECTS_ROOT)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';

const { bootServer, withPage } = await import(BROWSER);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.resolve(process.argv[2] ?? path.join(repo, 'harness', 'playwright', 'out', 'home.png'));
fs.mkdirSync(path.dirname(out), { recursive: true });

const srv = await bootServer({ cwd: repo, entry: 'server.js' });
try {
  await withPage(async (page) => {
    await page.goto(srv.url);
    await page.getByRole('heading', { name: 'Code Shell' }).waitFor();
    await page.screenshot({ path: out });
  }, { viewport: { width: 1024, height: 640 } });
  console.log(`screenshot: ${out}`);
} finally {
  await srv.close();
}
