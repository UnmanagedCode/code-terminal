// Drives the plugin page in a scratch code-conductor through each scenario.
// Usage: node harness/playwright/run.mjs [scenario...]   (needs CC_PROJECTS_ROOT)
// Scenarios: split, reload, history, untrusted-output, tabs, menu, mobile. Screenshots go to harness/playwright/out/.
// Exits non-zero when any scenario fails or the page logs a CSP violation, error or dialog.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER } from './resolve.mjs';
import { startScratchCc } from '../scratch-cc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const ALL = ['split', 'reload', 'history', 'untrusted-output', 'tabs', 'menu', 'mobile'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
for (const n of names) if (!ALL.includes(n)) throw new Error(`unknown scenario ${n}; one of ${ALL.join(', ')}`);
fs.mkdirSync(out, { recursive: true });

const { launchBrowser } = await import(BROWSER);
const scratch = await startScratchCc();
let failed = 0;
try {
  const browser = await launchBrowser();
  try {
    for (const name of names) {
      const { run, contextOptions = {} } = await import(`./scenarios/${name}.mjs`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...contextOptions });
      const issues = { csp: [], errors: [], dialogs: [] };
      await context.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
      });
      context.on('console', (m) => { if (m.type() === 'error') issues.errors.push(m.text()); });
      context.on('weberror', (e) => issues.errors.push(String(e.error())));
      const page = await context.newPage();
      page.on('dialog', (d) => { issues.dialogs.push(d.message()); void d.dismiss(); });
      const shot = async (file) => {
        await page.screenshot({ path: path.join(out, file) });
        console.log(`  screenshot ${path.join(out, file)}`);
      };
      try {
        await run({ page, context, scratch, shot, issues });
        issues.csp.push(...await page.evaluate(() => window.__cspViolations));
        if (issues.csp.length) throw new Error(`CSP violations: ${issues.csp.join('; ')}`);
        if (issues.errors.length) throw new Error(`page errors: ${issues.errors.join('; ')}`);
        if (issues.dialogs.length) throw new Error(`dialogs: ${issues.dialogs.join('; ')}`);
        console.log(`PASS ${name}`);
      } catch (e) {
        failed++;
        console.log(`FAIL ${name}: ${e.stack ?? e}`);
        await page.screenshot({ path: path.join(out, `${name}-failure.png`) }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  await scratch.stop();
}
process.exit(failed ? 1 : 0);
