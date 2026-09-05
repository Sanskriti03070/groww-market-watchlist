"use client";

import { useId, useState } from "react";
import { AlertDetailsModal } from "./AlertDetailsModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { alertCopyParts, currentValueLabel } from "./alert-copy";
import { formatRelativeTime } from "./format";
import type { AlertDirection, AlertView, Quote } from "./api";

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
};

/** Outer card tint: neutral by default, restrained state colour only where the locked design calls for it - amber for near target, green/red for a triggered up/down move, grey for anything not currently live. */
function cardTone(alert: AlertView): { border: string; bg: string } {
  switch (alert.presentation) {
    case "HIGHLIGHTED":
      return { border: "border-yellow-soft-border", bg: "bg-yellow-soft" };
    case "TRIGGERED": {
      const upward = alert.direction === "ABOVE" || alert.direction === "UP";
      return upward ? { border: "border-green-soft-border", bg: "bg-green-soft" } : { border: "border-red-soft-border", bg: "bg-red-soft" };
    }
    case "DISABLED":
    case "NOT_EVALUATING":
      return { border: "border-border", bg: "bg-surface-muted" };
    case "ACTIVE":
    default:
      return { border: "border-border", bg: "bg-surface" };
  }
}

export function AlertCard({ alert, quote, companyName, now, pending, onEdit, onEnable, onDisable, onDismiss, onDelete }: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const confirmTitleId = useId();
  const upward = alert.direction === "ABOVE" || alert.direction === "UP";
  const tone = cardTone(alert);
  const isMuted = alert.presentation === "DISABLED" || alert.presentation === "NOT_EVALUATING";
  const textTone = isMuted ? "text-muted" : "text-foreground";
  const triggeredTextTone = upward ? "text-green" : "text-red";
  const copy = alertCopyParts(alert);
  const currentValue = currentValueLabel(alert, quote);

  return (
    <li
      className={`group relative w-64 shrink-0 snap-start rounded-xl border px-3.5 py-3 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] sm:w-72 ${tone.border} ${tone.bg}`}
    >
      <button
        type="button"
        onClick={() => setConfirmingDelete(true)}
        disabled={pending}
        aria-label={`Delete alert: ${alert.symbol} ${copy.prefix}${copy.target}${copy.suffix}`}
        className="absolute right-2 top-2 rounded-full p-1 text-muted-soft opacity-0 transition-opacity hover:bg-surface hover:text-red focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon />
      </button>

      <div className="flex items-center gap-1.5 pr-5">
        <span className={`text-sm font-semibold ${isMuted ? "text-muted" : "text-foreground"}`}>{alert.symbol}</span>
        <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] text-muted">
          {alert.conditionType === "PRICE_LEVEL" ? "Price" : "Day move"}
        </span>
      </div>

      <div className={`mt-1.5 flex items-center gap-1.5 text-sm font-medium ${alert.presentation === "TRIGGERED" ? triggeredTextTone : textTone}`}>
        <span className={alert.presentation === "TRIGGERED" ? triggeredTextTone : "text-muted-soft"} aria-hidden="true">
          {upward ? "↑" : "↓"}
        </span>
        <span>
          {copy.prefix}
          <span className="inline-flex items-center gap-0.5 font-semibold">
            <TargetIcon />
            {copy.target}
          </span>
          {copy.suffix}
        </span>
      </div>

      {currentValue && <div className="mt-1 text-xs text-muted">{currentValue}</div>}

      <div className="mt-2 flex min-h-[1.25rem] items-center gap-2 text-xs">
        {alert.presentation === "HIGHLIGHTED" && alert.distancePercent !== null && (
          <span className="font-medium text-yellow">Near target · {alert.distancePercent.toFixed(2)}% away</span>
        )}
        {alert.presentation === "DISABLED" && (
          <>
            <span className="text-muted">Paused</span>
            <button type="button" onClick={onEnable} disabled={pending} className="font-medium text-green hover:text-green-strong disabled:opacity-50">
              {pending ? "Enabling…" : "Enable"}
            </button>
          </>
        )}
        {alert.presentation === "NOT_EVALUATING" && <span className="text-muted">Symbol is not currently active</span>}
        {alert.presentation === "TRIGGERED" && (
          <>
            <span className="text-muted">{alert.lastTriggeredAt ? formatRelativeTime(alert.lastTriggeredAt, now) : ""}</span>
            <button type="button" onClick={onDismiss} disabled={pending} className="font-medium text-foreground-soft hover:text-foreground disabled:opacity-50">
              {pending ? "Dismissing…" : "Dismiss"}
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen(true)}
        className="mt-1.5 text-xs font-medium text-muted-soft underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        View details
      </button>

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
          }}
        />
      )}

      {detailsOpen && (
        <AlertDetailsModal
          alert={alert}
          quote={quote}
          companyName={companyName}
          now={now}
          pending={pending}
          onEdit={onEdit}
          onEnable={onEnable}
          onDisable={onDisable}
          onDismiss={onDismiss}
          onDelete={onDelete}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </li>
  );
}

function TargetIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M6.5 7.5v4M9.5 7.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4 4.5l.6 8.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
