import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.join(here, 'frontend', 'dist');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";
// Only these files are served from dist: a letter/digit-led name with one of these extensions, at the root or under assets/.
const ASSET_RE = /^\/((?:assets\/)?[A-Za-z0-9][A-Za-z0-9_-]*\.(html|js|css|svg|png|ico|webmanifest))$/;

// `distDir` is a test seam: the built UI to serve.
export function createServer({ distDir = DEFAULT_DIST } = {}) {
  const built = () => fs.existsSync(path.join(distDir, 'index.html'));
  const inside = (rel) => {
    try {
      const root = fs.realpathSync(distDir);
      return fs.realpathSync(path.join(root, rel)).startsWith(root + path.sep);
    } catch { return false; }
  };

  const app = express();
  app.use((_req, res, next) => {
    res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let p;
    try { p = decodeURIComponent(req.path); } catch { return next(); }
    const m = p === '/' ? [p, 'index.html', 'html'] : ASSET_RE.exec(p);
    if (!m) return next();
    if (!built()) {
      if (m[2] !== 'html') return next();
      console.error(`UI not built: ${path.join(distDir, 'index.html')} is missing — run npm install`);
      return res.status(503).type('text/plain').send('UI not built — run npm install');
    }
    if (!inside(m[1])) return next();
    res.sendFile(m[1], { root: distDir, dotfiles: 'deny' }, (err) => { if (err) next(err.status === 404 ? undefined : err); });
  });
  app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status ?? err.statusCode ?? 500;
    if (status === 500) console.error(err);
    res.status(status).type('text/plain').send(http.STATUS_CODES[status] ?? 'Error');
  });
  return http.createServer(app);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4000);
  createServer().listen(port, '127.0.0.1', () => console.log(`code-shell listening on http://127.0.0.1:${port}`));
}
