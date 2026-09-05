"use client";

import type { PointerEvent } from "react";
import type { Quote, SinceLastCheck, SymbolInfo } from "./api";
import { formatPercent, formatPrice, formatSignedPercent, formatSignedPriceChange, formatVolume, freshnessLabel, movementTone } from "./format";
import { InfoPopover } from "./InfoPopover";
import { StockAvatar } from "./StockAvatar";

type Props = {
  symbol: string;
  info: SymbolInfo | undefined;
  quote: Quote;
  sinceLastCheck: SinceLastCheck;
  now: Date;
  isPending: boolean;
  isDragging: boolean;
  reorderEnabled: boolean;
  onRemove: () => void;
  onCreateAlert: () => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
};

const FRESHNESS_TONE: Record<ReturnType<typeof freshnessLabel>["tone"], string> = {
  live: "text-green",
  muted: "text-muted",
  stale: "text-yellow",
  unavailable: "text-muted-soft",
};

/**
 * Only MEANINGFUL is presented as a value; BELOW_THRESHOLD keeps the
 * existing plain dash. Both get a small explanatory label + info popover
 * underneath, since both carry a real backend-computed threshold/delta
 * comparison to explain - NO_BASELINE/NOT_COMPARABLE/UNCHANGED_SESSION do
 * not, so they stay a bare dash with no affordance (nothing to explain).
 */
function SinceLastCheckCell({ state }: { state: SinceLastCheck }) {
  if (state.kind === "MEANINGFUL") {
    const tone = state.direction === "DOWN" ? "text-red" : "text-green";
    const arrow = state.direction === "UP" ? "↑" : "↓";
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className={`font-medium ${tone}`}>
          {arrow}
          {Math.abs(state.deltaPercent).toFixed(1)}%
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted">
          Meaningful change
          <InfoPopover label="Why is this meaningful?">
            <ThresholdExplanation meaningful deltaPercent={state.deltaPercent} thresholdPercent={state.thresholdPercent} />
          </InfoPopover>
        </span>
      </div>
    );
  }

  if (state.kind === "BELOW_THRESHOLD") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-muted-soft">—</span>
        <span className="flex items-center gap-1 text-[11px] text-muted">
          No significant change
          <InfoPopover label="Why is this not significant?">
            <ThresholdExplanation meaningful={false} deltaPercent={state.deltaPercent} thresholdPercent={state.thresholdPercent} />
          </InfoPopover>
        </span>
      </div>
    );
  }

  return <span className="text-muted-soft">—</span>;
}

function ThresholdExplanation({
  meaningful,
  deltaPercent,
  thresholdPercent,
}: {
  meaningful: boolean;
  deltaPercent: number;
  thresholdPercent: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold text-foreground">{meaningful ? "Why is this meaningful?" : "Why is this not significant?"}</p>
      <p>This stock&rsquo;s threshold adapts to its recent trading activity.</p>
      <p>Threshold: {formatPercent(thresholdPercent)}</p>
      <p>
        Your stock moved {formatSignedPercent(deltaPercent)} since your last check, which is {meaningful ? "above" : "below"} the
        threshold.
      </p>
    </div>
  );
}

export function WatchlistItemRow({
  symbol,
  info,
  quote,
  sinceLastCheck,
  now,
  isPending,
  isDragging,
  reorderEnabled,
  onRemove,
  onCreateAlert,
  onDragHandlePointerDown,
}: Props) {
  const tone = movementTone(quote.changePercent);
  const freshness = freshnessLabel(quote.reliability, quote.fetchedAt, now);
  const dayTone = tone === "up" ? "text-green" : tone === "down" ? "text-red" : "text-muted";

  return (
    <tr data-symbol={symbol} className={`bg-surface transition-opacity ${isDragging ? "opacity-50" : ""}`}>
      <td className="rounded-l-xl border-y border-l border-border px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2.5">
          {reorderEnabled ? (
            <button
              type="button"
              aria-label={`Reorder ${symbol}`}
              onPointerDown={onDragHandlePointerDown}
              className="hidden shrink-0 cursor-grab touch-none select-none rounded p-1 text-muted-soft hover:text-muted active:cursor-grabbing md:block"
            >
              ⠿
            </button>
          ) : (
            <span className="hidden w-[22px] shrink-0 md:block" aria-hidden="true" />
          )}
          <StockAvatar symbol={symbol} />
          <div className="min-w-0">
            <div className="font-semibold text-foreground">{symbol}</div>
            {info && <div className="truncate text-xs text-muted">{info.name}</div>}
          </div>
        </div>
      </td>

      <td className="border-y border-border px-3 py-3 text-right font-semibold text-foreground sm:px-4">{formatPrice(quote.lastPrice)}</td>

      <td className="border-y border-border px-3 py-3 text-right sm:px-4">
        <div className={`font-medium ${dayTone}`}>{formatSignedPercent(quote.changePercent)}</div>
        <div className="text-xs text-muted">{formatSignedPriceChange(quote.lastPrice, quote.previousClose)}</div>
      </td>

      <td className="border-y border-border px-3 py-3 text-right text-foreground-soft sm:px-4">{formatVolume(quote.volume)}</td>

      <td className="border-y border-border px-3 py-3 text-right sm:px-4">
        <SinceLastCheckCell state={sinceLastCheck} />
      </td>

      <td className={`border-y border-border px-3 py-3 text-right text-xs sm:px-4 ${FRESHNESS_TONE[freshness.tone]}`}>{freshness.text}</td>

      <td className="rounded-r-xl border-y border-r border-border px-3 py-3 sm:px-4">
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={onCreateAlert}
            aria-label={`Create alert for ${symbol}`}
            title="Create alert"
            className="rounded-full p-1.5 text-muted-soft transition-colors hover:bg-surface-muted hover:text-green"
          >
            <BellIcon />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={isPending}
            aria-label={`Remove ${symbol} from watchlist`}
            title="Remove"
            className="rounded-full p-1.5 text-muted-soft transition-colors hover:bg-surface-muted hover:text-red disabled:opacity-50"
          >
            {isPending ? <Spinner /> : <TrashIcon />}
          </button>
        </div>
      </td>
    </tr>
  );
}

function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5c-2 0-3.2 1.5-3.2 3.6v1.7c0 .5-.2 1-.6 1.5l-.6.8c-.4.5 0 1.2.7 1.2h9.4c.6 0 1-.7.7-1.2l-.6-.8a2.4 2.4 0 0 1-.6-1.5V6.1c0-2.1-1.2-3.6-3.2-3.6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.3 13a1.8 1.8 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M6.5 7.5v4M9.5 7.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4 4.5l.6 8.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="animate-spin" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
