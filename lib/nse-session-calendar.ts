// Deterministic NSE (India) trading-session calendar. Pure function of an
// explicit instant - never reads the system clock - so callers control
// "now" and results are reproducible. Session state is a separate concern
// from quote freshness: nothing here looks at a quote's fetchedAt/providerTs,
// and nothing here is persisted.

import type { Instant } from "@/lib/market-quote";

export type SessionState = "OPEN" | "PRE_OPEN" | "CLOSED" | "HOLIDAY";

/**
 * A read of the calendar as of one instant: the current state, today's
 * regular open (if today trades), and the most recently completed regular
 * session. This is the only shape quote-reliability classification consumes
 * - it never re-derives calendar facts itself.
 */
export type SessionSnapshot = {
  state: SessionState;
  currentOpen: Instant | null;
  lastCompleted: { open: Instant; close: Instant } | null;
};

const TIMEZONE = "Asia/Kolkata";
const PRE_OPEN_START = "09:00";
const REGULAR_OPEN = "09:15";
const REGULAR_CLOSE = "15:30";

// How far back getSessionSnapshot will search for a completed session
// before giving up. NSE holiday clusters never run anywhere near this long;
// it exists only to keep the search provably finite.
const MAX_LOOKBACK_DAYS = 10;

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
type CalendarDate = { year: number; month: number; day: number };

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

function dateKey({ year, month, day }: CalendarDate): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// IST is a fixed UTC+5:30 offset with no daylight saving, so a given IST
// calendar day's regular open/close are always the same UTC instants.
function sessionBoundsOf({ year, month, day }: CalendarDate): { open: Instant; close: Instant } {
  return {
    open: new Date(Date.UTC(year, month - 1, day, 3, 45, 0, 0)), // 09:15 IST
    close: new Date(Date.UTC(year, month - 1, day, 10, 0, 0, 0)), // 15:30 IST
  };
}

function isTradingDay(date: CalendarDate): boolean {
  // Probe midday IST so the weekday check goes through the same Intl-based
  // logic as everything else, without needing a real Instant for the day.
  const midday = new Date(Date.UTC(date.year, date.month - 1, date.day, 6, 0, 0, 0));
  const weekday = istPartsOf(midday).weekday;
  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }
  return !NSE_HOLIDAYS_2026.has(dateKey(date));
}

function dayBefore(date: CalendarDate): CalendarDate {
  const prev = new Date(Date.UTC(date.year, date.month - 1, date.day) - 24 * 60 * 60 * 1000);
  return { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1, day: prev.getUTCDate() };
}

function findLastCompletedBefore(date: CalendarDate): { open: Instant; close: Instant } | null {
  let cursor = dayBefore(date);
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    if (isTradingDay(cursor)) {
      return sessionBoundsOf(cursor);
    }
    cursor = dayBefore(cursor);
  }
  return null;
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
  return sessionBoundsOf(istPartsOf(instant)).close;
}

/**
 * A read of the calendar as of `now`: current state, today's open (if today
 * trades), and the most recently completed regular session - today's, if
 * today already traded and closed, otherwise the last prior trading day.
 */
export function getSessionSnapshot(now: Instant): SessionSnapshot {
  const today = istPartsOf(now);
  const todayBounds = isTradingDay(today) ? sessionBoundsOf(today) : null;
  const todayAlreadyCompleted = todayBounds !== null && now.getTime() >= todayBounds.close.getTime();

  return {
    state: getSessionState(now),
    currentOpen: todayBounds?.open ?? null,
    lastCompleted: todayAlreadyCompleted ? todayBounds : findLastCompletedBefore(today),
  };
}
