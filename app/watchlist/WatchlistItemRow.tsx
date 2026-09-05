"use client";

import type { PointerEvent } from "react";
import type { SinceLastCheck, SymbolInfo } from "./api";

type Props = {
  symbol: string;
  info: SymbolInfo | undefined;
  sinceLastCheck: SinceLastCheck;
  isPending: boolean;
  isDragging: boolean;
  onRemove: () => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
};

function formatPrice(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Since-last-check has no loading state of its own - it always arrives with the rest of the row's data in one response. */
function SinceLastCheckCell({ state }: { state: SinceLastCheck }) {
  if (state.kind === "NO_BASELINE") {
    return <span className="text-sm text-muted">First view</span>;
  }

  if (state.kind === "MEANINGFUL") {
    const arrow = state.direction === "UP" ? "↑" : "↓";
    return (
      <div className="text-sm leading-tight">
        <div className={state.direction === "DOWN" ? "text-danger" : "text-foreground"}>
          {arrow}
          {Math.abs(state.deltaPercent).toFixed(1)}%
        </div>
        <div className="text-muted">from ₹{formatPrice(state.baselinePrice)}</div>
      </div>
    );
  }

  // BELOW_THRESHOLD, NOT_COMPARABLE, and UNCHANGED_SESSION all render the
  // same way here - reliability already explains stale/unavailable data
  // elsewhere in the row, so this column doesn't repeat that warning.
  return <span className="text-sm text-muted">—</span>;
}

export function WatchlistItemRow({
  symbol,
  info,
  sinceLastCheck,
  isPending,
  isDragging,
  onRemove,
  onDragHandlePointerDown,
}: Props) {
  return (
    <li
      data-symbol={symbol}
      className={`flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <button
        type="button"
        aria-label={`Reorder ${symbol}`}
        onPointerDown={onDragHandlePointerDown}
        className="cursor-grab touch-none select-none px-1 py-1 text-muted active:cursor-grabbing"
      >
        ⠿
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{symbol}</span>
          {info && (
            <span className="rounded bg-background px-1.5 py-0.5 text-xs text-muted">
              {info.kind === "INDEX" ? "Index" : "Equity"}
            </span>
          )}
        </div>
        {info && <div className="truncate text-sm text-muted">{info.name}</div>}
      </div>

      <div className="w-24 shrink-0 text-right">
        <SinceLastCheckCell state={sinceLastCheck} />
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={isPending}
        className="shrink-0 rounded-md px-2.5 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
      >
        {isPending ? "Removing…" : "Remove"}
      </button>
    </li>
  );
}
