import { describe, expect, it } from "vitest";
import { deriveSide, evaluateAlert, type AlertForEvaluation, type QuoteForEvaluation } from "@/lib/alerts/evaluate";

const T0 = new Date("2026-06-03T04:00:00.000Z");
const T1 = new Date("2026-06-03T05:00:00.000Z");
const T2 = new Date("2026-06-03T06:00:00.000Z");

function priceLevelAlert(overrides: Partial<AlertForEvaluation> = {}): AlertForEvaluation {
  return {
    conditionType: "PRICE_LEVEL",
    direction: "ABOVE",
    thresholdValue: 1400,
    state: "ACTIVE",
    lastSide: null,
    lastEvaluatedQuoteAt: null,
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteForEvaluation> = {}): QuoteForEvaluation {
  return { lastPrice: 1400, changePercent: null, fetchedAt: T1, ...overrides };
}

describe("evaluateAlert", () => {
  it("first trustworthy evaluation seeds the side and never triggers, even when already satisfied", () => {
    const alert = priceLevelAlert({ lastSide: null, lastEvaluatedQuoteAt: null });
    const outcome = evaluateAlert(alert, quote({ lastPrice: 1450, fetchedAt: T1 }), "LIVE");
    expect(outcome).toEqual({ kind: "SIDE_CHANGED", previousSide: null, newSide: 1 });
  });

  it("below -> above triggers", () => {
    const alert = priceLevelAlert({ lastSide: -1, lastEvaluatedQuoteAt: T0 });
    const outcome = evaluateAlert(alert, quote({ lastPrice: 1450, fetchedAt: T1 }), "LIVE");
    expect(outcome).toEqual({ kind: "TRIGGERED", previousSide: -1, newSide: 1 });
  });

  it("above -> above does not trigger again", () => {
    const alert = priceLevelAlert({ lastSide: 1, lastEvaluatedQuoteAt: T0 });
    const outcome = evaluateAlert(alert, quote({ lastPrice: 1460, fetchedAt: T1 }), "LIVE");
    expect(outcome).toEqual({ kind: "NO_CHANGE", side: 1 });
  });

  it("above -> below re-arms without triggering", () => {
    const alert = priceLevelAlert({ lastSide: 1, lastEvaluatedQuoteAt: T0 });
    const outcome = evaluateAlert(alert, quote({ lastPrice: 1350, fetchedAt: T1 }), "LIVE");
    expect(outcome).toEqual({ kind: "SIDE_CHANGED", previousSide: 1, newSide: -1 });
  });

  it("below -> above -> below -> above triggers a second time (docs/ENGINEERING_DECISIONS.md #11)", () => {
    const alert = priceLevelAlert({ lastSide: -1, lastEvaluatedQuoteAt: T0 });
    const first = evaluateAlert(alert, quote({ lastPrice: 1450, fetchedAt: T1 }), "LIVE");
    expect(first).toEqual({ kind: "TRIGGERED", previousSide: -1, newSide: 1 });

    const rearmed = priceLevelAlert({ lastSide: 1, lastEvaluatedQuoteAt: T1 });
    const rearm = evaluateAlert(rearmed, quote({ lastPrice: 1350, fetchedAt: T2 }), "LIVE");
    expect(rearm).toEqual({ kind: "SIDE_CHANGED", previousSide: 1, newSide: -1 });

    const T3 = new Date("2026-06-03T07:00:00.000Z");
    const armed = priceLevelAlert({ lastSide: -1, lastEvaluatedQuoteAt: T2 });
    const second = evaluateAlert(armed, quote({ lastPrice: 1420, fetchedAt: T3 }), "LIVE");
    expect(second).toEqual({ kind: "TRIGGERED", previousSide: -1, newSide: 1 });
  });

  it("price exactly at threshold counts as satisfied for ABOVE and BELOW", () => {
    expect(deriveSide(priceLevelAlert({ direction: "ABOVE", thresholdValue: 1400 }), { lastPrice: 1400, changePercent: null })).toBe(1);
    expect(deriveSide(priceLevelAlert({ direction: "BELOW", thresholdValue: 1400 }), { lastPrice: 1400, changePercent: null })).toBe(1);
  });

  it("DAY_MOVE with no usable previous-close-derived change percent skips as MISSING_DATA, not a trigger or a side", () => {
    const alert: AlertForEvaluation = {
      conditionType: "DAY_MOVE",
      direction: "UP",
      thresholdValue: 3,
      state: "ACTIVE",
      lastSide: -1,
      lastEvaluatedQuoteAt: T0,
    };
    const outcome = evaluateAlert(alert, quote({ changePercent: null, fetchedAt: T1 }), "LIVE");
    expect(outcome).toEqual({ kind: "SKIPPED", reason: "MISSING_DATA" });
  });

  it("STALE data is skipped as UNTRUSTWORTHY and never advances or triggers the alert", () => {
    const alert = priceLevelAlert({ lastSide: -1, lastEvaluatedQuoteAt: T0 });
    const outcome = evaluateAlert(alert, quote({ lastPrice: 1450, fetchedAt: T1 }), "STALE");
    expect(outcome).toEqual({ kind: "SKIPPED", reason: "UNTRUSTWORTHY" });
  });

  it("a repeat of the same observed quote (same fetchedAt) is skipped as ALREADY_EVALUATED", () => {
    const alert = priceLevelAlert({ lastSide: -1, lastEvaluatedQuoteAt: T1 });
    const outcome = evaluateAlert(alert, quote({ lastPrice: 1450, fetchedAt: T1 }), "LIVE");
    expect(outcome).toEqual({ kind: "SKIPPED", reason: "ALREADY_EVALUATED" });
  });

  it("an older/out-of-order quote is skipped as ALREADY_EVALUATED", () => {
    const alert = priceLevelAlert({ lastSide: -1, lastEvaluatedQuoteAt: T2 });
    const outcome = evaluateAlert(alert, quote({ lastPrice: 1450, fetchedAt: T1 }), "LIVE");
    expect(outcome).toEqual({ kind: "SKIPPED", reason: "ALREADY_EVALUATED" });
  });

  it("a DISABLED alert is always skipped, regardless of quote or side", () => {
    const alert = priceLevelAlert({ state: "DISABLED", lastSide: -1, lastEvaluatedQuoteAt: T0 });
    const outcome = evaluateAlert(alert, quote({ lastPrice: 1450, fetchedAt: T1 }), "LIVE");
    expect(outcome).toEqual({ kind: "SKIPPED", reason: "DISABLED" });
  });
});

describe("deriveSide", () => {
  it("PRICE_LEVEL BELOW is satisfied at or under the threshold", () => {
    const alert = priceLevelAlert({ direction: "BELOW", thresholdValue: 1400 });
    expect(deriveSide(alert, { lastPrice: 1399, changePercent: null })).toBe(1);
    expect(deriveSide(alert, { lastPrice: 1401, changePercent: null })).toBe(-1);
  });

  it("DAY_MOVE UP/DOWN are sign-matched magnitude comparisons", () => {
    const up: AlertForEvaluation = { ...priceLevelAlert(), conditionType: "DAY_MOVE", direction: "UP", thresholdValue: 3 };
    const down: AlertForEvaluation = { ...priceLevelAlert(), conditionType: "DAY_MOVE", direction: "DOWN", thresholdValue: 3 };

    expect(deriveSide(up, { lastPrice: 0, changePercent: 3 })).toBe(1);
    expect(deriveSide(up, { lastPrice: 0, changePercent: -3 })).toBe(-1);
    expect(deriveSide(down, { lastPrice: 0, changePercent: -3 })).toBe(1);
    expect(deriveSide(down, { lastPrice: 0, changePercent: 3 })).toBe(-1);
  });

  it("LAST_CLOSE is trustworthy enough to establish a side, same as LIVE", () => {
    const alert = priceLevelAlert({ lastSide: null, lastEvaluatedQuoteAt: null });
    const outcome = evaluateAlert(alert, quote({ lastPrice: 1450, fetchedAt: T1 }), "LAST_CLOSE");
    expect(outcome).toEqual({ kind: "SIDE_CHANGED", previousSide: null, newSide: 1 });
  });
});
