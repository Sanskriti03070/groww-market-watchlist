"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { WatchlistItemRow } from "./WatchlistItemRow";
import type { SymbolInfo, WatchlistItem } from "./api";

type Props = {
  items: WatchlistItem[];
  symbolByCode: Map<string, SymbolInfo>;
  now: Date;
  onReorder: (symbols: string[]) => Promise<void>;
  onRemove: (symbol: string) => void;
  onCreateAlert: (symbol: string) => void;
  pendingRemove: string | null;
  isReordering: boolean;
  /** False while a search/filter/sort narrows or reorders what's shown - reordering a partial or resorted view isn't a meaningful position edit. */
  reorderEnabled: boolean;
};

const HEADERS = ["Stock", "Price", "Day%", "Volume", "Since Last Check", "Market Status", "Actions"] as const;

function moveSymbol(order: string[], symbol: string, toIndex: number): string[] {
  const fromIndex = order.indexOf(symbol);
  if (fromIndex === -1 || fromIndex === toIndex) {
    return order;
  }
  const next = order.slice();
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, symbol);
  return next;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function symbolUnderPoint(x: number, y: number): string | null {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-symbol]");
  return row?.dataset.symbol ?? null;
}

export function WatchlistList({
  items,
  symbolByCode,
  now,
  onReorder,
  onRemove,
  onCreateAlert,
  pendingRemove,
  isReordering,
  reorderEnabled,
}: Props) {
  const [dragSymbol, setDragSymbol] = useState<string | null>(null);
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);

  const displayOrder = optimisticOrder ?? items.map((item) => item.symbol);
  const itemBySymbol = new Map(items.map((item) => [item.symbol, item]));

  function startDrag(symbol: string) {
    return (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (optimisticOrder !== null) {
        return;
      }
      event.preventDefault();

      const startOrder = items.map((item) => item.symbol);
      let currentOrder = startOrder;
      setDragSymbol(symbol);
      setOptimisticOrder(startOrder);

      function onMove(moveEvent: globalThis.PointerEvent) {
        const hovered = symbolUnderPoint(moveEvent.clientX, moveEvent.clientY);
        const toIndex = hovered ? currentOrder.indexOf(hovered) : -1;
        if (toIndex === -1) {
          return;
        }
        currentOrder = moveSymbol(currentOrder, symbol, toIndex);
        setOptimisticOrder(currentOrder);
      }

      async function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        setDragSymbol(null);

        if (!arraysEqual(currentOrder, startOrder)) {
          await onReorder(currentOrder);
        }
        setOptimisticOrder(null);
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };
  }

  return (
    <div>
      {isReordering && <p className="mb-2 text-sm text-muted">Saving order…</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              {HEADERS.map((header, index) => (
                <th key={header} scope="col" className={`px-3 pb-1 font-medium sm:px-4 ${index === 0 ? "text-left" : "text-right"}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayOrder.map((symbol) => {
              const item = itemBySymbol.get(symbol);
              if (!item) return null;
              return (
                <WatchlistItemRow
                  key={symbol}
                  symbol={symbol}
                  info={symbolByCode.get(symbol)}
                  quote={item.quote}
                  sinceLastCheck={item.sinceLastCheck}
                  now={now}
                  isPending={pendingRemove === symbol}
                  isDragging={dragSymbol === symbol}
                  reorderEnabled={reorderEnabled}
                  onRemove={() => onRemove(symbol)}
                  onCreateAlert={() => onCreateAlert(symbol)}
                  onDragHandlePointerDown={startDrag(symbol)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
