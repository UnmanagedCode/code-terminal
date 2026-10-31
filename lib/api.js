// The plugin's REST surface under `/api` (docs/protocol.md → REST). Standalone
// every route answers 503; otherwise every route passes the request guard and
// state-changing ones also need a JSON content type.
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
    workspace: row.workspace ?? null,
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

// The checkout a request names: `:project` plus an optional `?worktree=` (absent: the main checkout).
function parseCheckout(req) {
  const { worktree } = req.query;
  if (worktree !== undefined && (typeof worktree !== 'string' || !validProjectName(worktree))) {
    throw new Refusal(400, 'INVALID_ARGUMENT', 'worktree must be a worktree name');
  }
  if (!validProjectName(req.params.project)) throw new Refusal(400, 'INVALID_ARGUMENT', 'project must be a project name');
  return { project: req.params.project, worktree: worktree ?? null };
}

// `host` is null when the backend runs standalone; otherwise {cc, manager, probe, layouts}.
export function createApi({ host, listenPort, log }) {
  const router = express.Router();
  const fail = (res, status, code, error) => res.status(status).json({ code, error });
  const route = (fn) => (req, res, next) => fn(req, res).catch((e) => (e instanceof Refusal ? fail(res, e.status, e.code, e.error) : next(e)));

  router.use((req, res, next) => {
    // Standalone there is nothing to act on or read, and the page itself is
    // opened on this backend's port, which the guard refuses.
    if (!host) return fail(res, 503, 'HOST_UNAVAILABLE', 'Code Terminal works only when opened through code-conductor');
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    const why = requestRefusal(req.headers, listenPort(), { requireOrigin: mutating });
    if (why) {
      log.warn(`refused ${req.method} ${req.originalUrl}: ${why}`);
      return fail(res, 403, 'REQUEST_REFUSED', `request refused: ${why}`);
    }
    if (mutating && !JSON_TYPE_RE.test(req.headers['content-type'] ?? '')) {
      return fail(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'a state-changing request must be sent as application/json');
    }
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
    res.json({ tree: await host.layouts.get(parseCheckout(req)) });
  }));

  router.put('/layouts/:project', route(async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || !('tree' in req.body)) throw new Refusal(400, 'INVALID_ARGUMENT', 'body must be {tree}');
    await host.layouts.put(parseCheckout(req), req.body.tree);
    res.status(204).end();
  }));

  // Closing a checkout's tab: kills every shell of it, including ones the page never listed, and drops its layout.
  router.delete('/checkouts/:project', route(async (req, res) => {
    const { project, worktree } = parseCheckout(req);
    host.manager.killCheckout(project, worktree);
    await host.layouts.remove({ project, worktree });
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
