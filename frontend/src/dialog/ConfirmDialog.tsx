import { Modal } from './Modal';

// Asks before a destructive action. Never `window.confirm`: it blocks the page and automation alike.
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; onConfirm(): void; onCancel(): void;
}) {
  return (
    <Modal open onClose={onCancel} title={title}>
      <p className="dialog-body">{body}</p>
      <div className="dialog-actions">
        <button type="button" className="button button-outline" onClick={onCancel}>Cancel</button>
        <button type="button" className="button button-destructive" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
