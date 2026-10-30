// The terminal's colours from the host's tokens. xterm does not parse oklch, so
// each token is resolved to rgb by painting one canvas pixel. ANSI 0-15 keep
// xterm's defaults.
import type { ITheme } from '@xterm/xterm';

export const TERMINAL_FONT = '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';

const hex = (n: number) => n.toString(16).padStart(2, '0');

function resolver() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const style = getComputedStyle(document.documentElement);
  return (token: string, fallback: string): string => {
    const value = style.getPropertyValue(token).trim();
    if (!ctx || !value) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fallback;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? '' : hex(a)}`;
  };
}

export function terminalTheme(): ITheme {
  const color = resolver();
  const dark = document.documentElement.classList.contains('dark');
  const background = color('--background', dark ? '#1b1917' : '#fdfcfb');
  return {
    background,
    foreground: color('--foreground', dark ? '#f2f1f0' : '#1f1b18'),
    cursor: color('--primary', '#d9714f'),
    cursorAccent: background,
    selectionBackground: color('--ring', '#d9714f80'),
  };
}

// Calls `apply` whenever the page's theme flips (the bridge toggles <html>'s class).
export function onThemeChange(apply: () => void): () => void {
  const obs = new MutationObserver(apply);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-cc-theme'] });
  return () => obs.disconnect();
}
