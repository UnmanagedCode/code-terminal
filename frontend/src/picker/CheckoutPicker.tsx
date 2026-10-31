// The dialog that opens a checkout in a tab: cc's projects grouped by workspace,
// each with its worktrees and a count of its running shells.
import { useMemo, useState } from 'react';
import type { ProjectInfo, SessionInfo } from '../api';
import { availabilityNote, runningIn, type Checkout } from '../checkout';
import { Modal } from '../dialog/Modal';
import { ChevronDownIcon, ChevronRightIcon } from '../icons';

type Props = {
  open: boolean;
  projects: ProjectInfo[] | null;
  // The failure of the latest listing, if it failed.
  error: string | null;
  sessions: SessionInfo[];
  onRetry(): void;
  onOpen(c: Checkout): void;
  onClose(): void;
};

// `<system> · <remoteId>` for a project on another System.
export const systemLabel = (p: ProjectInfo): string | null =>
  p.system === 'local' ? null : p.remoteId ? `${p.system} · ${p.remoteId}` : p.system;

function RunningBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="badge" aria-label={`${count} running ${count === 1 ? 'shell' : 'shells'}`}>{count} running</span>;
}

function ProjectRow({ project: p, sessions, onPick }: { project: ProjectInfo; sessions: SessionInfo[]; onPick(c: Checkout): void }) {
  const [expanded, setExpanded] = useState(false);
  const disabled = p.terminal.state === 'unavailable';
  const note = availabilityNote(p.terminal);
  const system = systemLabel(p);
  const main: Checkout = { project: p.name, worktree: null };
  return (
    <li className="picker-project">
      <div className="picker-head">
        <button type="button" className="icon-button" disabled={disabled} aria-expanded={expanded} aria-label={`Show checkouts of ${p.name}`}
          onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}</button>
        <button type="button" className="picker-name" disabled={disabled} onClick={() => onPick(main)}>{p.name}</button>
        {system && <span className="badge">{system}</span>}
        <RunningBadge count={runningIn(sessions, main)} />
      </div>
      {note && <p className={`picker-note picker-note-${p.terminal.state}`}>{note}</p>}
      {expanded && (
        <ul className="picker-checkouts" aria-label={`Checkouts of ${p.name}`}>
          <li>
            <button type="button" className="picker-checkout" onClick={() => onPick(main)}>
              <span>(main checkout)</span>
              <RunningBadge count={runningIn(sessions, main)} />
            </button>
          </li>
          {p.worktrees.map((w) => (
            <li key={w.name}>
              <button type="button" className="picker-checkout" onClick={() => onPick({ project: p.name, worktree: w.name })}>
                <span>{w.name}</span>
                {w.branch && <span className="picker-branch">{w.branch}</span>}
                <RunningBadge count={runningIn(sessions, { project: p.name, worktree: w.name })} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function CheckoutPicker({ open, projects, error, sessions, onRetry, onOpen, onClose }: Props) {
  const [filter, setFilter] = useState('');
  // Workspaces alphabetical with "No workspace" last, projects alphabetical within each.
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const shown = (projects ?? []).filter((p) => !f || p.name.toLowerCase().includes(f) || (p.workspace ?? '').toLowerCase().includes(f));
    const by = new Map<string, ProjectInfo[]>();
    for (const p of [...shown].sort((a, b) => a.name.localeCompare(b.name))) {
      const k = p.workspace ?? '';
      by.set(k, [...(by.get(k) ?? []), p]);
    }
    return [...by.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [projects, filter]);
  const pick = (c: Checkout) => { onOpen(c); onClose(); };

  return (
    <Modal open={open} onClose={onClose} title="Open a checkout" description="Projects registered in code-conductor, on any System.">
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input className="input" autoFocus aria-label="Filter projects" placeholder="Filter projects" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="picker-list">
        {error && (
          <div className="picker-error">
            <span>{error}</span>
            <button type="button" className="button button-outline" onClick={onRetry}>Retry</button>
          </div>
        )}
        {!projects && !error && <p className="picker-empty">Loading projects…</p>}
        {projects && groups.length === 0 && <p className="picker-empty">No project matches.</p>}
        {groups.map(([workspace, rows]) => (
          <section key={workspace} aria-label={workspace || 'No workspace'} className="picker-group">
            <h3 className="picker-group-title">{workspace || 'No workspace'}</h3>
            <ul>{rows.map((p) => <ProjectRow key={p.name} project={p} sessions={sessions} onPick={pick} />)}</ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
