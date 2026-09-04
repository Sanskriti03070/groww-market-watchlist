import { describe, expect, it } from "vitest";
import { resolveReliability, FRESHNESS_CONFIG } from "@/lib/quote-reliability";
import { getSessionSnapshot, type SessionSnapshot } from "@/lib/nse-session-calendar";

// resolveReliability's input type has no providerTs field at all (see
// lib/quote-reliability.ts) - that guarantee is enforced by the type
// checker at every call site, not something to re-verify at runtime here.

const SECOND = 1000;

function openSession(currentOpen: Date, lastCompleted: SessionSnapshot["lastCompleted"] = null): SessionSnapshot {
  return { state: "OPEN", currentOpen, lastCompleted };
}

function closedSession(lastCompleted: SessionSnapshot["lastCompleted"]): SessionSnapshot {
  return { state: "CLOSED", currentOpen: null, lastCompleted };
}

describe("resolveReliability", () => {
  it("reports UNAVAILABLE_NO_DATA when there is no quote at all", () => {
    const now = new Date("2026-06-03T10:00:00.000Z");
    const session = closedSession({
      open: new Date("2026-06-02T03:45:00.000Z"),
      close: new Date("2026-06-02T10:00:00.000Z"),
    });

    expect(resolveReliability({ fetchedAt: null, now, session })).toBe("UNAVAILABLE_NO_DATA");
  });

  describe("while OPEN", () => {
    const now = new Date("2026-06-03T10:00:00.000Z");
    // Far outside the open warm-up window, so only the plain age formula applies.
    const session = openSession(new Date(now.getTime() - 3_600_000), {
      open: new Date(now.getTime() - 90_000_000),
      close: new Date(now.getTime() - 60_000_000),
    });

    it("age exactly 120s -> LIVE", () => {
      const fetchedAt = new Date(now.getTime() - FRESHNESS_CONFIG.freshWindowMs);
      expect(resolveReliability({ fetchedAt, now, session })).toBe("LIVE");
    });

    it("age just over 120s -> STALE", () => {
      const fetchedAt = new Date(now.getTime() - (FRESHNESS_CONFIG.freshWindowMs + SECOND));
      expect(resolveReliability({ fetchedAt, now, session })).toBe("STALE");
    });

    it("age exactly 900s -> STALE", () => {
      const fetchedAt = new Date(now.getTime() - FRESHNESS_CONFIG.staleLimitMs);
      expect(resolveReliability({ fetchedAt, now, session })).toBe("STALE");
    });

    it("age just over 900s -> UNAVAILABLE_TOO_OLD", () => {
      const fetchedAt = new Date(now.getTime() - (FRESHNESS_CONFIG.staleLimitMs + SECOND));
      expect(resolveReliability({ fetchedAt, now, session })).toBe("UNAVAILABLE_TOO_OLD");
    });
  });

  describe("while CLOSED / PRE_OPEN / HOLIDAY", () => {
    const lastCompleted = {
      open: new Date("2026-06-02T03:45:00.000Z"),
      close: new Date("2026-06-02T10:00:00.000Z"),
    };
    const now = new Date("2026-06-03T05:00:00.000Z");

    it("capture near the completed session's close -> LAST_CLOSE", () => {
      const fetchedAt = new Date(lastCompleted.close.getTime() - 60_000);
      expect(resolveReliability({ fetchedAt, now, session: closedSession(lastCompleted) })).toBe("LAST_CLOSE");
    });

    it("capture from the completed session but outside the close window -> STALE", () => {
      const fetchedAt = new Date(lastCompleted.open.getTime() + 3_600_000);
      expect(resolveReliability({ fetchedAt, now, session: closedSession(lastCompleted) })).toBe("STALE");
    });

    it("capture from before the completed session even opened -> UNAVAILABLE_TOO_OLD", () => {
      const fetchedAt = new Date(lastCompleted.open.getTime() - 3_600_000);
      expect(resolveReliability({ fetchedAt, now, session: closedSession(lastCompleted) })).toBe(
        "UNAVAILABLE_TOO_OLD",
      );
    });

    it("no completed session at all -> UNAVAILABLE_TOO_OLD", () => {
      const fetchedAt = new Date("2026-06-02T09:00:00.000Z");
      expect(resolveReliability({ fetchedAt, now, session: closedSession(null) })).toBe("UNAVAILABLE_TOO_OLD");
    });
  });

  it("carries a close-window capture across the weekend, via the real Step 2 calendar", () => {
    const saturday = new Date("2026-06-06T10:00:00.000Z");
    const session = getSessionSnapshot(saturday);

    expect(session.state).toBe("CLOSED");
    expect(session.lastCompleted).not.toBeNull();

    const fetchedAt = new Date(session.lastCompleted!.close.getTime() - 60_000);
    expect(resolveReliability({ fetchedAt, now: saturday, session })).toBe("LAST_CLOSE");
  });

  describe("open warm-up", () => {
    const currentOpen = new Date("2026-06-03T03:45:00.000Z");
    const lastCompleted = {
      open: new Date("2026-06-02T03:45:00.000Z"),
      close: new Date("2026-06-02T10:00:00.000Z"),
    };
    // Captured near yesterday's close; the poller hasn't refreshed since.
    const fetchedAt = new Date(lastCompleted.close.getTime() - 30_000);

    it("within the warm-up window, a stale pre-open capture reads LAST_CLOSE, not falsely stale/unavailable", () => {
      const now = new Date(currentOpen.getTime() + 30_000);
      const session = openSession(currentOpen, lastCompleted);
      expect(resolveReliability({ fetchedAt, now, session })).toBe("LAST_CLOSE");
    });

    it("once the warm-up window has passed, the same capture falls back to the plain age rule", () => {
      const now = new Date(currentOpen.getTime() + FRESHNESS_CONFIG.freshWindowMs + SECOND);
      const session = openSession(currentOpen, lastCompleted);
      expect(resolveReliability({ fetchedAt, now, session })).toBe("UNAVAILABLE_TOO_OLD");
    });
  });
});
