// Renders a layout tree recursively. A divider drag resizes live through the
// element's style (CSSOM) and commits the ratio on release.
import { useRef, useState, type ReactNode } from 'react';
import { clampRatio, type Layout, type Pane } from './tree';

type Props = {
  tree: Layout;
  path?: string;
  renderPane(pane: Pane): ReactNode;
  onRatio(path: string, ratio: number): void;
};

export function SplitView({ tree, path = '', renderPane, onRatio }: Props) {
  if (tree.kind === 'pane') return <>{renderPane(tree)}</>;
  return <SplitNode tree={tree} path={path} renderPane={renderPane} onRatio={onRatio} />;
}

function SplitNode({ tree, path, renderPane, onRatio }: Props & { tree: Extract<Layout, { kind: 'split' }>; path: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<number | null>(null);
  const ratio = live ?? tree.ratio;
  const row = tree.dir === 'row';

  const ratioAt = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return clampRatio(row ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height);
  };

  return (
    <div className={`split split-${tree.dir}`} ref={box}>
      <div className="split-child" style={{ flexBasis: `${ratio * 100}%` }}>
        <SplitView tree={tree.a} path={`${path}a`} renderPane={renderPane} onRatio={onRatio} />
      </div>
      <div
        className="split-divider"
        role="separator"
        aria-orientation={row ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={10}
        aria-valuemax={90}
        aria-label="Resize panes"
        tabIndex={0}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setLive(ratioAt(e)); }}
        onPointerMove={(e) => { if (live !== null) setLive(ratioAt(e)); }}
        onPointerUp={(e) => {
          if (live === null) return;
          const r = ratioAt(e);
          setLive(null);
          onRatio(path, r);
        }}
        onKeyDown={(e) => {
          const step = { ArrowLeft: -0.05, ArrowUp: -0.05, ArrowRight: 0.05, ArrowDown: 0.05 }[e.key];
          if (step === undefined) return;
          e.preventDefault();
          onRatio(path, clampRatio(tree.ratio + step));
        }}
      />
      <div className="split-child split-rest">
        <SplitView tree={tree.b} path={`${path}b`} renderPane={renderPane} onRatio={onRatio} />
      </div>
    </div>
  );
}
