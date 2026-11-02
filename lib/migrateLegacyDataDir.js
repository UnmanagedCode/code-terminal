import fs from 'node:fs';
import path from 'node:path';

// One-shot boot migration: a store kept in the projects root moves, whole, into the plugin data dir.
// A rename keeps the history files, modes and installed integration. Idempotent: no legacy dir, no work.
export function migrateLegacyDataDir({ projectsRoot, dataDir, log }) {
  if (!projectsRoot) return;
  const legacy = path.join(projectsRoot, '.code-terminal');
  let st;
  try {
    st = fs.lstatSync(legacy);
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  if (!st.isDirectory()) {
    throw new Error(`code-terminal: ${legacy} is not a directory; move or remove it by hand, then restart the plugin`);
  }
  let entries = [];
  try {
    entries = fs.readdirSync(dataDir);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (entries.length) {
    throw new Error(`code-terminal: both ${legacy} and ${dataDir} exist and ${dataDir} is not empty; merge or remove one by hand, then restart the plugin`);
  }
  try {
    fs.mkdirSync(path.dirname(dataDir), { recursive: true, mode: 0o700 });
    fs.renameSync(legacy, dataDir);
  } catch (e) {
    const hint = e.code === 'EXDEV' ? ' (on different filesystems; move it by hand)' : '';
    throw new Error(`code-terminal: cannot move ${legacy} to ${dataDir}: ${e.message}${hint}`, { cause: e });
  }
  log.log(`code-terminal: moved ${legacy} to ${dataDir}`);
}
