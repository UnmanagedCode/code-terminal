import { useCallback, useEffect, useRef, useState } from 'react';
import { checkoutKey, type Checkout } from '../checkout';
import { readRoute, writeRoute } from '../route';
import { loadTabs, saveTabs, tabsReducer, type TabsAction, type TabsState } from './tabs';

// The open tabs: restored from storage, with the URL's checkout opened (or
// activated) on top. Every change is persisted and mirrored into the URL, and
// the URL's checkout is opened on history navigation. `ref` is always the
// latest state, readable between renders.
export function useTabs() {
  const ref = useRef<TabsState>(null as unknown as TabsState);
  const [tabs, setTabs] = useState<TabsState>(() => {
    const route = readRoute();
    ref.current = route ? tabsReducer(loadTabs(), { type: 'open', checkout: route }) : loadTabs();
    return ref.current;
  });
  const dispatch = useCallback((a: TabsAction) => {
    ref.current = tabsReducer(ref.current, a);
    setTabs(ref.current);
  }, []);

  const active: Checkout | null = tabs.open[tabs.active] ?? null;
  const activeKey = active ? checkoutKey(active) : '';
  useEffect(() => { saveTabs(tabs); }, [tabs]);
  useEffect(() => { writeRoute(active); }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPop = () => {
      const route = readRoute();
      if (route) dispatch({ type: 'open', checkout: route });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dispatch]);

  return { tabs, ref, dispatch, active };
}
