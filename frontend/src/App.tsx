// The page: the project sidebar and the selected project's split layout.
// Route state is `?project=<name>`; layouts persist per project on the backend.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { ProjectInfo, SessionInfo } from './api';
import { SplitView } from './layout/SplitView';
import { close, focusAfterClose, newPane, panes, setRatio, split, updatePane, type Layout, type Pane, type SplitDir } from './layout/tree';
import { Sidebar } from './sidebar/Sidebar';
import { TerminalPane } from './terminal/TerminalPane';

const SAVE_DEBOUNCE_MS = 300;
const SESSIONS_POLL_MS = 3000;
// A new session's size until its pane attaches with the real one.
const INITIAL_SIZE = { cols: 80, rows: 24 };

const readRoute = () => new URLSearchParams(location.search).get('project');

export function App() {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [fatal, setFatal] = useState<api.ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(readRoute);
  const [layouts, setLayouts] = useState<Record<string, Layout | null>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const layoutsRef = useRef(layouts);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const report = useCallback((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)), []);
  const refreshSessions = useCallback(() => { api.listSessions().then(setSessions, () => {}); }, []);

  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | undefined;
    api.listProjects().then((list) => {
      setProjects(list);
      refreshSessions();
      poll = setInterval(refreshSessions, SESSIONS_POLL_MS);
    }, (e: unknown) => {
      if (e instanceof api.ApiError) setFatal(e);
      else report(e);
    });
    const onPop = () => setSelected(readRoute());
    window.addEventListener('popstate', onPop);
    return () => { clearInterval(poll); window.removeEventListener('popstate', onPop); };
  }, [refreshSessions, report]);

  const ensureLayout = useCallback(async (project: string): Promise<Layout | null> => {
    if (project in layoutsRef.current) return layoutsRef.current[project];
    const tree = await api.getLayout(project);
    if (!(project in layoutsRef.current)) {
      layoutsRef.current = { ...layoutsRef.current, [project]: tree };
      setLayouts(layoutsRef.current);
    }
    return layoutsRef.current[project];
  }, []);

  useEffect(() => {
    if (!selected) return;
    ensureLayout(selected).then((t) => setFocused((f) => (f && panes(t).some((p) => p.id === f) ? f : panes(t)[0]?.id ?? null)), report);
  }, [selected, ensureLayout, report]);

  const save = useCallback((project: string) => {
    clearTimeout(saveTimers.current.get(project));
    saveTimers.current.delete(project);
    api.putLayout(project, layoutsRef.current[project] ?? null).catch(report);
  }, [report]);

  // Applies `fn` to a project's layout and saves it shortly after.
  const mutate = useCallback((project: string, fn: (t: Layout | null) => Layout | null) => {
    layoutsRef.current = { ...layoutsRef.current, [project]: fn(layoutsRef.current[project] ?? null) };
    setLayouts(layoutsRef.current);
    clearTimeout(saveTimers.current.get(project));
    saveTimers.current.set(project, setTimeout(() => save(project), SAVE_DEBOUNCE_MS));
  }, [save]);

  // A save still waiting out its debounce is sent now when the page goes away
  // (reload, navigation, closing the tab) or the app unmounts.
  useEffect(() => {
    const flush = () => { for (const project of [...saveTimers.current.keys()]) save(project); };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [save]);

  const select = useCallback((project: string) => {
    setSelected(project);
    history.pushState(null, '', `?project=${encodeURIComponent(project)}`);
  }, []);

  // Puts `pane` next to the focused pane of `project` (or as its only pane), and focuses it.
  const place = useCallback(async (project: string, pane: Pane) => {
    const tree = await ensureLayout(project);
    const at = tree && (panes(tree).find((p) => p.id === focused && project === selected) ?? panes(tree).at(-1));
    mutate(project, (t) => (t && at ? split(t, at.id, 'row', pane) : pane));
    select(project);
    setFocused(pane.id);
  }, [ensureLayout, mutate, select, focused, selected]);

  const newShell = useCallback(async (project: string, worktree: string | null) => {
    try {
      const id = await api.createSession(project, worktree, INITIAL_SIZE);
      await place(project, newPane(id, worktree));
      refreshSessions();
    } catch (e) { report(e); }
  }, [place, refreshSessions, report]);

  const splitPane = useCallback(async (project: string, pane: Pane, dir: SplitDir) => {
    try {
      const id = await api.createSession(project, pane.worktree, INITIAL_SIZE);
      const added = newPane(id, pane.worktree);
      mutate(project, (t) => (t ? split(t, pane.id, dir, added) : added));
      setFocused(added.id);
      refreshSessions();
    } catch (e) { report(e); }
  }, [mutate, refreshSessions, report]);

  const closePane = useCallback((project: string, pane: Pane) => {
    if (pane.sessionId) api.killSession(pane.sessionId).catch(() => {});
    const tree = layoutsRef.current[project];
    if (tree) setFocused(focusAfterClose(tree, pane.id));
    mutate(project, (t) => (t ? close(t, pane.id) : null));
    refreshSessions();
  }, [mutate, refreshSessions]);

  const replaceSession = useCallback((project: string, pane: Pane, sessionId: string) => {
    if (pane.sessionId) api.killSession(pane.sessionId).catch(() => {});
    mutate(project, (t) => (t ? updatePane(t, pane.id, { sessionId }) : t));
    refreshSessions();
  }, [mutate, refreshSessions]);

  const focusSession = useCallback(async (project: string, sessionId: string) => {
    try {
      const tree = await ensureLayout(project);
      const found = panes(tree).find((p) => p.sessionId === sessionId);
      if (found) {
        select(project);
        setFocused(found.id);
        return;
      }
      // A live session no pane shows (its layout was lost): give it a pane.
      const s = sessions.find((x) => x.id === sessionId);
      await place(project, newPane(sessionId, s?.worktree ?? null));
    } catch (e) { report(e); }
  }, [ensureLayout, place, report, select, sessions]);

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

  const tree = selected ? layouts[selected] : undefined;
  return (
    <div className="app">
      <Sidebar projects={projects ?? []} sessions={sessions} selected={selected}
        onSelect={select} onNewShell={(p, w) => void newShell(p, w)} onFocusSession={(p, s) => void focusSession(p, s)} />
      <main className="workspace">
        {notice && (
          <div className="alert" role="alert">
            <span>{notice}</span>
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
          </div>
        )}
        {!selected && <p className="empty">{projects === null ? 'Loading projects…' : 'Pick a project in the sidebar.'}</p>}
        {selected && tree === null && <p className="empty">No shells in {selected} yet. Use + next to it in the sidebar.</p>}
        {selected && tree && (
          <SplitView
            key={selected}
            tree={tree}
            onRatio={(path, r) => mutate(selected, (t) => (t ? setRatio(t, path, r) : t))}
            renderPane={(pane) => (
              <TerminalPane
                key={pane.id}
                project={selected}
                pane={pane}
                focused={pane.id === focused}
                onFocus={() => setFocused(pane.id)}
                onSplit={(dir) => void splitPane(selected, pane, dir)}
                onClose={() => closePane(selected, pane)}
                onSessionReplaced={(id) => replaceSession(selected, pane, id)}
              />
            )}
          />
        )}
      </main>
    </div>
  );
}
