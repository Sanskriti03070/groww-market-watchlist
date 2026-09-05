"use client";

import { AlertCard } from "./AlertCard";
import type { AlertDirection, AlertFilter, AlertSort, AlertView, Quote, SymbolInfo } from "./api";

const FILTERS: { value: AlertFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "nearTarget", label: "Near target" },
  { value: "triggered", label: "Triggered" },
];

const SORTS: { value: AlertSort; label: string }[] = [
  { value: "attention", label: "Needs attention" },
  { value: "nearest", label: "Nearest to target" },
  { value: "recentlyTriggered", label: "Recently triggered" },
  { value: "recentlyCreated", label: "Recently created" },
];

type Props = {
  alerts: AlertView[];
  status: "loading" | "ready" | "error";
  loadError: string | null;
  filter: AlertFilter;
  onFilterChange: (filter: AlertFilter) => void;
  sort: AlertSort;
  onSortChange: (sort: AlertSort) => void;
  pendingIds: Set<string>;
  now: Date;
  quoteBySymbol: Map<string, Quote>;
  symbolByCode: Map<string, SymbolInfo>;
  onEdit: (id: string, expectedVersion: number, thresholdValue: number, direction: AlertDirection) => Promise<boolean>;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onDismiss: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateClick: () => void;
  hasWatchlistItems: boolean;
};

export function AlertsSection({
  alerts,
  status,
  loadError,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  pendingIds,
  now,
  quoteBySymbol,
  symbolByCode,
  onEdit,
  onEnable,
  onDisable,
  onDismiss,
  onDelete,
  onCreateClick,
  hasWatchlistItems,
}: Props) {
  return (
    <section aria-labelledby="alerts-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="alerts-heading" className="text-sm font-semibold tracking-wide text-foreground-soft">
          Alerts
        </h2>
        <button
          type="button"
          onClick={onCreateClick}
          disabled={!hasWatchlistItems}
          className="rounded-lg bg-green px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Create Alert
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter alerts" className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => onFilterChange(option.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === option.value
                  ? "border-green bg-green-soft text-green-strong"
                  : "border-border text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          Sort
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as AlertSort)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus-visible:border-green"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {status === "loading" && alerts.length === 0 ? (
        <AlertsSkeleton />
      ) : status === "error" ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted">{loadError}</p>
      ) : alerts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted px-4 py-6 text-center text-sm text-muted">
          {hasWatchlistItems ? "No alerts match this filter yet." : "Add a stock to your watchlist to create your first alert."}
        </p>
      ) : (
        <ul className="scroll-rail flex snap-x gap-3 overflow-x-auto pb-2">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              quote={quoteBySymbol.get(alert.symbol)}
              companyName={symbolByCode.get(alert.symbol)?.name}
              now={now}
              pending={pendingIds.has(alert.id)}
              onEdit={(thresholdValue, direction) => onEdit(alert.id, alert.version, thresholdValue, direction)}
              onEnable={() => onEnable(alert.id)}
              onDisable={() => onDisable(alert.id)}
              onDismiss={() => onDismiss(alert.id)}
              onDelete={() => onDelete(alert.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AlertsSkeleton() {
  return (
    <div className="scroll-rail flex gap-3 overflow-x-auto pb-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[104px] w-64 shrink-0 animate-pulse rounded-xl border border-border bg-surface-muted sm:w-72" />
      ))}
    </div>
  );
}
