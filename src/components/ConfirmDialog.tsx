'use client';
/**
 * A real dialog for the actions that need one: reversing money, closing a
 * table, invalidating a printed QR code.
 *
 * These were window.confirm and window.prompt. Three problems with that:
 *
 *  - window.prompt is suppressed outright in some mobile browsers and in
 *    installed PWAs, so on the phones staff actually carry, reversing a payment
 *    could silently do nothing;
 *  - neither can validate, so a reason under three characters was discarded
 *    with no explanation and the action simply failed to happen;
 *  - neither can be read at a glance on a phone, and both block the whole tab.
 *
 * Built on the native <dialog> element, which brings focus trapping, Escape to
 * dismiss and an inert backdrop without hand-rolling any of it.
 */
import {useEffect, useId, useRef, useState} from 'react';
import {TriangleAlert} from 'lucide-react';

export type ReasonRequest = {
  label: string;
  hint?: string;
  placeholder?: string;
  /** Mirrors the server's own minimum so the dialog refuses what the callable would. */
  minLength?: number;
};

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  reason,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  reason?: ReasonRequest;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const describedBy = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setValue('');
      setProblem(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Escape and the backdrop both fire `cancel`/`close` natively; route them
  // through the same handler as the Cancel button so the caller only has one
  // path to reason about.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handle = (event: Event) => {
      event.preventDefault();
      if (!busy) onCancel();
    };
    dialog.addEventListener('cancel', handle);
    return () => dialog.removeEventListener('cancel', handle);
  }, [busy, onCancel]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (reason) {
      const trimmed = value.trim();
      const minLength = reason.minLength ?? 3;
      if (trimmed.length < minLength) {
        setProblem(`Please write at least ${minLength} characters. This is recorded against your name.`);
        return;
      }
      onConfirm(trimmed);
      return;
    }
    onConfirm('');
  };

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby={`${describedBy}-title`}>
      <form onSubmit={submit} className="dialog-body" method="dialog">
        <div className="dialog-head">
          {tone === 'danger' && (
            <span className="dialog-icon" aria-hidden><TriangleAlert size={19} /></span>
          )}
          <h2 id={`${describedBy}-title`}>{title}</h2>
        </div>

        {body && <div className="dialog-copy">{body}</div>}

        {reason && (
          <label className="dialog-field">
            <span>{reason.label}</span>
            {reason.hint && <small>{reason.hint}</small>}
            <textarea
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (problem) setProblem(null);
              }}
              placeholder={reason.placeholder}
              rows={3}
              // Autofocus is appropriate here: the dialog exists to collect this.
              autoFocus
              required
            />
          </label>
        )}

        {problem && <p className="dialog-problem" role="alert">{problem}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="submit" className={`btn${tone === 'danger' ? ' btn-danger' : ''}`} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
