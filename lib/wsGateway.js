// WebSocket upgrades: only `/api/sessions/<id>/io`, guard first, then lookup,
// then attach (docs/protocol.md → Session I/O).
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { requestRefusal } from './requestGuard.js';
import { SECURITY_HEADERS } from './securityHeaders.js';

// The largest message a browser may send; pastes are split upstream.
export const BROWSER_MAX_PAYLOAD_BYTES = 1024 * 1024;
const IO_RE = /^\/api\/sessions\/([^/]+)\/io$/;

function refuse(socket, status) {
  const headers = Object.entries(SECURITY_HEADERS).map(([k, v]) => `${k}: ${v}\r\n`).join('');
  try { socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\n${headers}Content-Length: 0\r\nConnection: close\r\n\r\n`); } catch { /* gone */ }
  socket.destroy();
}

export function createWsGateway({ manager, listenPort, log }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: BROWSER_MAX_PAYLOAD_BYTES, perMessageDeflate: false, clientTracking: false });
  return function handleUpgrade(req, socket, head) {
    socket.on('error', () => {});
    const why = requestRefusal(req.headers, listenPort(), { requireOrigin: true });
    if (why) {
      log.warn(`refused upgrade ${req.url}: ${why}`);
      return refuse(socket, 403);
    }
    const u = new URL(req.url ?? '', 'http://placeholder');
    const m = IO_RE.exec(u.pathname);
    const session = m && manager?.get(m[1]);
    if (!session) return refuse(socket, 404);
    const cols = Number(u.searchParams.get('cols'));
    const rows = Number(u.searchParams.get('rows'));
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.binaryType = 'nodebuffer';
      session.attach(ws, { cols, rows });
    });
  };
}
