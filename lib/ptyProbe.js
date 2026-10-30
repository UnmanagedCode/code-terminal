// Whether a System can open terminals, learned by opening one: cc has no other
// way to ask (docs/architecture.md → Pty probe). One probe per (system, remoteId),
// kept for the process lifetime; real opens keep the answer current.
const PROBE_ARGV = ['sh', '-c', 'exit 0'];

const keyOf = (place) => JSON.stringify([place.system ?? 'local', place.remoteId ?? null]);

// The cached verdict a refusal means, or null for one that says nothing lasting
// about the System (a busy limit, an unknown project, a spawn failure).
function verdictOf(e) {
  if (e.status === 501) return { state: 'unavailable', code: e.code, reason: e.error };
  if (e.status === 502) return { state: 'unreachable', code: e.code, reason: e.error };
  return null;
}

export function createPtyProbe({ cc, log }) {
  const verdicts = new Map();
  const inflight = new Map();

  async function probe(row) {
    try {
      const ws = await cc.openTerminal({ project: row.name, argv: PROBE_ARGV, cols: 1, rows: 1 });
      ws.on('error', () => {});
      ws.close();
      return { state: 'available' };
    } catch (e) {
      const v = verdictOf(e);
      if (!v) log.warn(`pty probe on system '${row.system}' via project '${row.name}': ${e.message}`);
      return v ?? { state: 'unknown', code: e.code ?? null, reason: e.error ?? e.message, transient: true };
    }
  }

  return {
    // The verdict for a `GET /api/projects` row.
    async status(row) {
      if (row.systemUnreachable) return { state: 'unreachable', code: null, reason: row.systemUnreachable };
      const key = keyOf(row);
      if (verdicts.has(key)) return verdicts.get(key);
      if (!inflight.has(key)) {
        inflight.set(key, probe(row).then((v) => {
          inflight.delete(key);
          if (!v.transient) verdicts.set(key, v);
          return v;
        }));
      }
      const { transient, ...v } = await inflight.get(key);
      return v;
    },
    noteRefusal(place, e) {
      const v = verdictOf(e);
      if (v) verdicts.set(keyOf(place), v);
    },
    noteSuccess(place) {
      verdicts.set(keyOf(place), { state: 'available' });
    },
  };
}
