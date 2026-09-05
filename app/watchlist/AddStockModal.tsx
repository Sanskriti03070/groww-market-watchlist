"use client";

import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { StockAvatar } from "./StockAvatar";
import type { SymbolInfo } from "./api";

type Props = {
  symbols: SymbolInfo[];
  watchlistSymbols: Set<string>;
  pendingAdd: string | null;
  onAdd: (symbol: string) => void;
  onClose: () => void;
};

function matches(symbol: SymbolInfo, query: string): boolean {
  return symbol.symbol.toLowerCase().includes(query) || symbol.name.toLowerCase().includes(query);
}

export function AddStockModal({ symbols, watchlistSymbols, pendingAdd, onAdd, onClose }: Props) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return trimmed ? symbols.filter((symbol) => matches(symbol, trimmed)) : symbols;
  }, [symbols, query]);

  return (
    <Modal titleId="add-stock-title" title="Add Stock" onClose={onClose} widthClassName="max-w-lg">
      <div className="border-b border-border px-5 py-3">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${symbols.length} companies by ticker or name`}
          aria-label="Search companies"
          autoFocus
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:border-green"
        />
      </div>

      <ul className="scroll-rail max-h-[26rem] overflow-y-auto px-2 py-2">
        {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">No companies match &ldquo;{query}&rdquo;.</li>}
        {results.map((symbol) => {
          const alreadyAdded = watchlistSymbols.has(symbol.symbol);
          const isPending = pendingAdd === symbol.symbol;
          const disabled = alreadyAdded || isPending || !symbol.isActive;

          return (
            <li key={symbol.symbol}>
              <button
                type="button"
                onClick={() => onAdd(symbol.symbol)}
                disabled={disabled}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-muted disabled:hover:bg-transparent"
              >
                <StockAvatar symbol={symbol.symbol} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{symbol.symbol}</span>{" "}
                  <span className="truncate text-sm text-muted">{symbol.name}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    alreadyAdded
                      ? "bg-green-soft text-green-strong"
                      : !symbol.isActive
                        ? "bg-surface-muted text-muted"
                        : "border border-border text-foreground-soft group-hover:border-border-strong"
                  }`}
                >
                  {alreadyAdded ? "Added" : isPending ? "Adding…" : !symbol.isActive ? "Inactive" : "Add"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
