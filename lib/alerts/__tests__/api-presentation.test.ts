import { describe, expect, it } from "vitest";
import type { AlertRow, AlertTriggerRow } from "@/lib/alerts/repo";
import { filterAlertViews, sortAlertViews, toAlertView, type AlertView, type PresentationQuote } from "@/lib/alerts/api";

const T0 = new Date("2026-06-01T00:00:00.000Z");

function alertRow(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    ownerId: "owner-1",
    symbol: "RELIANCE",
    conditionType: "PRICE_LEVEL",
    direction: "ABOVE",
    thresholdValue: "1400.0000",
    state: "ACTIVE",
    lastSide: null,
    lastEvaluatedQuoteAt: null,
    version: 0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function liveQuote(overrides: Partial<PresentationQuote> = {}): PresentationQuote {
  return { reliability: "LIVE", lastPrice: 1390, changePercent: null, dayHigh: 1410, dayLow: 1370, previousClose: 1400, ...overrides };
}

describe("toAlertView - derived presentation", () => {
  it("DISABLED takes priority over everything else", () => {
    const view = toAlertView(alertRow({ state: "DISABLED" }), { isSymbolActive: false, quote: liveQuote(), latestTrigger: null });
    expect(view.presentation).toBe("DISABLED");
  });

  it("an inactive symbol shows NOT_EVALUATING even for an otherwise-ACTIVE alert", () => {
    const view = toAlertView(alertRow({ state: "ACTIVE" }), { isSymbolActive: false, quote: liveQuote(), latestTrigger: null });
    expect(view.presentation).toBe("NOT_EVALUATING");
  });

  it("TRIGGERED shows as TRIGGERED, with hasUnacknowledgedTrigger true and the trigger's timestamp", () => {
    const trigger: AlertTriggerRow = {
      id: "trigger-1",
      alertId: "00000000-0000-0000-0000-000000000001",
      ownerId: "owner-1",
      symbol: "RELIANCE",
      triggeredAt: new Date("2026-06-02T00:00:00.000Z"),
      quoteFetchedAt: T0,
      observedPrice: "1450.0000",
      thresholdValue: "1400.0000",
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      previousSide: -1,
      newSide: 1,
      dayChangePercent: null,
      acknowledgedAt: null,
    };
    const view = toAlertView(alertRow({ state: "TRIGGERED" }), { isSymbolActive: true, quote: liveQuote(), latestTrigger: trigger });
    expect(view.presentation).toBe("TRIGGERED");
    expect(view.hasUnacknowledgedTrigger).toBe(true);
    expect(view.lastTriggeredAt).toBe(trigger.triggeredAt.toISOString());
  });

  it("an ACTIVE alert close to its threshold on LIVE data shows HIGHLIGHTED with a numeric distancePercent", () => {
    const view = toAlertView(alertRow(), { isSymbolActive: true, quote: liveQuote({ lastPrice: 1390 }), latestTrigger: null });
    expect(view.presentation).toBe("HIGHLIGHTED");
    expect(view.distancePercent).not.toBeNull();
  });

  it("an ACTIVE alert far from its threshold shows plain ACTIVE", () => {
    const view = toAlertView(alertRow(), { isSymbolActive: true, quote: liveQuote({ lastPrice: 1000 }), latestTrigger: null });
    expect(view.presentation).toBe("ACTIVE");
  });

  it("no quote at all (never refreshed) shows ACTIVE with a null distancePercent, never HIGHLIGHTED", () => {
    const view = toAlertView(alertRow(), { isSymbolActive: true, quote: null, latestTrigger: null });
    expect(view.presentation).toBe("ACTIVE");
    expect(view.distancePercent).toBeNull();
  });

  it("LAST_CLOSE reliability never highlights, even when otherwise close to the threshold", () => {
    const view = toAlertView(alertRow(), { isSymbolActive: true, quote: liveQuote({ reliability: "LAST_CLOSE", lastPrice: 1390 }), latestTrigger: null });
    expect(view.presentation).toBe("ACTIVE");
    expect(view.distancePercent).toBeNull();
  });

  it("never exposes internal evaluation fields (last_side, last_evaluated_quote_at) or provider fields", () => {
    const view = toAlertView(alertRow({ lastSide: 1, lastEvaluatedQuoteAt: T0 }), { isSymbolActive: true, quote: liveQuote(), latestTrigger: null });
    const keys = Object.keys(view);
    for (const forbidden of ["lastSide", "lastEvaluatedQuoteAt", "providerTs", "providerSymbol", "lastErrorCode"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

function view(overrides: Partial<AlertView> = {}): AlertView {
  return {
    id: "id-1",
    symbol: "RELIANCE",
    conditionType: "PRICE_LEVEL",
    direction: "ABOVE",
    thresholdValue: "1400.0000",
    version: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    presentation: "ACTIVE",
    distancePercent: null,
    lastTriggeredAt: null,
    hasUnacknowledgedTrigger: false,
    ...overrides,
  };
}

describe("filterAlertViews", () => {
  const views = [
    view({ id: "a", presentation: "ACTIVE" }),
    view({ id: "b", presentation: "HIGHLIGHTED" }),
    view({ id: "c", presentation: "TRIGGERED", hasUnacknowledgedTrigger: true }),
    view({ id: "d", presentation: "DISABLED" }),
    view({ id: "e", presentation: "NOT_EVALUATING" }),
  ];

  it("all returns everything", () => {
    expect(filterAlertViews(views, "all")).toHaveLength(5);
  });

  it("active includes both plain ACTIVE and HIGHLIGHTED", () => {
    expect(filterAlertViews(views, "active").map((v) => v.id).sort()).toEqual(["a", "b"]);
  });

  it("nearTarget is HIGHLIGHTED only", () => {
    expect(filterAlertViews(views, "nearTarget").map((v) => v.id)).toEqual(["b"]);
  });

  it("triggered is undismissed triggers only", () => {
    expect(filterAlertViews(views, "triggered").map((v) => v.id)).toEqual(["c"]);
  });
});

describe("sortAlertViews", () => {
  it("nearest: distancePercent ascending, nulls last, id tie-break", () => {
    const views = [
      view({ id: "z", distancePercent: 1.0 }),
      view({ id: "a", distancePercent: 1.0 }), // ties with "z" on distance -> id breaks the tie
      view({ id: "m", distancePercent: null }),
      view({ id: "b", distancePercent: 0.2 }),
    ];
    expect(sortAlertViews(views, "nearest").map((v) => v.id)).toEqual(["b", "a", "z", "m"]);
  });

  it("recentlyTriggered: newest trigger first, never-triggered last, id tie-break", () => {
    const views = [
      view({ id: "z", lastTriggeredAt: "2026-06-01T00:00:00.000Z" }),
      view({ id: "a", lastTriggeredAt: "2026-06-01T00:00:00.000Z" }), // ties with "z"
      view({ id: "n", lastTriggeredAt: null }),
      view({ id: "b", lastTriggeredAt: "2026-06-03T00:00:00.000Z" }),
    ];
    expect(sortAlertViews(views, "recentlyTriggered").map((v) => v.id)).toEqual(["b", "a", "z", "n"]);
  });

  it("recentlyCreated: created_at descending, id tie-break", () => {
    const views = [
      view({ id: "z", createdAt: "2026-06-01T00:00:00.000Z" }),
      view({ id: "a", createdAt: "2026-06-01T00:00:00.000Z" }), // ties with "z"
      view({ id: "b", createdAt: "2026-06-03T00:00:00.000Z" }),
    ];
    expect(sortAlertViews(views, "recentlyCreated").map((v) => v.id)).toEqual(["b", "a", "z"]);
  });

  it("attention: triggered-recent, then highlighted-nearest, then active-nearest, then not-evaluating, then disabled", () => {
    const views = [
      view({ id: "disabled-1", presentation: "DISABLED", createdAt: "2026-06-01T00:00:00.000Z" }),
      view({ id: "active-far", presentation: "ACTIVE", distancePercent: 2.0 }),
      view({ id: "highlighted-near", presentation: "HIGHLIGHTED", distancePercent: 0.1 }),
      view({ id: "not-evaluating-1", presentation: "NOT_EVALUATING", createdAt: "2026-06-02T00:00:00.000Z" }),
      view({ id: "triggered-old", presentation: "TRIGGERED", lastTriggeredAt: "2026-06-01T00:00:00.000Z" }),
      view({ id: "active-near", presentation: "ACTIVE", distancePercent: 0.5 }),
      view({ id: "triggered-new", presentation: "TRIGGERED", lastTriggeredAt: "2026-06-05T00:00:00.000Z" }),
      view({ id: "highlighted-far", presentation: "HIGHLIGHTED", distancePercent: 1.5 }),
    ];
    expect(sortAlertViews(views, "attention").map((v) => v.id)).toEqual([
      "triggered-new",
      "triggered-old",
      "highlighted-near",
      "highlighted-far",
      "active-near",
      "active-far",
      "not-evaluating-1",
      "disabled-1",
    ]);
  });

  it("tie-break is stable and deterministic across repeated calls with identical inputs", () => {
    const views = [view({ id: "b", distancePercent: 1 }), view({ id: "a", distancePercent: 1 }), view({ id: "c", distancePercent: 1 })];
    const first = sortAlertViews(views, "nearest").map((v) => v.id);
    const second = sortAlertViews(views, "nearest").map((v) => v.id);
    expect(first).toEqual(["a", "b", "c"]);
    expect(second).toEqual(first);
  });
});
