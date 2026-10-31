import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import { checkoutKey, type Checkout } from '../checkout';
import type { Layout } from './tree';

const SAVE_DEBOUNCE_MS = 300;

// Split layouts per checkout, loaded on demand and saved to the backend shortly
// after each change. `isOpen` says whether a checkout still has a tab: a change
// for one without is ignored, so a late action cannot write its layout back.
export function useLayouts(isOpen: (c: Checkout) => boolean, report: (e: unknown) => void) {
  const [layouts, setLayouts] = useState<Record<string, Layout | null>>({});
  const ref = useRef(layouts);
  const timers = useRef(new Map<string, { c: Checkout; timer: ReturnType<typeof setTimeout> }>());
  // Checkouts being closed: their changes stay in memory but are not saved.
  const held = useRef(new Set<string>());

  const ensureLayout = useCallback(async (c: Checkout): Promise<Layout | null> => {
    const key = checkoutKey(c);
    if (key in ref.current) return ref.current[key];
    const tree = await api.getLayout(c);
    if (!(key in ref.current)) {
      ref.current = { ...ref.current, [key]: tree };
      setLayouts(ref.current);
    }
    return ref.current[key];
  }, []);

  const unschedule = useCallback((key: string) => {
    clearTimeout(timers.current.get(key)?.timer);
    timers.current.delete(key);
  }, []);

  const save = useCallback((c: Checkout) => {
    const key = checkoutKey(c);
    unschedule(key);
    if (held.current.has(key) || !(key in ref.current)) return;
    api.putLayout(c, ref.current[key]).catch(report);
  }, [report, unschedule]);

  // Applies `fn` to a checkout's layout and saves it shortly after.
  const mutate = useCallback((c: Checkout, fn: (t: Layout | null) => Layout | null) => {
    if (!isOpen(c)) return;
    const key = checkoutKey(c);
    ref.current = { ...ref.current, [key]: fn(ref.current[key] ?? null) };
    setLayouts(ref.current);
    unschedule(key);
    if (!held.current.has(key)) timers.current.set(key, { c, timer: setTimeout(() => save(c), SAVE_DEBOUNCE_MS) });
  }, [isOpen, save, unschedule]);

  // Stops saving a checkout that is being closed (cancelling a pending save).
  const hold = useCallback((c: Checkout) => {
    const key = checkoutKey(c);
    held.current.add(key);
    unschedule(key);
  }, [unschedule]);
  // The close failed: saving resumes with the layout as it is now.
  const release = useCallback((c: Checkout) => {
    held.current.delete(checkoutKey(c));
    save(c);
  }, [save]);
  // The close succeeded: forgets the layout for good.
  const drop = useCallback((c: Checkout) => {
    const key = checkoutKey(c);
    unschedule(key);
    held.current.delete(key);
    const { [key]: _gone, ...rest } = ref.current;
    ref.current = rest;
    setLayouts(ref.current);
  }, [unschedule]);

  // A save still waiting out its debounce is sent now when the page goes away
  // (reload, navigation, closing the tab) or the app unmounts.
  useEffect(() => {
    const flush = () => { for (const { c } of [...timers.current.values()]) save(c); };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [save]);

  return { layouts, ref, ensureLayout, mutate, hold, release, drop };
}
