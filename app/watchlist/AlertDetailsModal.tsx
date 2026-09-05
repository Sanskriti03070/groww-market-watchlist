"use client";

import { useId, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { DIRECTION_LABEL, PRESENTATION_LABEL, currentValueLabel, distanceToTarget } from "./alert-copy";
import { formatPrice, formatRelativeTime, formatSignedPercent, freshnessLabel } from "./format";
import type { AlertDirection, AlertView, Quote } from "./api";

const MAX_DAY_MOVE_PERCENT = 50;

type Props = {
  alert: AlertView;
  quote: Quote | undefined;
  companyName: string | undefined;
  now: Date;
  pending: boolean;
  onEdit: (thresholdValue: number, direction: AlertDirection) => Promise<boolean>;
  onEnable: () => void;
  onDisable: () => void;
  onDismiss: () => void;
  onDelete: () => void;
  onClose: () => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

export function AlertDetailsModal({ alert, quote, companyName, now, pending, onEdit, onEnable, onDisable, onDismiss, onDelete, onClose }: Props) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTitleId = useId();
  const titleId = useId();

  const currentPrice = quote?.lastPrice ? Number(quote.lastPrice) : null;
  const currentValue = currentValueLabel(alert, quote);
  const directions: AlertDirection[] = alert.conditionType === "PRICE_LEVEL" ? ["ABOVE", "BELOW"] : ["UP", "DOWN"];

  const [direction, setDirection] = useState<AlertDirection>(alert.direction);
  const [amount, setAmount] = useState(String(Number(alert.thresholdValue)));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const amountValue = Number(amount);
  const amountIsNumeric = amount.trim() !== "" && Number.isFinite(amountValue);
  let amountError: string | null = null;
  if (amount.trim() === "") {
    amountError = "Enter a value.";
  } else if (!amountIsNumeric || amountValue <= 0) {
    amountError = "Enter a value greater than 0.";
  } else if (alert.conditionType === "DAY_MOVE" && amountValue > MAX_DAY_MOVE_PERCENT) {
    amountError = `Day move alerts go up to ${MAX_DAY_MOVE_PERCENT}%.`;
  }
  const isValid = amountError === null;
  const hint =
    alert.conditionType === "PRICE_LEVEL" && amountIsNumeric && amountValue > 0 && currentPrice
      ? `${formatSignedPercent(((amountValue - currentPrice) / currentPrice) * 100, 1)} from current`
      : null;

  async function handleSave() {
    if (!isValid) {
      setTouched(true);
      return;
    }
    setSaving(true);
    const ok = await onEdit(amountValue, direction);
    setSaving(false);
    if (ok) {
      setMode("view");
    }
  }

  return (
    <Modal titleId={titleId} title="Alert details" onClose={onClose} widthClassName="max-w-md">
      <div className="px-5 py-4">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <div>
            <div className="font-semibold text-foreground">{alert.symbol}</div>
            {companyName && <div className="text-xs text-muted">{companyName}</div>}
          </div>
          <span className="rounded bg-surface-muted px-2 py-0.5 text-xs font-medium text-foreground-soft">
            {PRESENTATION_LABEL[alert.presentation]}
          </span>
        </div>

        {mode === "view" ? (
          <>
            <div className="divide-y divide-border">
              <Field label="Alert type" value={alert.conditionType === "PRICE_LEVEL" ? "Price crosses a level" : "Day move reaches a %"} />
              <Field label="Direction" value={DIRECTION_LABEL[alert.direction]} />
              <Field
                label="Target"
                value={alert.conditionType === "PRICE_LEVEL" ? formatPrice(alert.thresholdValue) : `${Number(alert.thresholdValue)}%`}
              />
              <Field label="Current value" value={currentValue ? currentValue.replace(/^(Current|Today): /, "") : "—"} />
              {quote && <Field label="Market status" value={freshnessLabel(quote.reliability, quote.fetchedAt, now).text} />}
              <Field label="Distance to target" value={distanceToTarget(alert, quote)?.text ?? "—"} />
              <Field label="Created" value={formatRelativeTime(alert.createdAt, now)} />
            </div>

            {alert.presentation === "TRIGGERED" && (
              <div className="mt-3 rounded-lg bg-surface-muted px-3 py-2.5">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Triggered</div>
                <Field
                  label="Triggered"
                  value={alert.lastTriggeredAt ? formatRelativeTime(alert.lastTriggeredAt, now) : "—"}
                />
                <Field
                  label="Target"
                  value={alert.conditionType === "PRICE_LEVEL" ? formatPrice(alert.thresholdValue) : `${Number(alert.thresholdValue)}%`}
                />
              </div>
            )}

            {alert.presentation === "NOT_EVALUATING" && (
              <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2.5 text-xs text-muted">
                This symbol is not currently active, so this alert isn&rsquo;t being evaluated. It hasn&rsquo;t been deleted - it will
                resume evaluating if the symbol becomes active again.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMode("edit")}
                disabled={pending}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:opacity-50"
              >
                Edit
              </button>
              {alert.presentation === "DISABLED" ? (
                <button
                  type="button"
                  onClick={onEnable}
                  disabled={pending}
                  className="rounded-lg border border-green px-3 py-1.5 text-sm font-medium text-green transition-colors hover:bg-green-soft disabled:opacity-50"
                >
                  {pending ? "Enabling…" : "Enable"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onDisable}
                  disabled={pending}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground-soft transition-colors hover:bg-surface-muted disabled:opacity-50"
                >
                  {pending ? "Disabling…" : "Disable"}
                </button>
              )}
              {alert.hasUnacknowledgedTrigger && (
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={pending}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground-soft transition-colors hover:bg-surface-muted disabled:opacity-50"
                >
                  {pending ? "Dismissing…" : "Dismiss"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending}
                className="ml-auto rounded-lg border border-red-soft-border px-3 py-1.5 text-sm font-medium text-red transition-colors hover:bg-red-soft disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <div>
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-medium text-foreground">Direction</legend>
              <div className="grid grid-cols-2 gap-2">
                {directions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={direction === option}
                    onClick={() => setDirection(option)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      direction === option ? "border-green bg-green-soft text-green-strong" : "border-border text-foreground-soft hover:border-border-strong"
                    }`}
                  >
                    {DIRECTION_LABEL[option]}
                  </button>
                ))}
              </div>
            </fieldset>

            <label htmlFor="edit-alert-amount" className="mb-1.5 block text-sm font-medium text-foreground">
              {alert.conditionType === "PRICE_LEVEL" ? "Target price" : "Move (%)"}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
                {alert.conditionType === "PRICE_LEVEL" ? "₹" : "%"}
              </span>
              <input
                id="edit-alert-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                onBlur={() => setTouched(true)}
                autoFocus
                aria-invalid={touched && amountError !== null}
                className="w-full rounded-lg border border-border bg-surface px-7 py-2.5 text-foreground outline-none focus-visible:border-green"
              />
            </div>
            <div className="mt-1.5 min-h-[1.25rem] text-xs">
              {touched && amountError ? <span className="text-red">{amountError}</span> : hint ? <span className="text-muted">{hint}</span> : null}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setMode("view")} className="text-sm text-muted hover:text-foreground">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || (touched && !isValid)}
                className="rounded-lg bg-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          titleId={confirmTitleId}
          title="Delete alert"
          message="Are you sure you want to delete this alert?"
          confirmLabel="Delete"
          pending={pending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
