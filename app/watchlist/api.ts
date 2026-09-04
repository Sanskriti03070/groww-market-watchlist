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

export type WatchlistItem = {
  symbol: string;
  position: number;
  addedAt: string;
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
