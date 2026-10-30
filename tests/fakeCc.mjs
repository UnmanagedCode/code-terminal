// A small stand-in for code-conductor: `GET /api/projects`, `POST /api/exec` and the
// `GET /api/terminal` WebSocket, scripted per test. Injected through `conductorUrl`.
import { execFile } from 'node:child_process';
import http from 'node:http';
import { WebSocketServer } from 'ws';

export async function startFakeCc({ projects = [], exec, terminal } = {}) {
  const fake = {
    projects,
    // Every `/api/terminal` upgrade: {headers, spec}.
    opens: [],
    // Every accepted terminal: {spec, ws, input: Buffer[], control: object[], closed}.
    terminals: [],
    execs: [],
    // (spec, req) → {refuse: {status, body}} | undefined (accept).
    terminal: terminal ?? (() => undefined),
    // (body) → Promise<{status, body}>; default: run argv for real.
    exec: exec ?? runForReal,
  };
  const waiters = [];
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/api/projects') return send(200, fake.projects);
    const loc = /^\/api\/projects\/([^/]+)\/location$/.exec(req.url);
    if (req.method === 'GET' && loc) {
      const row = fake.projects.find((p) => p.name === decodeURIComponent(loc[1]));
      if (!row) return send(404, { error: `unknown project ${loc[1]}`, code: 'PROJECT_UNKNOWN' });
      return send(200, { name: row.name, system: row.system, remoteId: row.remoteId, path: row.path });
    }
    if (req.method === 'POST' && req.url === '/api/exec') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      fake.execs.push(body);
      const r = await fake.exec(body);
      return send(r.status, r.body);
    }
    send(404, { error: 'not found' });
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const u = new URL(req.url, 'http://x');
    const spec = JSON.parse(u.searchParams.get('spec') ?? 'null');
    fake.opens.push({ headers: req.headers, spec });
    const verdict = fake.terminal(spec, req);
    if (verdict?.refuse) {
      const json = JSON.stringify(verdict.refuse.body);
      socket.end(`HTTP/1.1 ${verdict.refuse.status} ${http.STATUS_CODES[verdict.refuse.status]}\r\n`
        + `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\nConnection: close\r\n\r\n${json}`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const t = { spec, ws, input: [], control: [], closed: null };
      ws.on('message', (data, isBinary) => {
        if (isBinary) t.input.push(Buffer.from(data));
        else t.control.push(JSON.parse(data.toString('utf8')));
      });
      ws.on('close', (code) => { t.closed = code; });
      fake.terminals.push(t);
      for (const w of waiters.splice(0)) w(t);
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  // The next terminal accepted from now on (or the latest if one is already waiting unclaimed).
  fake.nextTerminal = () => new Promise((r) => waiters.push(r));
  fake.close = async () => {
    for (const t of fake.terminals) t.ws.terminate();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  };
  return fake;
}

// `POST /api/exec` run on this machine: argv form only, env overlaid, cwd = the process cwd.
export function runForReal(body) {
  return new Promise((resolve) => {
    execFile(body.argv[0], body.argv.slice(1), { env: { ...process.env, ...body.env } }, (err, stdout, stderr) => {
      resolve({ status: 200, body: { exitCode: err ? (err.code ?? 1) : 0, stdout, stderr, encoding: 'utf8' } });
    });
  });
}

export function projectRow(name, { system = 'local', remoteId = null, path = `/projects/${name}`, worktrees = [] } = {}) {
  return { name, path, system, remoteId, worktrees };
}
