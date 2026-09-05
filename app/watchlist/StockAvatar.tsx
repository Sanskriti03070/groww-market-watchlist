// No reliable local logo assets exist for the symbol universe (see
// public/) and this app doesn't pull in an external logo service - a
// plain initial badge is the clean, dependency-free stand-in.

export function StockAvatar({ symbol }: { symbol: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-xs font-semibold text-foreground-soft"
    >
      {symbol.slice(0, 2)}
    </span>
  );
}
