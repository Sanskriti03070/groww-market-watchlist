"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { WatchlistItemRow } from "./WatchlistItemRow";
import type { SymbolInfo, WatchlistItem } from "./api";

type Props = {
  items: WatchlistItem[];
  symbolByCode: Map<string, SymbolInfo>;
  onReorder: (symbols: string[]) => Promise<void>;
  onRemove: (symbol: string) => void;
  pendingRemove: string | null;
  isReordering: boolean;
};

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

export function WatchlistList({ items, symbolByCode, onReorder, onRemove, pendingRemove, isReordering }: Props) {
  const [dragSymbol, setDragSymbol] = useState<string | null>(null);
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);

  const displayOrder = optimisticOrder ?? items.map((item) => item.symbol);

  function startDrag(symbol: string) {
    return (event: ReactPointerEvent<HTMLButtonElement>) => {
      // A reorder from the previous drag is still saving; the position set
      // it's about to commit to isn't final yet, so don't let a second drag
      // start from a mid-flight order.
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
      <ul className="flex flex-col gap-2">
        {displayOrder.map((symbol) => (
          <WatchlistItemRow
            key={symbol}
            symbol={symbol}
            info={symbolByCode.get(symbol)}
            isPending={pendingRemove === symbol}
            isDragging={dragSymbol === symbol}
            onRemove={() => onRemove(symbol)}
            onDragHandlePointerDown={startDrag(symbol)}
          />
        ))}
      </ul>
    </div>
  );
}
