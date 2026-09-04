"use client";

import type { PointerEvent } from "react";
import type { SymbolInfo } from "./api";

type Props = {
  symbol: string;
  info: SymbolInfo | undefined;
  isPending: boolean;
  isDragging: boolean;
  onRemove: () => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
};

export function WatchlistItemRow({ symbol, info, isPending, isDragging, onRemove, onDragHandlePointerDown }: Props) {
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
