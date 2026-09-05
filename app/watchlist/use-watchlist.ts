"use client";

import { useCallback, useEffect, useState } from "react";
import {
  acknowledgeObservations,
  addWatchlistItem,
  createOwner,
  fetchSymbolUniverse,
  fetchWatchlist,
  removeWatchlistItem,
  reorderWatchlistItems,
  WatchlistApiError,
  type SymbolInfo,
  type WatchlistItem,
} from "./api";

const ACK_RETRY_DELAY_MS = 2000;

type BootstrapStatus = "loading" | "ready" | "error";

function messageFor(error: unknown): string {
  return error instanceof WatchlistApiError ? error.message : "Something went wrong. Please try again.";
}

async function fetchWatchlistAndUniverse(): Promise<[WatchlistItem[], SymbolInfo[]]> {
  const [watchlist, universe] = await Promise.all([fetchWatchlist(), fetchSymbolUniverse()]);
  return [watchlist.items, universe.symbols];
}

/**
 * Loads the watchlist and symbol universe, provisioning an owner on first
 * visit. Both requests need a credential, so both are retried together after
 * creating one - retrying only the watchlist fetch would leave the symbols
 * fetch's 401 to fail the whole bootstrap regardless. Owner creation is
 * still only ever a reaction to a 401 here, never a side effect of the GET
 * itself - the server never creates an owner from a GET.
 */
async function loadWatchlist(): Promise<[WatchlistItem[], SymbolInfo[]]> {
  try {
    return await fetchWatchlistAndUniverse();
  } catch (error) {
    const isNoCredential = error instanceof WatchlistApiError && error.status === 401;
    if (!isNoCredential) {
      throw error;
    }
    await createOwner();
    return await fetchWatchlistAndUniverse();
  }
}

export function useWatchlist() {
  const [status, setStatus] = useState<BootstrapStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reorderNotice, setReorderNotice] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);

  const bootstrap = useCallback(async () => {
    setStatus("loading");
    setLoadError(null);
    try {
      const [watchlistItems, symbolUniverse] = await loadWatchlist();
      setItems(watchlistItems);
      setSymbols(symbolUniverse);
      setStatus("ready");
    } catch (error) {
      setLoadError(messageFor(error));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // bootstrap() only sets state after an await (network response), never
    // synchronously during this render - the compiler's static check can't
    // see that and flags any effect that reaches a setState call at all.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void bootstrap();
  }, [bootstrap]);

  // Fires after a render actually committed this data (not merely when the
  // fetch resolved). Collects whatever observation tokens that render
  // carries and acknowledges them in one batch; a failure gets one retry
  // and then gives up silently - this must never surface to the user.
  useEffect(() => {
    const tokens = items.map((item) => item.observationToken).filter((token): token is string => Boolean(token));
    if (tokens.length === 0) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        await acknowledgeObservations(tokens);
        return;
      } catch {
        // retry once below
      }
      await new Promise((resolve) => setTimeout(resolve, ACK_RETRY_DELAY_MS));
      if (cancelled) {
        return;
      }
      try {
        await acknowledgeObservations(tokens);
      } catch {
        // Silently give up.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items]);

  const addSymbol = useCallback(async (symbol: string) => {
    setActionError(null);
    setPendingAdd(symbol);
    try {
      const result = await addWatchlistItem(symbol);
      setItems(result.items);
    } catch (error) {
      setActionError(messageFor(error));
    } finally {
      setPendingAdd(null);
    }
  }, []);

  const removeSymbol = useCallback(async (symbol: string) => {
    setActionError(null);
    setPendingRemove(symbol);
    try {
      const result = await removeWatchlistItem(symbol);
      setItems(result.items);
    } catch (error) {
      setActionError(messageFor(error));
    } finally {
      setPendingRemove(null);
    }
  }, []);

  const reorder = useCallback(async (orderedSymbols: string[]) => {
    setActionError(null);
    setReorderNotice(null);
    setIsReordering(true);
    try {
      const result = await reorderWatchlistItems(orderedSymbols);
      setItems(result.items);
    } catch (error) {
      if (error instanceof WatchlistApiError && error.status === 409) {
        // Stale permutation: the approved contract is refetch-and-replace,
        // never a client-side merge of the attempted order.
        try {
          const fresh = await fetchWatchlist();
          setItems(fresh.items);
          setReorderNotice("The list changed elsewhere, so the latest order was restored.");
        } catch (refetchError) {
          setActionError(messageFor(refetchError));
        }
      } else {
        setActionError(messageFor(error));
      }
    } finally {
      setIsReordering(false);
    }
  }, []);

  return {
    status,
    loadError,
    items,
    symbols,
    actionError,
    reorderNotice,
    pendingAdd,
    pendingRemove,
    isReordering,
    retryBootstrap: bootstrap,
    dismissActionError: useCallback(() => setActionError(null), []),
    dismissReorderNotice: useCallback(() => setReorderNotice(null), []),
    addSymbol,
    removeSymbol,
    reorder,
  };
}
