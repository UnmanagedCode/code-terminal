export type Pane = { kind: 'pane'; id: string; sessionId: string | null };
export type Split = { kind: 'split'; dir: 'row' | 'col'; ratio: number; a: Layout; b: Layout };
export type Layout = Pane | Split;

export const LAYOUT_MAX_BYTES: number;
export const RATIO_MIN: number;
export const RATIO_MAX: number;
export function validateLayout(tree: unknown): string | null;
