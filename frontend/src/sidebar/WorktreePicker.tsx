import type { WorktreeInfo } from '../api';

// The checkout a new shell opens in: the main checkout, or one of cc's worktrees.
export function WorktreePicker({ project, worktrees, value, onChange }: {
  project: string; worktrees: WorktreeInfo[]; value: string | null; onChange(worktree: string | null): void;
}) {
  if (worktrees.length === 0) return null;
  return (
    <select className="select" aria-label={`Worktree for ${project}`} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">main checkout</option>
      {worktrees.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
    </select>
  );
}
