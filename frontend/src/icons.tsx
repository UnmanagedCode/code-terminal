// Inline icons (no icon package). Decorative: the button carries the accessible name.
const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true } as const;

export const SplitRowIcon = () => (
  <svg {...base}><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M8 2.5v11" /></svg>
);
export const SplitColIcon = () => (
  <svg {...base}><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M2 8h12" /></svg>
);
export const CloseIcon = () => (
  <svg {...base}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
export const PlusIcon = () => (
  <svg {...base}><path d="M8 3v10M3 8h10" /></svg>
);
export const EllipsisVerticalIcon = () => (
  <svg {...base}><circle cx="8" cy="3.5" r="0.75" /><circle cx="8" cy="8" r="0.75" /><circle cx="8" cy="12.5" r="0.75" /></svg>
);
export const ChevronRightIcon = () => (
  <svg {...base}><path d="M6 3.5L10.5 8 6 12.5" /></svg>
);
export const ChevronDownIcon = () => (
  <svg {...base}><path d="M3.5 6L8 10.5 12.5 6" /></svg>
);
