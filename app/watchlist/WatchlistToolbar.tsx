"use client";

export type WatchlistRowFilter = "all" | "needsAttention" | "noSignificantChange";
/** "" is the neutral, drag-reorderable state (the watchlist's own saved order) - every other value is an explicit, non-reorderable view. */
export type WatchlistSort = "" | "recentlyAdded" | "mostChangedSinceCheck" | "biggestMoveToday" | "priceHighLow" | "priceLowHigh";

const FILTERS: { value: WatchlistRowFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needsAttention", label: "Needs attention" },
  { value: "noSignificantChange", label: "No significant change" },
];

const SORTS: { value: WatchlistSort; label: string }[] = [
  { value: "", label: "My order" },
  { value: "recentlyAdded", label: "Recently added" },
  { value: "mostChangedSinceCheck", label: "Most changed since last check" },
  { value: "biggestMoveToday", label: "Biggest move today" },
  { value: "priceHighLow", label: "Price (high to low)" },
  { value: "priceLowHigh", label: "Price (low to high)" },
];

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  filter: WatchlistRowFilter;
  onFilterChange: (filter: WatchlistRowFilter) => void;
  sort: WatchlistSort;
  onSortChange: (sort: WatchlistSort) => void;
  onAddStockClick: () => void;
};

export function WatchlistToolbar({ query, onQueryChange, filter, onFilterChange, sort, onSortChange, onAddStockClick }: Props) {
  return (
    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex w-full items-center gap-1.5 text-xs text-muted sm:max-w-64">
          Search
          <div className="relative w-full">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-soft" />
            <input
              type="text"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search your watchlist"
              aria-label="Search your watchlist"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm text-foreground outline-none focus-visible:border-green"
            />
          </div>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          Filter
          <select
            value={filter}
            onChange={(event) => onFilterChange(event.target.value as WatchlistRowFilter)}
            aria-label="Filter watchlist"
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus-visible:border-green"
          >
            {FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          Sort
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as WatchlistSort)}
            aria-label="Sort watchlist"
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus-visible:border-green"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={onAddStockClick}
        className="shrink-0 rounded-lg bg-green px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-strong"
      >
        + Add Stock
      </button>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
