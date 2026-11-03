// One-finger drag scrolling for xterm, which has no touch scrolling of its own, and the
// `touch-action` that stops the browser panning (and chaining out of the plugin frame into
// cc's page, where a downward overscroll is a pull-to-refresh).
import type { Terminal } from '@xterm/xterm';

export type TouchScroll = { dispose(): void };

// `pinch-zoom` keeps two-finger zoom where supported; `none` still blocks the pan elsewhere.
function blockingTouchAction(): string {
  return typeof CSS !== 'undefined' && CSS.supports?.('touch-action', 'pinch-zoom') ? 'pinch-zoom' : 'none';
}

export function attachTouchScroll(t: Terminal, surface: HTMLElement): TouchScroll {
  const previous = surface.style.touchAction;
  surface.style.touchAction = blockingTouchAction();

  let lastY: number | null = null;
  let pending = 0;
  // A second finger ends the gesture until every finger is lifted, so a pinch never scrolls.
  let multi = false;

  const cellHeight = () => {
    const screen = t.element?.querySelector('.xterm-screen');
    return screen && t.rows ? screen.getBoundingClientRect().height / t.rows : 0;
  };
  const reset = () => { lastY = null; pending = 0; };

  const onStart = (e: TouchEvent) => {
    if (e.touches.length > 1) { multi = true; reset(); return; }
    if (multi) return;
    lastY = e.touches[0].clientY;
    pending = 0;
  };
  const onMove = (e: TouchEvent) => {
    if (e.touches.length > 1) { multi = true; reset(); return; }
    if (multi || lastY === null) return;
    const y = e.touches[0].clientY;
    pending += lastY - y;
    lastY = y;
    const h = cellHeight();
    if (h <= 0) return;
    const lines = Math.trunc(pending / h);
    if (lines === 0) return;
    pending -= lines * h;
    t.scrollLines(lines);
  };
  const onEnd = (e: TouchEvent) => {
    reset();
    if (e.touches.length === 0) multi = false;
  };

  const opts = { passive: true } as const;
  surface.addEventListener('touchstart', onStart, opts);
  surface.addEventListener('touchmove', onMove, opts);
  surface.addEventListener('touchend', onEnd, opts);
  surface.addEventListener('touchcancel', onEnd, opts);
  return {
    dispose() {
      surface.removeEventListener('touchstart', onStart);
      surface.removeEventListener('touchmove', onMove);
      surface.removeEventListener('touchend', onEnd);
      surface.removeEventListener('touchcancel', onEnd);
      surface.style.touchAction = previous;
      reset();
    },
  };
}
