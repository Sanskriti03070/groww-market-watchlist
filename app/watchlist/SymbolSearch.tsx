"use client";

import { useMemo, useState } from "react";
import type { SymbolInfo } from "./api";

type Props = {
  symbols: SymbolInfo[];
  watchlistSymbols: Set<string>;
  onAdd: (symbol: string) => void;
  pendingAdd: string | null;
};

function matches(symbol: SymbolInfo, query: string): boolean {
  return symbol.symbol.toLowerCase().includes(query) || symbol.name.toLowerCase().includes(query);
}

export function SymbolSearch({ symbols, watchlistSymbols, onAdd, pendingAdd }: Props) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }
    return symbols.filter((symbol) => matches(symbol, trimmed));
  }, [symbols, query]);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${symbols.length} symbols by ticker or name`}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
        aria-label="Search symbols"
      />

      {query.trim() && (
        <ul className="mt-2 flex flex-col gap-1">
          {results.length === 0 && <li className="px-1 py-2 text-sm text-muted">No symbols match &ldquo;{query}&rdquo;.</li>}
          {results.map((symbol) => {
            const alreadyAdded = watchlistSymbols.has(symbol.symbol);
            const isPending = pendingAdd === symbol.symbol;
            const disabled = alreadyAdded || isPending || !symbol.isActive;

            return (
              <li key={symbol.symbol} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{symbol.symbol}</span>{" "}
                  <span className="text-sm text-muted">{symbol.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onAdd(symbol.symbol)}
                  disabled={disabled}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-sm disabled:opacity-50"
                >
                  {alreadyAdded ? "Added" : isPending ? "Adding…" : !symbol.isActive ? "Inactive" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
