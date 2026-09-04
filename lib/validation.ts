// Minimal request-body validation. Bodies for this slice are small enough
// that hand-written checks are clearer than pulling in a schema-validation
// library for two shapes.

import { MAX_WATCHLIST_SIZE } from "@/lib/watchlist";

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.&-]{0,19}$/;

export function isValidSymbolFormat(value: unknown): value is string {
  return typeof value === "string" && SYMBOL_PATTERN.test(value);
}

export function parseAddItemBody(body: unknown): { symbol: string } | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { symbol } = body as Record<string, unknown>;
  if (!isValidSymbolFormat(symbol)) {
    return null;
  }
  return { symbol };
}

export function parseOrderBody(body: unknown): { symbols: string[] } | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { symbols } = body as Record<string, unknown>;
  if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > MAX_WATCHLIST_SIZE) {
    return null;
  }
  if (!symbols.every(isValidSymbolFormat)) {
    return null;
  }
  if (new Set(symbols).size !== symbols.length) {
    return null; // duplicate symbols in the submitted order
  }
  return { symbols: symbols as string[] };
}
