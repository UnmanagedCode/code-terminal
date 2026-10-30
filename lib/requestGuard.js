// The one cross-site rule for every WebSocket upgrade and every `api/*` request
// (docs/protocol.md → Request guard).
//
// cc's proxy and code-hub replay the browser's Host and Origin unchanged and add
// no X-Forwarded-* header on an upgrade, so the only proof of where a request
// came from is Origin↔Host, compared by host and port under Origin's scheme
// (cc's `upgradeOriginAllowed` parse rules, so `https://pub` matches Host `pub`).
// Through any proxy, Host names the proxy's port; a Host naming this backend's
// own listen port is a direct dial, or DNS rebinding onto that port, and is
// refused. Rebinding onto cc's port is indistinguishable from a visit to cc and
// is not stopped here (docs/protocol.md → Request guard).

const defaultPort = (protocol) => (protocol === 'https:' ? 443 : 80);

// Why the request is refused, or null. `requireOrigin` is set for upgrades and
// state-changing requests; a GET may lack an Origin, but one it carries must match.
export function requestRefusal(headers, listenPort, { requireOrigin }) {
  const origin = headers.origin;
  let scheme = 'http:';
  let o = null;
  if (origin !== undefined) {
    try { o = new URL(origin); } catch { return 'Origin is not a URL'; }
    if ((o.protocol !== 'http:' && o.protocol !== 'https:') || o.origin !== origin) return 'Origin is not an http(s) origin';
    scheme = o.protocol;
  } else if (requireOrigin) {
    return 'no Origin';
  }
  const host = headers.host;
  if (!host) return 'no Host';
  let h;
  try { h = new URL(`${scheme}//${host}`); } catch { return 'Host is malformed'; }
  if (h.username || h.password || h.pathname !== '/' || h.search || h.hash) return 'Host is malformed';
  if (o && h.host !== o.host) return 'Origin does not match Host';
  const port = h.port === '' ? defaultPort(h.protocol) : Number(h.port);
  if (port === listenPort) return "Host names this backend's own port";
  return null;
}
