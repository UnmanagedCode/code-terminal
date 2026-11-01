import { useSyncExternalStore } from 'react';

export const TOUCH_QUERY = '(hover: none)';

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(TOUCH_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

const snapshot = () => window.matchMedia(TOUCH_QUERY).matches;

// True on devices whose primary input cannot hover (phones, tablets); follows changes live.
export function useTouchDevice(): boolean {
  return useSyncExternalStore(subscribe, snapshot);
}
