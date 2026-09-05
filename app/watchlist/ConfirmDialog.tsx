"use client";

import { Modal } from "./Modal";

type Props = {
  titleId: string;
  title: string;
  message: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ titleId, title, message, confirmLabel, pending, onConfirm, onCancel }: Props) {
  return (
    <Modal titleId={titleId} title={title} onClose={onCancel} widthClassName="max-w-sm">
      <div className="px-5 py-4">
        <p className="mb-4 text-sm text-foreground-soft">{message}</p>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-foreground">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-red px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
