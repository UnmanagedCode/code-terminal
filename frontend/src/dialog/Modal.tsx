import { useEffect, useId, useRef, type ReactNode } from 'react';

// A native modal `<dialog>` driven by `open`: the top layer, inert background,
// focus containment and Esc come with it. Content is mounted only while open,
// and the element marked `data-autofocus` takes focus once the dialog is shown
// (React's `autoFocus` would fire while the dialog is still closed).
export function Modal({ open, onClose, title, description, children }: {
  open: boolean; onClose(): void; title: string; description?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {open && (
        <>
          <h2 id={titleId} className="dialog-title">{title}</h2>
          {description && <p className="dialog-description">{description}</p>}
          {children}
        </>
      )}
    </dialog>
  );
}
