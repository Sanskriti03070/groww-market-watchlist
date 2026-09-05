"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createAlertRequest,
  deleteAlertRequest,
  disableAlertRequest,
  dismissAlertRequest,
  editAlertRequest,
  enableAlertRequest,
  fetchAlerts,
  WatchlistApiError,
  type AlertDirection,
  type AlertFilter,
  type AlertSort,
  type AlertView,
  type CreateAlertInput,
} from "./api";

function messageFor(error: unknown): string {
  return error instanceof WatchlistApiError ? error.message : "Something went wrong. Please try again.";
}

/**
 * `ready` gates the initial fetch on the watchlist bootstrap having
 * already resolved an owner - fetching alerts in parallel with that
 * bootstrap would race owner creation: a 401 caught here has no retry of
 * its own, so firing before an owner definitely exists could leave this
 * list stuck empty even after the watchlist finishes loading.
 */
export function useAlerts(ready: boolean) {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sort, setSort] = useState<AlertSort>("attention");
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (nextSort: AlertSort, nextFilter: AlertFilter) => {
    setStatus("loading");
    setLoadError(null);
    try {
      const result = await fetchAlerts({ sort: nextSort, filter: nextFilter });
      setAlerts(result.alerts);
      setStatus("ready");
    } catch (error) {
      setLoadError(messageFor(error));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(sort, filter);
  }, [load, sort, filter, ready]);

  const withPending = useCallback(async <T,>(id: string, action: () => Promise<T>): Promise<T | null> => {
    setActionError(null);
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      return await action();
    } catch (error) {
      setActionError(messageFor(error));
      return null;
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const refresh = useCallback(() => load(sort, filter), [load, sort, filter]);

  const create = useCallback(
    async (input: CreateAlertInput): Promise<boolean> => {
      setActionError(null);
      try {
        await createAlertRequest(input);
        await refresh();
        return true;
      } catch (error) {
        setActionError(messageFor(error));
        return false;
      }
    },
    [refresh],
  );

  const edit = useCallback(
    async (id: string, expectedVersion: number, thresholdValue: number, direction: AlertDirection): Promise<boolean> => {
      const result = await withPending(id, () => editAlertRequest(id, { expectedVersion, thresholdValue, direction }));
      if (result) {
        await refresh();
      }
      return result !== null;
    },
    [withPending, refresh],
  );

  const enable = useCallback(
    (id: string) =>
      withPending(id, () => enableAlertRequest(id)).then((result) => {
        if (result) setAlerts((prev) => prev.map((a) => (a.id === id ? result.alert : a)));
        return result !== null;
      }),
    [withPending],
  );

  const disable = useCallback(
    (id: string) =>
      withPending(id, () => disableAlertRequest(id)).then((result) => {
        if (result) setAlerts((prev) => prev.map((a) => (a.id === id ? result.alert : a)));
        return result !== null;
      }),
    [withPending],
  );

  const dismiss = useCallback(
    (id: string) =>
      withPending(id, () => dismissAlertRequest(id)).then((result) => {
        if (result) setAlerts((prev) => prev.map((a) => (a.id === id ? result.alert : a)));
        return result !== null;
      }),
    [withPending],
  );

  const remove = useCallback(
    (id: string) =>
      withPending(id, () => deleteAlertRequest(id)).then((result) => {
        if (result) setAlerts((prev) => prev.filter((a) => a.id !== id));
        return result !== null;
      }),
    [withPending],
  );

  return {
    alerts,
    status,
    loadError,
    sort,
    setSort,
    filter,
    setFilter,
    actionError,
    dismissActionError: useCallback(() => setActionError(null), []),
    pendingIds,
    create,
    edit,
    enable,
    disable,
    dismiss,
    remove,
    refresh,
  };
}
