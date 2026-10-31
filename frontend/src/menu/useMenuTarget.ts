import { useEffect, useRef, useState } from 'react';
import type { ProjectInfo } from '../api';
import type { Checkout } from '../checkout';
import { replaceRoute } from '../route';
import { readMenuTarget, resolveMenuTarget, type MenuTarget } from './target';

type Options = {
  active(): Checkout | null;
  // A fresh project listing; also updates the page's own copy.
  refresh(): Promise<ProjectInfo[]>;
  open(c: Checkout, projects: ProjectInfo[]): void;
  report(message: string): void;
};

// Opens the checkout code-conductor's row ⋮ "Open terminal" names, on load and on cc's
// navigate (a popstate). The params are read during the first render: `useTabs`'s mount
// effect rewrites the URL, and would erase them first.
export function useMenuTarget(o: Options): void {
  const [initial] = useState(() => readMenuTarget());
  const opts = useRef(o);
  opts.current = o;

  useEffect(() => {
    let latest = 0;
    let live = true;
    const consume = (t: MenuTarget) => {
      // Replaced before validating, so a reload or Back never repeats the click.
      replaceRoute(opts.current.active());
      const seq = ++latest;
      opts.current.refresh().then((list) => {
        if (!live || seq !== latest) return;
        const r = resolveMenuTarget(list, t);
        if (r.ok) opts.current.open(r.checkout, list);
        else opts.current.report(r.message);
      }, (e) => {
        if (live && seq === latest) opts.current.report(e instanceof Error ? e.message : String(e));
      });
    };
    if (initial) consume(initial);
    const onPop = () => {
      const t = readMenuTarget();
      if (t) consume(t);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      live = false;
      window.removeEventListener('popstate', onPop);
    };
  }, [initial]);
}
