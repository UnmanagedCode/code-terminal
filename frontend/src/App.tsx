// The page: a tab bar of open checkouts over the active checkout's split layout.
// Route state is `?project=<name>[&worktree=<name>]`; layouts persist per checkout on the backend.
// code-conductor's row menus arrive as `?ccProject=&ccWorktree=` and are turned into that route.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { availabilityNote, checkoutKey, checkoutLabel, checkoutPresence, goneReason, sameCheckout, type Checkout } from './checkout';
import { ConfirmDialog } from './dialog/ConfirmDialog';
import { SplitView } from './layout/SplitView';
import { close, focusAfterClose, newPane, panes, setRatio, split, updatePane, type Pane, type SplitDir } from './layout/tree';
import { useLayouts } from './layout/useLayouts';
import { useMenuTarget } from './menu/useMenuTarget';
import { CheckoutPicker } from './picker/CheckoutPicker';
import { useSessions } from './sessions/useSessions';
import { TabBar } from './tabs/TabBar';
import { useTabShortcuts } from './tabs/useTabShortcuts';
import { useTabs } from './tabs/useTabs';
import { TerminalPane } from './terminal/TerminalPane';
import type { ProjectInfo } from './api';

// A new session's size until its pane attaches with the real one.
const INITIAL_SIZE = { cols: 80, rows: 24 };

type Confirm = { checkouts: Checkout[]; running: number | null };

export function App() {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<api.ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [focused, setFocused] = useState<Record<string, string | null>>({});
  const focusedRef = useRef(focused);

  const report = useCallback((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)), []);
  const { tabs, ref: tabsRef, dispatch, active } = useTabs();
  const isOpen = useCallback((c: Checkout) => tabsRef.current.open.some((t) => sameCheckout(t, c)), [tabsRef]);
  const layouts = useLayouts(isOpen, report);
  const { ensureLayout, mutate } = layouts;
  const { sessions, refresh: refreshSessions, kill, markKilled, isKilled } = useSessions(projects !== null);

  const loadProjects = useCallback(async (initial: boolean) => {
    try {
      setProjects(await api.listProjects());
      setProjectsError(null);
    } catch (e) {
      if (initial && e instanceof api.ApiError) setFatal(e);
      else {
        setProjectsError(e instanceof Error ? e.message : String(e));
        if (initial) report(e);
      }
    }
  }, [report]);
  useEffect(() => { void loadProjects(true); }, [loadProjects]);

  const setFocus = useCallback((c: Checkout, paneId: string | null) => {
    focusedRef.current = { ...focusedRef.current, [checkoutKey(c)]: paneId };
    setFocused(focusedRef.current);
  }, []);

  // The active checkout's layout is loaded, and a pane of it focused.
  const activeKey = active ? checkoutKey(active) : null;
  useEffect(() => {
    if (!active) return;
    ensureLayout(active).then((t) => {
      const f = focusedRef.current[checkoutKey(active)];
      if (!f || !panes(t).some((p) => p.id === f)) setFocus(active, panes(t)[0]?.id ?? null);
    }, report);
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activate = useCallback((index: number) => dispatch({ type: 'activateIndex', index }), [dispatch]);
  const tabCount = useCallback(() => tabsRef.current.open.length, [tabsRef]);
  useTabShortcuts(tabCount, activate);

  // Puts `pane` next to the focused pane of `c` (or as its only pane), and focuses it.
  const place = useCallback(async (c: Checkout, pane: Pane) => {
    const tree = await ensureLayout(c);
    const at = tree && (panes(tree).find((p) => p.id === focusedRef.current[checkoutKey(c)]) ?? panes(tree).at(-1));
    mutate(c, (t) => (t && at ? split(t, at.id, 'row', pane) : pane));
    setFocus(c, pane.id);
  }, [ensureLayout, mutate, setFocus]);

  // A session opened in `c`; null when `c`'s tab was closed meanwhile, in which
  // case the new shell is killed at once (no shell lives without a tab).
  const createIn = useCallback(async (c: Checkout): Promise<string | null> => {
    const id = await api.createSession(c, INITIAL_SIZE);
    if (isOpen(c)) return id;
    api.killSession(id).catch(report);
    return null;
  }, [isOpen, report]);

  const newShell = useCallback(async (c: Checkout) => {
    try {
      const id = await createIn(c);
      if (id === null) return;
      await place(c, newPane(id));
      refreshSessions();
    } catch (e) { report(e); }
  }, [createIn, place, refreshSessions, report]);

  const splitPane = useCallback(async (c: Checkout, pane: Pane, dir: SplitDir) => {
    try {
      const id = await createIn(c);
      if (id === null) return;
      const added = newPane(id);
      mutate(c, (t) => (t ? split(t, pane.id, dir, added) : added));
      setFocus(c, added.id);
      refreshSessions();
    } catch (e) { report(e); }
  }, [createIn, mutate, setFocus, refreshSessions, report]);

  const closePane = useCallback((c: Checkout, pane: Pane) => {
    if (pane.sessionId) kill(pane.sessionId);
    const tree = layouts.ref.current[checkoutKey(c)];
    if (tree) setFocus(c, focusAfterClose(tree, pane.id));
    mutate(c, (t) => (t ? close(t, pane.id) : null));
  }, [layouts.ref, mutate, kill, setFocus]);

  const replaceSession = useCallback((c: Checkout, pane: Pane, sessionId: string) => {
    if (!isOpen(c)) {
      api.killSession(sessionId).catch(report);
      return;
    }
    if (pane.sessionId) kill(pane.sessionId);
    mutate(c, (t) => (t ? updatePane(t, pane.id, { sessionId }) : t));
    refreshSessions();
  }, [isOpen, mutate, kill, refreshSessions, report]);

  // Gives every live session of `c` that no pane shows a pane. Never automatic:
  // another browser may have the shell attached, and a shell has one client.
  const showHidden = useCallback(async (c: Checkout, ids: string[]) => {
    try { for (const id of ids) await place(c, newPane(id)); } catch (e) { report(e); }
  }, [place, report]);

  // Closes the tabs of `cs`: each checkout's shells are killed by the backend
  // first, and a tab only goes away once that has succeeded.
  const closeCheckouts = useCallback(async (cs: Checkout[]) => {
    for (const c of cs) {
      layouts.hold(c);
      try {
        await api.closeCheckout(c);
      } catch (e) {
        layouts.release(c);
        report(e);
        continue;
      }
      markKilled(sessions.filter((s) => sameCheckout(s, c)).map((s) => s.id));
      const { [checkoutKey(c)]: _gone, ...rest } = focusedRef.current;
      focusedRef.current = rest;
      setFocused(rest);
      const index = tabsRef.current.open.findIndex((t) => sameCheckout(t, c));
      dispatch({ type: 'close', index });
      layouts.drop(c);
    }
    refreshSessions();
  }, [layouts, markKilled, sessions, tabsRef, dispatch, refreshSessions, report]);

  // Asks first when a target checkout has running shells; the count is fetched
  // fresh because the polled list may be stale (a failed fetch asks anyway).
  const requestClose = useCallback(async (cs: Checkout[]) => {
    let running: number | null;
    try {
      const list = await api.listSessions();
      running = list.filter((s) => s.state.kind === 'running' && !isKilled(s.id) && cs.some((c) => sameCheckout(s, c))).length;
    } catch { running = null; }
    if (running === 0) void closeCheckouts(cs);
    else setConfirm({ checkouts: cs, running });
  }, [closeCheckouts, isKilled]);

  const closeTab = (index: number) => { const c = tabs.open[index]; if (c) void requestClose([c]); };
  const closeOthers = (index: number) => { void requestClose(tabs.open.filter((_, i) => i !== index)); };

  // `list` is the listing to judge availability by; the menu passes a fresher one than the closure's.
  const pick = useCallback(async (c: Checkout, list: ProjectInfo[] | null = projects) => {
    dispatch({ type: 'open', checkout: c });
    try {
      const tree = await ensureLayout(c);
      const presence = checkoutPresence(list, c);
      const blocked = presence.kind === 'present' && presence.project.terminal.state === 'unavailable';
      if (tree === null && isOpen(c) && !blocked) await newShell(c);
    } catch (e) { report(e); }
  }, [dispatch, ensureLayout, projects, isOpen, newShell, report]);

  const commitProjects = useCallback((list: ProjectInfo[]) => {
    setProjects(list);
    setProjectsError(null);
  }, []);
  useMenuTarget({
    active: () => tabsRef.current.open[tabsRef.current.active] ?? null,
    refresh: api.listProjects,
    commit: commitProjects,
    open: (c, list) => void pick(c, list),
    report: (m) => setNotice(m),
  });

  const openPicker = () => { setPickerOpen(true); void loadProjects(false); };

  if (fatal) {
    return (
      <main className="page">
        <h1>Code Terminal</h1>
        <p>{fatal.code === 'HOST_UNAVAILABLE' || fatal.code === 'REQUEST_REFUSED'
          ? 'This page needs code-conductor behind it: open it through code-conductor.'
          : fatal.message}</p>
      </main>
    );
  }

  const tree = activeKey ? layouts.layouts[activeKey] : undefined;
  const presence = checkoutPresence(projects, active ?? { project: '', worktree: null });
  const gone = active ? goneReason(presence) : null;
  const terminal = presence.kind === 'present' || presence.kind === 'worktree-gone' ? presence.project.terminal : null;
  const note = terminal ? availabilityNote(terminal) : null;
  const unavailable = terminal?.state === 'unavailable';
  const hidden = active && tree !== undefined
    ? sessions.filter((s) => sameCheckout(s, active) && !panes(tree).some((p) => p.sessionId === s.id)).map((s) => s.id)
    : [];
  const confirmLabel = (cs: Checkout[]) => (cs.length === 1 ? `Close ${checkoutLabel(cs[0])}?` : `Close ${cs.length} tabs?`);

  return (
    <div className="app">
      <TabBar tabs={tabs.open} active={tabs.active} onError={report}
        goneReason={(c) => goneReason(checkoutPresence(projects, c))}
        onActivate={activate} onClose={closeTab} onCloseOthers={closeOthers} onOpenPicker={openPicker} />
      <main className="workspace">
        {notice && (
          <div className="alert" role="alert">
            <span>{notice}</span>
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
          </div>
        )}
        {!active && (
          <div className="empty">
            <p>No checkout open.</p>
            <button type="button" className="button button-default" onClick={openPicker}>Open a checkout</button>
          </div>
        )}
        {active && gone && (
          <div className="banner" role="status">
            <span>{checkoutLabel(active)} no longer exists in code-conductor ({gone}). Its shells keep running until you close this tab.</span>
            <button type="button" className="button button-outline" onClick={() => closeTab(tabs.active)}>Close tab</button>
          </div>
        )}
        {active && hidden.length > 0 && (
          <div className="banner" role="status">
            <span>{hidden.length} {hidden.length === 1 ? 'shell' : 'shells'} in this checkout {hidden.length === 1 ? 'is' : 'are'} not in this layout.</span>
            <button type="button" className="button button-outline" onClick={() => void showHidden(active, hidden)}>Show</button>
          </div>
        )}
        {active && tree === null && hidden.length === 0 && (
          <div className="empty">
            <p>No shells in {checkoutLabel(active)} yet.</p>
            <button type="button" className="button button-default" disabled={unavailable} onClick={() => void newShell(active)}>New shell</button>
            {note && <p className="empty-note">{note}</p>}
          </div>
        )}
        {active && tree && (
          <SplitView
            key={activeKey}
            tree={tree}
            onRatio={(path, r) => mutate(active, (t) => (t ? setRatio(t, path, r) : t))}
            renderPane={(pane) => (
              <TerminalPane
                key={pane.id}
                checkout={active}
                pane={pane}
                focused={pane.id === focused[activeKey!]}
                onFocus={() => setFocus(active, pane.id)}
                onSplit={(dir) => void splitPane(active, pane, dir)}
                onClose={() => closePane(active, pane)}
                onSessionReplaced={(id) => replaceSession(active, pane, id)}
              />
            )}
          />
        )}
      </main>
      <CheckoutPicker open={pickerOpen} projects={projects} error={projectsError} sessions={sessions}
        onRetry={() => void loadProjects(false)} onOpen={(c) => void pick(c)} onClose={() => setPickerOpen(false)} />
      {confirm && (
        <ConfirmDialog
          title={confirmLabel(confirm.checkouts)}
          body={confirm.running === null
            ? 'Running shells, if any, will be killed.'
            : `${confirm.running} running ${confirm.running === 1 ? 'shell' : 'shells'} will be killed.`}
          confirmLabel="Kill shells and close"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const cs = confirm.checkouts; setConfirm(null); void closeCheckouts(cs); }} />
      )}
    </div>
  );
}
