import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { SessionInfo } from '../api';

const SESSIONS_POLL_MS = 3000;

// The backend's sessions, polled while `enabled`. Sessions this page killed are
// kept out of the list even when a listing fetched before the kill landed still
// carries them.
export function useSessions(enabled: boolean) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const killed = useRef(new Set<string>());
  const refresh = useCallback(() => {
    api.listSessions().then((list) => setSessions(list.filter((s) => !killed.current.has(s.id))), () => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const poll = setInterval(refresh, SESSIONS_POLL_MS);
    return () => clearInterval(poll);
  }, [enabled, refresh]);

  // Drops sessions from the list at once (their shells are known to be dead).
  const markKilled = useCallback((ids: string[]) => {
    for (const id of ids) killed.current.add(id);
    setSessions((list) => list.filter((s) => !killed.current.has(s.id)));
  }, []);

  // Drops a session from the list at once, then refreshes once the backend has
  // answered the kill. A kill that failed (anything but 404, which means the
  // session is already gone) leaves the shell running, so it is listed again.
  const kill = useCallback((sessionId: string) => {
    markKilled([sessionId]);
    api.killSession(sessionId).catch((e: unknown) => {
      if (!(e instanceof api.ApiError && e.status === 404)) killed.current.delete(sessionId);
    }).finally(refresh);
  }, [markKilled, refresh]);

  const isKilled = useCallback((id: string) => killed.current.has(id), []);
  return { sessions, refresh, kill, markKilled, isKilled };
}
