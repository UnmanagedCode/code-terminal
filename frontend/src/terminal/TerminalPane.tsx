// One pane: an xterm.js terminal attached to a backend session, its header, and
// the session's state with Restart once it is over.
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { clampTitle, SCROLLBACK_LINES } from '../../../shared/terminal.js';
import { createSession } from '../api';
import { checkoutLabel, type Checkout } from '../checkout';
import type { Pane, SplitDir } from '../layout/tree';
import { CloseIcon, SplitColIcon, SplitRowIcon } from '../icons';
import { ExtraKeys } from './ExtraKeys';
import { keySequence, Modifiers, type ExtraKeyId } from './extraKeys';
import { attachClipboardKeys } from './keys';
import { activateLink, linkTip, type LinkTip } from './links';
import { connectSession, type ConnState, type Connection } from './socket';
import { disableTextAssist } from './softKeyboard';
import { attachTouchInput, type TouchInput } from './touchInput';
import { onThemeChange, terminalTheme, TERMINAL_FONT } from './theme';
import { useTouchDevice } from './useTouchDevice';


type Props = {
  checkout: Checkout;
  pane: Pane;
  focused: boolean;
  onFocus(): void;
  onSplit(dir: SplitDir): void;
  onClose(): void;
  onSessionReplaced(sessionId: string): void;
};

function fontsReady(): Promise<unknown> {
  return document.fonts?.load(`13px ${TERMINAL_FONT}`).catch(() => undefined) ?? Promise.resolve();
}

function stateText(s: ConnState): string | null {
  switch (s.kind) {
    case 'connecting': case 'running': return null;
    case 'reconnecting': return 'reconnecting…';
    case 'detached': return 'this shell is open in another window';
    case 'exited': return s.signal ? `exited (signal ${s.signal})` : `exited (code ${s.code})`;
    case 'failed': return `failed: ${s.error}`;
    case 'ended': return 'ended';
  }
}

const isOver = (s: ConnState) => s.kind === 'exited' || s.kind === 'failed' || s.kind === 'ended';

export function TerminalPane({ checkout, pane, focused, onFocus, onSplit, onClose, onSessionReplaced }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const conn = useRef<Connection | null>(null);
  const touchInput = useRef<TouchInput | null>(null);
  const [state, setState] = useState<ConnState>({ kind: 'connecting' });
  const [title, setTitle] = useState('');
  const [tip, setTip] = useState<LinkTip>(null);
  const [size, setSize] = useState({ cols: 0, rows: 0 });
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [opened, setOpened] = useState<Terminal | null>(null);
  const [mods] = useState(() => new Modifiers());
  const touch = useTouchDevice();

  useEffect(() => {
    const sessionId = pane.sessionId;
    if (!sessionId) {
      setState({ kind: 'ended' });
      return;
    }
    const hover = (e: MouseEvent, uri: string) => setTip(linkTip(e, uri));
    const leave = () => setTip(null);
    const t = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize: 13,
      scrollback: SCROLLBACK_LINES,
      cursorBlink: true,
      theme: terminalTheme(),
      // OSC 8 links: same policy as web links; non-http(s) schemes stay off.
      linkHandler: { activate: (e, uri) => { activateLink(e, uri); }, hover, leave, allowNonHttpProtocols: false },
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.loadAddon(new WebLinksAddon((e, uri) => { activateLink(e, uri); }, { hover, leave }));
    attachClipboardKeys(t);
    term.current = t;
    let disposed = false;
    let last = '';
    const measure = () => {
      try { fit.fit(); } catch { /* not laid out yet */ }
      setSize({ cols: t.cols, rows: t.rows });
      return { cols: t.cols, rows: t.rows };
    };
    t.onData((d) => conn.current?.sendInput(mods.apply(d)));
    t.onBinary((d) => conn.current?.sendInput(Uint8Array.from(d, (c) => c.charCodeAt(0))));
    t.onTitleChange((s) => setTitle(clampTitle(s)));
    void fontsReady().then(() => {
      if (disposed || !host.current) return;
      t.open(host.current);
      disableTextAssist(t.textarea);
      setOpened(t);
      const s = measure();
      last = `${s.cols}x${s.rows}`;
      conn.current = connectSession(sessionId, () => ({ cols: t.cols, rows: t.rows }), {
        onHello: (_state, initialTitle) => {
          t.reset();
          setTitle(clampTitle(initialTitle));
        },
        onBytes: (d) => t.write(d),
        onState: setState,
      });
    });
    const ro = new ResizeObserver(() => {
      if (!conn.current) return;
      const s = measure();
      const key = `${s.cols}x${s.rows}`;
      if (key !== last) {
        last = key;
        conn.current.resize(s.cols, s.rows);
      }
    });
    if (host.current) ro.observe(host.current);
    const offTheme = onThemeChange(() => { t.options.theme = terminalTheme(); });
    return () => {
      disposed = true;
      ro.disconnect();
      offTheme();
      conn.current?.close();
      conn.current = null;
      t.dispose();
      term.current = null;
      setOpened(null);
    };
  }, [pane.sessionId, mods]);

  useEffect(() => {
    if (!touch || !opened) return;
    const attached = attachTouchInput(opened);
    touchInput.current = attached;
    return () => {
      attached.dispose();
      touchInput.current = null;
    };
  }, [touch, opened]);

  useEffect(() => {
    if (focused) (touchInput.current ?? term.current)?.focus();
  }, [focused, state.kind, opened, touch]);

  function sendExtraKey(id: ExtraKeyId) {
    onFocus();
    if (id === 'ctrl' || id === 'alt') {
      mods.tap(id);
      return;
    }
    const t = term.current;
    if (t?.element) t.input(keySequence(id, t.modes.applicationCursorKeysMode));
  }

  async function restart() {
    setRestarting(true);
    setRestartError(null);
    try {
      const id = await createSession(checkout, { cols: size.cols || 80, rows: size.rows || 24 });
      onSessionReplaced(id);
    } catch (e) {
      setRestartError((e as Error).message);
    } finally {
      setRestarting(false);
    }
  }

  const note = stateText(state);
  const label = title || checkoutLabel(checkout);
  return (
    <section
      className={`pane${focused ? ' pane-focused' : ''}`}
      aria-label={`Shell: ${label}`}
      data-pane-id={pane.id}
      data-session-id={pane.sessionId ?? ''}
      data-state={state.kind}
      data-cols={size.cols}
      data-rows={size.rows}
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
    >
      <header className="pane-header">
        <span className="pane-title" title={label}>{label}</span>
        <span className="pane-actions">
          <button type="button" className="icon-button" aria-label="Split side by side" title="Split side by side" onClick={() => onSplit('row')}><SplitRowIcon /></button>
          <button type="button" className="icon-button" aria-label="Split stacked" title="Split stacked" onClick={() => onSplit('col')}><SplitColIcon /></button>
          <button type="button" className="icon-button" aria-label="Close shell" title="Close shell" onClick={onClose}><CloseIcon /></button>
        </span>
      </header>
      <div className="pane-body">
        <div className="pane-terminal" ref={host} />
        {note && (
          <div className={`pane-state pane-state-${state.kind}`} role="status">
            <span>{note}</span>
            {isOver(state) && (
              <button type="button" className="button button-default" disabled={restarting} onClick={() => void restart()}>Restart</button>
            )}
            {state.kind === 'detached' && (
              <button type="button" className="button button-outline" onClick={() => conn.current?.reattach()}>Reattach here</button>
            )}
            {restartError && <span className="pane-error">{restartError}</span>}
          </div>
        )}
        {tip && <div className="link-tip" role="tooltip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>}
      </div>
      {touch && <ExtraKeys mods={mods} onKey={sendExtraKey} />}
    </section>
  );
}
