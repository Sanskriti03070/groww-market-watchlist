// The browser's only way to reach the watchlist backend. Mirrors the
// approved API contract exactly (see docs/ENGINEERING_DECISIONS.md) - no
// request or response shape is invented here.

export type SymbolKind = "EQUITY" | "INDEX";

export type SymbolInfo = {
  symbol: string;
  name: string;
  kind: SymbolKind;
  isActive: boolean;
};

export type Reliability = "LIVE" | "STALE" | "LAST_CLOSE" | "UNAVAILABLE_NO_DATA" | "UNAVAILABLE_TOO_OLD";

export type Quote = {
  lastPrice: string | null;
  previousClose: string | null;
  dayOpen: string | null;
  dayHigh: string | null;
  dayLow: string | null;
  weekHigh52: string | null;
  weekLow52: string | null;
  volume: number | null;
  fetchedAt: string | null;
  changePercent: number | null;
  reliability: Reliability;
};

export type SinceLastCheck =
  | { kind: "NO_BASELINE" }
  | { kind: "NOT_COMPARABLE"; reason: "CURRENT_UNTRUSTWORTHY" }
  | { kind: "UNCHANGED_SESSION" }
  | { kind: "BELOW_THRESHOLD"; deltaPercent: number; baselinePrice: number }
  | { kind: "MEANINGFUL"; direction: "UP" | "DOWN"; deltaPercent: number; baselinePrice: number; thresholdPercent: number };

export type WatchlistItem = {
  symbol: string;
  position: number;
  addedAt: string;
  quote: Quote;
  sinceLastCheck: SinceLastCheck;
  observationToken?: string;
};

export class WatchlistApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new WatchlistApiError("Couldn't reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    const body = await parseErrorBody(response);
    throw new WatchlistApiError(body?.message ?? `Request failed (${response.status}).`, response.status, body?.error);
  }

  return (await response.json()) as T;
}

async function parseErrorBody(response: Response): Promise<{ error: string; message: string } | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createOwner(): Promise<{ token: string }> {
  return request("/api/watchlists", { method: "POST" });
}

export function fetchSymbolUniverse(): Promise<{ symbols: SymbolInfo[] }> {
  return request("/api/symbols");
}

export function fetchWatchlist(): Promise<{ items: WatchlistItem[] }> {
  return request("/api/watchlist");
}

export function addWatchlistItem(symbol: string): Promise<{ items: WatchlistItem[] }> {
  return request("/api/watchlist/items", { method: "POST", body: JSON.stringify({ symbol }) });
}

export function removeWatchlistItem(symbol: string): Promise<{ items: WatchlistItem[] }> {
  return request(`/api/watchlist/items/${encodeURIComponent(symbol)}`, { method: "DELETE" });
}

export function reorderWatchlistItems(symbols: string[]): Promise<{ items: WatchlistItem[] }> {
  return request("/api/watchlist/order", { method: "PUT", body: JSON.stringify({ symbols }) });
}

export type AckResult = { acknowledged: string[]; rejected: { token: string; reason: string }[] };

export function acknowledgeObservations(tokens: string[]): Promise<AckResult> {
  return request("/api/observations/ack", { method: "POST", body: JSON.stringify({ tokens }) });
}
