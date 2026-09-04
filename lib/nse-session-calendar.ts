// Deterministic NSE (India) trading-session calendar. Pure function of an
// explicit instant - never reads the system clock - so callers control
// "now" and results are reproducible. Session state is a separate concern
// from quote freshness: nothing here looks at a quote's fetchedAt/providerTs,
// and nothing here is persisted.

import type { Instant } from "@/lib/market-quote";

export type SessionState = "OPEN" | "PRE_OPEN" | "CLOSED" | "HOLIDAY";

const TIMEZONE = "Asia/Kolkata";
const PRE_OPEN_START = "09:00";
const REGULAR_OPEN = "09:15";
const REGULAR_CLOSE = "15:30";

// NSE equity/capital-market trading holidays for 2026. Calendar dates
// (IST), not timestamps - kept as plain "YYYY-MM-DD" strings and compared
// against the same shape produced by dateKey(), so machine timezone can't
// affect interpretation. Segment-specific (F&O/debt/currency) holidays are
// deliberately excluded - this is the equity/capital-market list only.
const NSE_HOLIDAYS_2026: ReadonlySet<string> = new Set([
  "2026-01-15",
  "2026-01-26",
  "2026-02-19",
  "2026-03-03",
  "2026-03-19",
  "2026-03-26",
  "2026-03-31",
  "2026-04-01",
  "2026-04-03",
  "2026-04-14",
  "2026-05-01",
  "2026-05-28",
  "2026-06-26",
  "2026-08-26",
  "2026-09-14",
  "2026-10-02",
  "2026-10-20",
  "2026-11-10",
  "2026-11-24",
  "2026-12-25",
]);

const istFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

type IstParts = { year: number; month: number; day: number; time: string; weekday: string };

function istPartsOf(instant: Instant): IstParts {
  const parts = istFormatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    time: `${get("hour")}:${get("minute")}`,
    weekday: get("weekday"),
  };
}

function dateKey(parts: IstParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getSessionState(instant: Instant): SessionState {
  const parts = istPartsOf(instant);

  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return "CLOSED";
  }
  if (NSE_HOLIDAYS_2026.has(dateKey(parts))) {
    return "HOLIDAY";
  }
  if (parts.time < PRE_OPEN_START || parts.time >= REGULAR_CLOSE) {
    return "CLOSED";
  }
  if (parts.time < REGULAR_OPEN) {
    return "PRE_OPEN";
  }
  return "OPEN";
}

/** The 15:30 IST regular-session close on the IST calendar day `instant` falls on. */
export function regularSessionCloseFor(instant: Instant): Instant {
  const { year, month, day } = istPartsOf(instant);
  // IST is a fixed UTC+5:30 offset with no daylight saving, so 15:30 IST on
  // a given IST calendar day is always exactly 10:00 UTC that same day.
  return new Date(Date.UTC(year, month - 1, day, 10, 0, 0, 0));
}
