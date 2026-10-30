// Projects, each with its shells nested underneath and a New shell action.
import { useState } from 'react';
import type { ProjectInfo, SessionInfo } from '../api';
import { PlusIcon } from '../icons';
import { WorktreePicker } from './WorktreePicker';

type Props = {
  projects: ProjectInfo[];
  sessions: SessionInfo[];
  selected: string | null;
  onSelect(project: string): void;
  onNewShell(project: string, worktree: string | null): void;
  onFocusSession(project: string, sessionId: string): void;
};

function availabilityNote(p: ProjectInfo) {
  const t = p.terminal;
  if (t.state === 'available') return null;
  const prefix = t.state === 'unreachable' ? 'System unreachable: ' : t.state === 'unknown' ? 'Terminals may not open: ' : '';
  return <p className={`project-note project-note-${t.state}`}>{prefix}{t.reason}</p>;
}

function sessionLabel(s: SessionInfo) {
  const state = s.state.kind === 'running' ? '' : ` (${s.state.kind})`;
  return `${s.title || s.worktree || 'main'}${state}`;
}

function ProjectRow({ project: p, sessions, selected, onSelect, onNewShell, onFocusSession }: Omit<Props, 'projects' | 'selected'> & { project: ProjectInfo; selected: boolean }) {
  const [worktree, setWorktree] = useState<string | null>(null);
  const disabled = p.terminal.state === 'unavailable';
  return (
    <div role="group" aria-label={p.name} className={`project${selected ? ' project-selected' : ''}`}>
      <div className="project-head">
        <button type="button" className="project-name" aria-current={selected ? 'page' : undefined} onClick={() => onSelect(p.name)}>{p.name}</button>
        <button type="button" className="icon-button" aria-label={`New shell in ${p.name}`} title="New shell" disabled={disabled}
          onClick={() => onNewShell(p.name, worktree)}><PlusIcon /></button>
      </div>
      <WorktreePicker project={p.name} worktrees={p.worktrees} value={worktree} onChange={setWorktree} />
      {availabilityNote(p)}
      {sessions.length > 0 && (
        <ul className="shells">
          {sessions.map((s) => (
            <li key={s.id}>
              <button type="button" className="shell-link" onClick={() => onFocusSession(p.name, s.id)}>{sessionLabel(s)}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Sidebar({ projects, sessions, selected, ...actions }: Props) {
  return (
    <nav className="sidebar" aria-label="Projects">
      {projects.map((p) => (
        <ProjectRow key={p.name} project={p} selected={p.name === selected} sessions={sessions.filter((s) => s.project === p.name)} {...actions} />
      ))}
    </nav>
  );
}
