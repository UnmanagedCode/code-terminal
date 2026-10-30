// Sent on every response the backend produces (docs/protocol.md → CSP).
// The two 'unsafe-inline' style parts are xterm.js's own: it renders colours
// and dimensions through a <style> element and style attributes, with no nonce
// hook. Scripts stay 'self' only.
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-elem 'self' 'unsafe-inline'",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const SECURITY_HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' };
