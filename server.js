import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './lib/api.js';
import { createCcClient } from './lib/ccClient.js';
import { loadConfig } from './lib/config.js';
import { createLayoutStore } from './lib/layoutStore.js';
import { migrateLegacyDataDir } from './lib/migrateLegacyDataDir.js';
import { createPtyProbe } from './lib/ptyProbe.js';
import { SECURITY_HEADERS } from './lib/securityHeaders.js';
import { createSessionManager } from './lib/sessionManager.js';
import { createShellLaunch } from './lib/shellLaunch.js';
import { createWsGateway } from './lib/wsGateway.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.join(here, 'frontend', 'dist');
// Only these files are served from dist: a letter/digit-led name with one of these extensions, at the root or under assets/.
const ASSET_RE = /^\/((?:assets\/)?[A-Za-z0-9][A-Za-z0-9_-]*\.(html|js|css|svg|png|ico|webmanifest))$/;

// Everything but `distDir`, `conductorUrl` and `dataDir` is a test seam. Without
// `conductorUrl`/`dataDir` the backend runs standalone (UI and health only).
export function createServer({ distDir = DEFAULT_DIST, conductorUrl = null, dataDir = null, log = console, shellLaunch } = {}) {
  const built = () => fs.existsSync(path.join(distDir, 'index.html'));
  const inside = (rel) => {
    try {
      const root = fs.realpathSync(distDir);
      return fs.realpathSync(path.join(root, rel)).startsWith(root + path.sep);
    } catch { return false; }
  };

  let server;
  const listenPort = () => server.address()?.port;
  let host = null;
  if (conductorUrl && dataDir) {
    const cc = createCcClient(conductorUrl);
    const probe = createPtyProbe({ cc, log });
    const manager = createSessionManager({ cc, shellLaunch: shellLaunch ?? createShellLaunch({ cc, dataDir }), probe, log });
    host = { cc, probe, manager, layouts: createLayoutStore(dataDir) };
  } else {
    log.warn('code-terminal: CONDUCTOR_URL is unset; running standalone (UI and health only)');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', createApi({ host, listenPort, log }));

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let p;
    try { p = decodeURIComponent(req.path); } catch { return next(); }
    const m = p === '/' ? [p, 'index.html', 'html'] : ASSET_RE.exec(p);
    if (!m) return next();
    if (!built()) {
      if (m[2] !== 'html') return next();
      log.error(`UI not built: ${path.join(distDir, 'index.html')} is missing — run npm install`);
      return res.status(503).type('text/plain').send('UI not built — run npm install');
    }
    if (!inside(m[1])) return next();
    res.sendFile(m[1], { root: distDir, dotfiles: 'deny' }, (err) => { if (err) next(err.status === 404 ? undefined : err); });
  });
  app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status ?? err.statusCode ?? 500;
    if (status === 500) log.error(err);
    res.status(status).type('text/plain').send(http.STATUS_CODES[status] ?? 'Error');
  });

  server = http.createServer(app);
  server.on('upgrade', createWsGateway({ manager: host?.manager ?? null, listenPort, log }));
  // A request node's parser rejects never reaches express; answer it with the same headers.
  server.on('clientError', (err, socket) => {
    if (!socket.writable) return socket.destroy();
    const status = err.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400;
    const headers = Object.entries(SECURITY_HEADERS).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\n${headers}Content-Length: 0\r\nConnection: close\r\n\r\n`);
  });
  // Closes every upstream terminal.
  server.shutdown = () => host?.manager.closeAll();
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  if (config.dataDir) migrateLegacyDataDir({ projectsRoot: process.env.PROJECTS_ROOT ?? null, dataDir: config.dataDir, log: console });
  const server = createServer({ conductorUrl: config.conductorUrl, dataDir: config.dataDir });
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => {
      server.shutdown();
      process.exit(0);
    });
  }
  server.listen(config.port, '127.0.0.1', () => console.log(`code-terminal listening on http://127.0.0.1:${config.port}`));
}
