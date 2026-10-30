// The plugin's REST surface under `/api` (docs/protocol.md → REST). Every route
// passes the request guard; state-changing ones also need a JSON content type.
import express from 'express';
import { LAYOUT_MAX_BYTES } from '../shared/layout.js';
import { Refusal } from './refusal.js';
import { requestRefusal } from './requestGuard.js';
import { isDim } from './session.js';
import { validProjectName } from './shellLaunch.js';

const JSON_TYPE_RE = /^application\/json\s*(;|$)/i;

function projectView(row, terminal) {
  return {
    name: row.name,
    path: row.path,
    system: row.system ?? 'local',
    remoteId: row.remoteId ?? null,
    worktrees: (row.worktrees ?? []).map((w) => ({ name: w.worktreeName, path: w.worktreePath, branch: w.branch ?? null })),
    terminal,
  };
}

function parseCreate(body) {
  const { project, worktree, cols, rows } = body ?? {};
  if (!validProjectName(project)) return 'project must be a project name';
  if (worktree !== null && (typeof worktree !== 'string' || worktree === '')) return 'worktree must be a worktree name or null';
  if (!isDim(cols) || !isDim(rows)) return 'cols and rows must be integers in 1..4096';
  return null;
}

// `host` is null when the backend runs standalone; otherwise {cc, manager, probe, layouts}.
export function createApi({ host, listenPort, log }) {
  const router = express.Router();
  const fail = (res, status, code, error) => res.status(status).json({ code, error });
  const route = (fn) => (req, res, next) => fn(req, res).catch((e) => (e instanceof Refusal ? fail(res, e.status, e.code, e.error) : next(e)));

  router.use((req, res, next) => {
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    const why = requestRefusal(req.headers, listenPort(), { requireOrigin: mutating });
    if (why) {
      log.warn(`refused ${req.method} ${req.originalUrl}: ${why}`);
      return fail(res, 403, 'REQUEST_REFUSED', `request refused: ${why}`);
    }
    if (mutating && !JSON_TYPE_RE.test(req.headers['content-type'] ?? '')) {
      return fail(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'a state-changing request must be sent as application/json');
    }
    if (!host) return fail(res, 503, 'HOST_UNAVAILABLE', 'Code Terminal works only when opened through code-conductor');
    next();
  });
  router.use(express.json({ limit: LAYOUT_MAX_BYTES }));

  router.get('/projects', route(async (_req, res) => {
    const rows = (await host.cc.listProjects()).filter((r) => !r.degraded && r.path);
    res.json({ projects: await Promise.all(rows.map(async (r) => projectView(r, await host.probe.status(r)))) });
  }));

  router.get('/sessions', (_req, res) => res.json({ sessions: host.manager.list() }));

  router.post('/sessions', route(async (req, res) => {
    const why = parseCreate(req.body);
    if (why) throw new Refusal(400, 'INVALID_ARGUMENT', why);
    const { project, worktree, cols, rows } = req.body;
    const s = await host.manager.create({ project, worktree, cols, rows });
    res.status(201).json({ id: s.id });
  }));

  router.delete('/sessions/:id', (req, res) => {
    if (!host.manager.kill(req.params.id)) return fail(res, 404, 'SESSION_UNKNOWN', 'no such session');
    res.status(204).end();
  });

  router.get('/layouts/:project', route(async (req, res) => {
    res.json({ tree: await host.layouts.get(req.params.project) });
  }));

  router.put('/layouts/:project', route(async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || !('tree' in req.body)) throw new Refusal(400, 'INVALID_ARGUMENT', 'body must be {tree}');
    await host.layouts.put(req.params.project, req.body.tree);
    res.status(204).end();
  }));

  router.use((err, _req, res, next) => {
    if (err.type === 'entity.too.large') return fail(res, 413, 'LAYOUT_TOO_LARGE', `body over ${LAYOUT_MAX_BYTES} bytes`);
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'INVALID_ARGUMENT', 'body is not JSON');
    next(err);
  });
  router.use((_req, res) => fail(res, 404, 'NOT_FOUND', 'no such route'));
  return router;
}
