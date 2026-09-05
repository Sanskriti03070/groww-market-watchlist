"use client";

import { useEffect, useState } from "react";

/** A Date that re-renders its consumer every `intervalMs` - the only clock any "time ago" copy in this app reads from. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
