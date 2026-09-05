"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useWatchlist } from "./use-watchlist";
import { useAlerts } from "./use-alerts";
import { useNow } from "./use-now";
import { AddStockModal } from "./AddStockModal";
import { AlertsSection } from "./AlertsSection";
import { CreateAlertModal } from "./CreateAlertModal";
import { WatchlistList } from "./WatchlistList";
import { WatchlistToolbar, type WatchlistRowFilter, type WatchlistSort } from "./WatchlistToolbar";
import type { SinceLastCheck, SymbolInfo, WatchlistItem } from "./api";

function matchesQuery(symbol: string, name: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return symbol.toLowerCase().includes(q) || (name?.toLowerCase().includes(q) ?? false);
}

/** "Needs attention" is the existing C meaningful-change result; "No significant change" is a trustworthy observation that didn't clear that threshold. Untrustworthy/unavailable data (NO_BASELINE, NOT_COMPARABLE) falls under neither - it's still visible under "All". No threshold math happens here, only branching on the server's own SinceLastCheck.kind. */
function matchesRowFilter(item: WatchlistItem, filter: WatchlistRowFilter): boolean {
  if (filter === "needsAttention") {
    return item.sinceLastCheck.kind === "MEANINGFUL";
  }
  if (filter === "noSignificantChange") {
    return item.sinceLastCheck.kind === "BELOW_THRESHOLD" || item.sinceLastCheck.kind === "UNCHANGED_SESSION";
  }
  return true;
}

/** The since-last-check magnitude, for the "most changed" sort - only MEANINGFUL and BELOW_THRESHOLD carry a deltaPercent at all; anything else has no comparable value and sorts last. */
function sinceLastCheckMagnitude(state: SinceLastCheck): number | null {
  return state.kind === "MEANINGFUL" || state.kind === "BELOW_THRESHOLD" ? Math.abs(state.deltaPercent) : null;
}

function compareNullsLast(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction * (a - b);
}

function sortItems(items: WatchlistItem[], sort: WatchlistSort): WatchlistItem[] {
  if (sort === "") {
    return items;
  }
  const sorted = [...items];
  switch (sort) {
    case "recentlyAdded":
      sorted.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
      break;
    case "mostChangedSinceCheck":
      sorted.sort((a, b) => compareNullsLast(sinceLastCheckMagnitude(a.sinceLastCheck), sinceLastCheckMagnitude(b.sinceLastCheck), -1));
      break;
    case "biggestMoveToday":
      sorted.sort((a, b) => {
        const aMove = a.quote.changePercent === null ? null : Math.abs(a.quote.changePercent);
        const bMove = b.quote.changePercent === null ? null : Math.abs(b.quote.changePercent);
        return compareNullsLast(aMove, bMove, -1);
      });
      break;
    case "priceHighLow":
      sorted.sort((a, b) => compareNullsLast(a.quote.lastPrice === null ? null : Number(a.quote.lastPrice), b.quote.lastPrice === null ? null : Number(b.quote.lastPrice), -1));
      break;
    case "priceLowHigh":
      sorted.sort((a, b) => compareNullsLast(a.quote.lastPrice === null ? null : Number(a.quote.lastPrice), b.quote.lastPrice === null ? null : Number(b.quote.lastPrice), 1));
      break;
  }
  return sorted;
}

const PANEL = "rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6";

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

  const alertsHook = useAlerts(status === "ready");
  const now = useNow(15000);

  const [addStockOpen, setAddStockOpen] = useState(false);
  const [createAlertOpen, setCreateAlertOpen] = useState(false);
  const [createAlertSymbol, setCreateAlertSymbol] = useState<string | undefined>(undefined);
  const [watchlistQuery, setWatchlistQuery] = useState("");
  const [watchlistFilter, setWatchlistFilter] = useState<WatchlistRowFilter>("all");
  const [watchlistSort, setWatchlistSort] = useState<WatchlistSort>("");

  const symbolByCode = useMemo<Map<string, SymbolInfo>>(() => new Map(symbols.map((symbol) => [symbol.symbol, symbol])), [symbols]);
  const watchlistSymbols = useMemo(() => new Set(items.map((item) => item.symbol)), [items]);
  const quoteBySymbol = useMemo(() => new Map(items.map((item) => [item.symbol, item.quote])), [items]);

  const filteredItems = useMemo(() => {
    const filtered = items.filter(
      (item) => matchesQuery(item.symbol, symbolByCode.get(item.symbol)?.name, watchlistQuery) && matchesRowFilter(item, watchlistFilter),
    );
    return sortItems(filtered, watchlistSort);
  }, [items, symbolByCode, watchlistQuery, watchlistFilter, watchlistSort]);

  const reorderEnabled = watchlistQuery.trim() === "" && watchlistFilter === "all" && watchlistSort === "";

  function openCreateAlert(symbol?: string) {
    setCreateAlertSymbol(symbol);
    setCreateAlertOpen(true);
  }

  if (status === "loading") {
    return (
      <main className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <PageSkeleton />
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="mx-auto flex w-full max-w-[1400px] flex-col items-start gap-3 px-4 py-14 sm:px-6 lg:px-8">
        <p className="text-foreground-soft">{loadError}</p>
        <button
          type="button"
          onClick={retryBootstrap}
          className="rounded-lg border border-border px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
        >
          Try again
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="mb-6">
       <h1 className="text-2xl font-semibold text-blue-600">Watchlist</h1> 
        <p className="mt-1 text-sm text-muted">Track stocks and Create alerts</p>
      </div>

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
      {alertsHook.actionError && (
        <Banner tone="error" onDismiss={alertsHook.dismissActionError}>
          {alertsHook.actionError}
        </Banner>
      )}

      <div className={`mb-6 ${PANEL}`}>
        <AlertsSection
          alerts={alertsHook.alerts}
          status={alertsHook.status}
          loadError={alertsHook.loadError}
          filter={alertsHook.filter}
          onFilterChange={alertsHook.setFilter}
          sort={alertsHook.sort}
          onSortChange={alertsHook.setSort}
          pendingIds={alertsHook.pendingIds}
          now={now}
          quoteBySymbol={quoteBySymbol}
          symbolByCode={symbolByCode}
          onEdit={(id, thresholdValue, direction) => alertsHook.edit(id, alertsHook.alerts.find((a) => a.id === id)?.version ?? 0, thresholdValue, direction)}
          onEnable={(id) => alertsHook.enable(id)}
          onDisable={(id) => alertsHook.disable(id)}
          onDismiss={(id) => alertsHook.dismiss(id)}
          onDelete={(id) => alertsHook.remove(id)}
          onCreateClick={() => openCreateAlert(undefined)}
          hasWatchlistItems={items.length > 0}
        />
      </div>

      <div className={PANEL}>
        <WatchlistToolbar
          query={watchlistQuery}
          onQueryChange={setWatchlistQuery}
          filter={watchlistFilter}
          onFilterChange={setWatchlistFilter}
          sort={watchlistSort}
          onSortChange={setWatchlistSort}
          onAddStockClick={() => setAddStockOpen(true)}
        />

        {items.length === 0 ? (
          <EmptyWatchlist onAddStockClick={() => setAddStockOpen(true)} />
        ) : filteredItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface-muted px-4 py-8 text-center text-sm text-muted">
            No stocks match your search or filter.
          </p>
        ) : (
          <WatchlistList
            items={filteredItems}
            symbolByCode={symbolByCode}
            now={now}
            onReorder={reorder}
            onRemove={removeSymbol}
            onCreateAlert={openCreateAlert}
            pendingRemove={pendingRemove}
            isReordering={isReordering}
            reorderEnabled={reorderEnabled}
          />
        )}
      </div>

      {addStockOpen && (
        <AddStockModal
          symbols={symbols}
          watchlistSymbols={watchlistSymbols}
          pendingAdd={pendingAdd}
          onAdd={addSymbol}
          onClose={() => setAddStockOpen(false)}
        />
      )}

      {createAlertOpen && (
        <CreateAlertModal
          items={items}
          symbolByCode={symbolByCode}
          initialSymbol={createAlertSymbol}
          now={now}
          submitError={alertsHook.actionError}
          onDismissError={alertsHook.dismissActionError}
          onClose={() => setCreateAlertOpen(false)}
          onCreate={alertsHook.create}
        />
      )}
    </main>
  );
}

function EmptyWatchlist({ onAddStockClick }: { onAddStockClick: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-muted px-4 py-10 text-center">
      <p className="mb-3 text-sm text-muted">Your watchlist is empty.</p>
      <button
        type="button"
        onClick={onAddStockClick}
        className="rounded-lg bg-green px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-strong"
      >
        + Add Stock
      </button>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-6 h-7 w-40 rounded bg-surface-muted" />
      <div className={`mb-6 ${PANEL}`}>
        <div className="flex gap-3">
          <div className="h-[104px] w-64 rounded-xl bg-surface-muted sm:w-72" />
          <div className="hidden h-[104px] w-72 rounded-xl bg-surface-muted sm:block" />
        </div>
      </div>
      <div className={PANEL}>
        <div className="mb-3 h-9 w-full rounded-lg bg-surface-muted" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-surface-muted" />
          ))}
        </div>
      </div>
    </div>
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
        tone === "error" ? "border-red-soft-border bg-red-soft text-red" : "border-green-soft-border bg-green-soft text-green-strong"
      }`}
    >
      <span>{children}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}
