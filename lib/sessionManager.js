// The registry of live sessions: opening one through cc, finding, listing and
// killing them.
import crypto from 'node:crypto';
import { Session } from './session.js';

export function createSessionManager({ cc, shellLaunch, probe, log }) {
  const sessions = new Map();

  return {
    async create({ project, worktree, cols, rows }) {
      const place = await cc.projectLocation(project);
      const spec = await shellLaunch.specFor({ project, worktree, cols, rows, system: place.system, remoteId: place.remoteId });
      let upstream;
      try {
        upstream = await cc.openTerminal(spec);
      } catch (e) {
        probe.noteRefusal(place, e);
        throw e;
      }
      probe.noteSuccess(place);
      const s = new Session({ id: crypto.randomUUID(), project, worktree, upstream, cols, rows, log });
      sessions.set(s.id, s);
      return s;
    },
    get: (id) => sessions.get(id),
    list: () => [...sessions.values()].map((s) => s.info),
    kill(id) {
      const s = sessions.get(id);
      if (!s) return false;
      sessions.delete(id);
      s.kill();
      return true;
    },
    closeAll() {
      for (const s of sessions.values()) s.kill();
      sessions.clear();
    },
  };
}
