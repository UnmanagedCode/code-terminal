// Per-checkout split layouts, one JSON file each under `<dataDir>/layouts/`:
// `<project>/main.json` for the main checkout, `<project>/worktrees/<worktree>.json` for a worktree.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LAYOUT_MAX_BYTES, validateLayout } from '../shared/layout.js';
import { Refusal } from './refusal.js';
import { validProjectName } from './shellLaunch.js';

export function createLayoutStore(dataDir) {
  const dir = path.join(dataDir, 'layouts');
  const nameOk = (kind, name) => {
    if (!validProjectName(name)) throw new Refusal(400, 'INVALID_ARGUMENT', `${kind} name ${JSON.stringify(name)} is not usable as a file name`);
  };
  // A checkout is {project, worktree}; worktree null is the main checkout.
  const fileFor = ({ project, worktree }) => {
    nameOk('project', project);
    if (worktree === null) return path.join(dir, project, 'main.json');
    nameOk('worktree', worktree);
    return path.join(dir, project, 'worktrees', `${worktree}.json`);
  };

  return {
    async get(checkout) {
      const file = fileFor(checkout);
      let text;
      try { text = await fs.readFile(file, 'utf8'); } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
      const tree = JSON.parse(text);
      const why = validateLayout(tree);
      if (why) throw new Error(`stored layout ${file} is invalid: ${why}`);
      return tree;
    },

    // Atomic: written to a temp file and renamed over the old one.
    async put(checkout, tree) {
      const file = fileFor(checkout);
      const why = validateLayout(tree);
      if (why) throw new Refusal(400, 'INVALID_LAYOUT', `layout refused: ${why}`);
      const body = JSON.stringify(tree);
      if (Buffer.byteLength(body) > LAYOUT_MAX_BYTES) throw new Refusal(413, 'LAYOUT_TOO_LARGE', `layout refused: over ${LAYOUT_MAX_BYTES} bytes`);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, body, { mode: 0o600 });
        await fs.rename(tmp, file);
      } catch (e) {
        await fs.rm(tmp, { force: true });
        throw e;
      }
    },

    async remove(checkout) {
      await fs.rm(fileFor(checkout), { force: true });
    },
  };
}
