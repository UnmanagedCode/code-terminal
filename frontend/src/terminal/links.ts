// One policy for every link in a terminal, web-links and OSC 8 alike: only an
// absolute http(s) URL opens, only on Ctrl/Cmd+click, in a new window that
// gets no opener and no referrer. Hovering shows the real target.

// `uri` as an href when it is an absolute http(s) URL; null otherwise. No base:
// a relative or protocol-relative `uri` throws and is refused.
export function safeLinkHref(uri: string): string | null {
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

type Open = (url: string, target: string, features: string) => unknown;

export function activateLink(event: MouseEvent, uri: string, open: Open = window.open.bind(window)): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  const href = safeLinkHref(uri);
  if (!href) return false;
  open(href, '_blank', 'noopener,noreferrer');
  return true;
}

export type LinkTip = { text: string; x: number; y: number } | null;

// The text shown while hovering a link: its real target, whatever text it is drawn as.
export function linkTip(event: MouseEvent, uri: string): LinkTip {
  const href = safeLinkHref(uri);
  return { text: href ? `${href} — Ctrl/Cmd+click to open` : `blocked link: ${uri.slice(0, 200)}`, x: event.clientX, y: event.clientY };
}
