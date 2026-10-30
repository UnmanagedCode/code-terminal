// Per-project split layouts, one JSON file each under `<dataDir>/layouts/`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { LAYOUT_MAX_BYTES, validateLayout } from '../shared/layout.js';
import { Refusal } from './refusal.js';
import { validProjectName } from './shellLaunch.js';

export function createLayoutStore(dataDir) {
  const dir = path.join(dataDir, 'layouts');
  const fileFor = (project) => {
    if (!validProjectName(project)) throw new Refusal(400, 'INVALID_ARGUMENT', `project name ${JSON.stringify(project)} is not usable as a file name`);
    return path.join(dir, `${project}.json`);
  };

  return {
    async get(project) {
      const file = fileFor(project);
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
    async put(project, tree) {
      const file = fileFor(project);
      const why = validateLayout(tree);
      if (why) throw new Refusal(400, 'INVALID_LAYOUT', `layout refused: ${why}`);
      const body = JSON.stringify(tree);
      if (Buffer.byteLength(body) > LAYOUT_MAX_BYTES) throw new Refusal(413, 'LAYOUT_TOO_LARGE', `layout refused: over ${LAYOUT_MAX_BYTES} bytes`);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(tmp, body, { mode: 0o600 });
        await fs.rename(tmp, file);
      } catch (e) {
        await fs.rm(tmp, { force: true });
        throw e;
      }
    },
  };
}
