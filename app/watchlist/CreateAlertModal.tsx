"use client";

import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { formatPrice, formatSignedPercent, freshnessLabel } from "./format";
import type { AlertConditionType, AlertDirection, CreateAlertInput, SymbolInfo, WatchlistItem } from "./api";

const MAX_DAY_MOVE_PERCENT = 50;
const MAX_PRICE_LEVEL_MULTIPLE = 10;

type Props = {
  items: WatchlistItem[];
  symbolByCode: Map<string, SymbolInfo>;
  initialSymbol?: string;
  now: Date;
  submitError: string | null;
  onDismissError: () => void;
  onClose: () => void;
  onCreate: (input: CreateAlertInput) => Promise<boolean>;
};

type ConditionOption = { value: AlertConditionType; label: string };
const CONDITIONS: ConditionOption[] = [
  { value: "PRICE_LEVEL", label: "Price crosses a level" },
  { value: "DAY_MOVE", label: "Day move reaches a %" },
];

const PRICE_DIRECTIONS: { value: AlertDirection; label: string }[] = [
  { value: "ABOVE", label: "Rises above" },
  { value: "BELOW", label: "Falls below" },
];
const DAY_MOVE_DIRECTIONS: { value: AlertDirection; label: string }[] = [
  { value: "UP", label: "Moves up" },
  { value: "DOWN", label: "Moves down" },
];

function directionVerb(conditionType: AlertConditionType, direction: AlertDirection): string {
  if (conditionType === "PRICE_LEVEL") {
    return direction === "ABOVE" ? "rises above" : "falls below";
  }
  return direction === "UP" ? "moves up" : "moves down";
}

export function CreateAlertModal({ items, symbolByCode, initialSymbol, now, submitError, onDismissError, onClose, onCreate }: Props) {
  const [symbol, setSymbol] = useState<string | null>(initialSymbol ?? null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [conditionType, setConditionType] = useState<AlertConditionType | null>(null);
  const [direction, setDirection] = useState<AlertDirection | null>(null);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const item = useMemo(() => items.find((i) => i.symbol === symbol) ?? null, [items, symbol]);
  const currentPrice = item?.quote.lastPrice ? Number(item.quote.lastPrice) : null;

  const pickerResults = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    return items.filter((i) => {
      if (!query) return true;
      const info = symbolByCode.get(i.symbol);
      return i.symbol.toLowerCase().includes(query) || info?.name.toLowerCase().includes(query);
    });
  }, [items, pickerQuery, symbolByCode]);

  function chooseSymbol(next: string) {
    setSymbol(next);
    setConditionType(null);
    setDirection(null);
    setAmount("");
    setTouched(false);
    onDismissError();
  }

  function chooseCondition(next: AlertConditionType) {
    setConditionType(next);
    setDirection(null);
    setAmount("");
    setTouched(false);
  }

  const amountValue = Number(amount);
  const amountIsNumeric = amount.trim() !== "" && Number.isFinite(amountValue);

  // Computed unconditionally (not gated on `touched`) so isValid - and
  // therefore the disabled state of Create Alert - always reflects the
  // actual amount, not just what's been shown to the user yet. `touched`
  // only controls whether this surfaces as visible inline text below.
  let amountError: string | null = null;
  if (amount.trim() === "") {
    amountError = "Enter a value.";
  } else if (!amountIsNumeric || amountValue <= 0) {
    amountError = "Enter a value greater than 0.";
  } else if (conditionType === "DAY_MOVE" && amountValue > MAX_DAY_MOVE_PERCENT) {
    amountError = `Day move alerts go up to ${MAX_DAY_MOVE_PERCENT}%.`;
  } else if (conditionType === "PRICE_LEVEL" && direction !== null && currentPrice !== null) {
    const onWrongSide = direction === "ABOVE" ? amountValue <= currentPrice : amountValue >= currentPrice;
    if (onWrongSide) {
      amountError = direction === "ABOVE" ? "Target must be above the current price." : "Target must be below the current price.";
    } else if (amountValue > currentPrice * MAX_PRICE_LEVEL_MULTIPLE) {
      amountError = "That target is too far from the current price.";
    }
  }

  const validationMessage = touched ? amountError : null;
  const isValid = conditionType !== null && direction !== null && amountError === null;

  const hint =
    conditionType === "PRICE_LEVEL" && amountIsNumeric && amountValue > 0 && currentPrice
      ? `${formatSignedPercent(((amountValue - currentPrice) / currentPrice) * 100, 1)} from current`
      : null;

  const confirmation =
    isValid && symbol && conditionType && direction
      ? conditionType === "PRICE_LEVEL"
        ? `We'll alert you when ${symbol} ${directionVerb(conditionType, direction)} ${formatPrice(amountValue)}.`
        : `We'll alert you when ${symbol} ${directionVerb(conditionType, direction)} ${amountValue}% today.`
      : null;

  async function handleSubmit() {
    if (!isValid || !symbol || !conditionType || !direction) {
      setTouched(true);
      return;
    }
    setSubmitting(true);
    const ok = await onCreate({ symbol, conditionType, direction, thresholdValue: amountValue });
    setSubmitting(false);
    if (ok) {
      onClose();
    }
  }

  return (
    <Modal titleId="create-alert-title" title="Create Alert" onClose={onClose}>
      {!symbol ? (
        <SymbolPicker query={pickerQuery} onQueryChange={setPickerQuery} results={pickerResults} symbolByCode={symbolByCode} onChoose={chooseSymbol} />
      ) : (
        <div className="px-5 py-4">
          <div className="mb-4 rounded-xl border border-border bg-surface-muted px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-foreground">{symbol}</span>
              <span className="text-sm text-foreground-soft">{formatPrice(item?.quote.lastPrice ?? null)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {item ? freshnessLabel(item.quote.reliability, item.quote.fetchedAt, now).text : "No price yet"}
            </div>
          </div>

          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-medium text-foreground">Alert me when</legend>
            <div className="flex flex-col gap-2">
              {CONDITIONS.map((option) => (
                <ToggleRow key={option.value} selected={conditionType === option.value} onClick={() => chooseCondition(option.value)}>
                  {option.label}
                </ToggleRow>
              ))}
            </div>
          </fieldset>

          {conditionType && (
            <>
              <fieldset className="mb-4">
                <legend className="sr-only">Direction</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(conditionType === "PRICE_LEVEL" ? PRICE_DIRECTIONS : DAY_MOVE_DIRECTIONS).map((option) => (
                    <SegmentButton key={option.value} selected={direction === option.value} onClick={() => setDirection(option.value)}>
                      {option.label}
                    </SegmentButton>
                  ))}
                </div>
              </fieldset>

              {direction && (
                <div className="mb-1">
                  <label htmlFor="alert-amount" className="mb-1.5 block text-sm font-medium text-foreground">
                    {conditionType === "PRICE_LEVEL" ? "Target price" : "Move (%)"}
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
                      {conditionType === "PRICE_LEVEL" ? "₹" : "%"}
                    </span>
                    <input
                      id="alert-amount"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      onBlur={() => setTouched(true)}
                      placeholder="0.00"
                      autoFocus
                      aria-invalid={validationMessage !== null}
                      aria-describedby="alert-amount-hint"
                      className="w-full rounded-lg border border-border bg-surface px-7 py-2.5 text-foreground outline-none focus-visible:border-green"
                    />
                  </div>
                  <div id="alert-amount-hint" className="mt-1.5 min-h-[1.25rem] text-xs">
                    {validationMessage ? (
                      <span className="text-red">{validationMessage}</span>
                    ) : hint ? (
                      <span className="text-muted">{hint}</span>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}

          {confirmation && <p className="mb-4 rounded-lg bg-green-soft px-3 py-2.5 text-sm text-green-strong">{confirmation}</p>}

          {submitError && <p className="mb-3 text-sm text-red">{submitError}</p>}

          <div className="mt-2 flex items-center justify-between gap-3">
            <button type="button" onClick={() => (initialSymbol ? onClose() : setSymbol(null))} className="text-sm text-muted hover:text-foreground">
              {initialSymbol ? "Cancel" : "Back"}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !isValid}
              className="rounded-lg bg-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Alert"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SymbolPicker({
  query,
  onQueryChange,
  results,
  symbolByCode,
  onChoose,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  results: WatchlistItem[];
  symbolByCode: Map<string, SymbolInfo>;
  onChoose: (symbol: string) => void;
}) {
  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-sm text-muted">Choose a stock from your watchlist to alert on.</p>
      {results.length > 6 && (
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search your watchlist"
          className="mb-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:border-green"
          aria-label="Search your watchlist"
        />
      )}
      <ul className="scroll-rail flex max-h-72 flex-col gap-1 overflow-y-auto">
        {results.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted">No matching stocks.</li>}
        {results.map((item) => (
          <li key={item.symbol}>
            <button
              type="button"
              onClick={() => onChoose(item.symbol)}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-muted"
            >
              <span className="min-w-0">
                <span className="font-medium text-foreground">{item.symbol}</span>{" "}
                <span className="truncate text-sm text-muted">{symbolByCode.get(item.symbol)?.name}</span>
              </span>
              <span className="shrink-0 text-sm text-muted">{formatPrice(item.quote.lastPrice)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToggleRow({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
        selected ? "border-green bg-green-soft text-green-strong" : "border-border text-foreground-soft hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}

function SegmentButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        selected ? "border-green bg-green-soft text-green-strong" : "border-border text-foreground-soft hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}
