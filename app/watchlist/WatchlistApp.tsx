"use client";

import { useMemo, type ReactNode } from "react";
import { useWatchlist } from "./use-watchlist";
import { SymbolSearch } from "./SymbolSearch";
import { WatchlistList } from "./WatchlistList";

export function WatchlistApp() {
  const {
    status,
    loadError,
    items,
    symbols,
    actionError,
    reorderNotice,
    pendingAdd,
    pendingRemove,
    isReordering,
    retryBootstrap,
    dismissActionError,
    dismissReorderNotice,
    addSymbol,
    removeSymbol,
    reorder,
  } = useWatchlist();

  const symbolByCode = useMemo(() => new Map(symbols.map((symbol) => [symbol.symbol, symbol])), [symbols]);
  const watchlistSymbols = useMemo(() => new Set(items.map((item) => item.symbol)), [items]);

  if (status === "loading") {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <p className="text-muted">Loading your watchlist…</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <p className="mb-3 text-danger">{loadError}</p>
        <button
          type="button"
          onClick={retryBootstrap}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Try again
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-semibold">Watchlist</h1>

      {actionError && (
        <Banner tone="error" onDismiss={dismissActionError}>
          {actionError}
        </Banner>
      )}
      {reorderNotice && (
        <Banner tone="notice" onDismiss={dismissReorderNotice}>
          {reorderNotice}
        </Banner>
      )}

      <section className="mb-8">
        <SymbolSearch symbols={symbols} watchlistSymbols={watchlistSymbols} onAdd={addSymbol} pendingAdd={pendingAdd} />
      </section>

      <section>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted">
            Your watchlist is empty. Search above to add a symbol.
          </p>
        ) : (
          <WatchlistList
            items={items}
            symbolByCode={symbolByCode}
            onReorder={reorder}
            onRemove={removeSymbol}
            pendingRemove={pendingRemove}
            isReordering={isReordering}
          />
        )}
      </section>
    </main>
  );
}

function Banner({
  tone,
  onDismiss,
  children,
}: {
  tone: "error" | "notice";
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
        tone === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-accent/30 bg-accent/10 text-accent"
      }`}
    >
      <span>{children}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}
