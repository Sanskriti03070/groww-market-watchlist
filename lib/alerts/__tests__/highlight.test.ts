import { describe, expect, it } from "vitest";
import { isHighlighted, type HighlightInput } from "@/lib/alerts/highlight";

function base(overrides: Partial<HighlightInput> = {}): HighlightInput {
  return {
    alertState: "ACTIVE",
    conditionType: "PRICE_LEVEL",
    direction: "ABOVE",
    thresholdValue: 1400,
    reliability: "LIVE",
    lastPrice: 1390,
    changePercent: null,
    dayHigh: 1410,
    dayLow: 1370, // day range 40 / previousClose 1400 -> 2.857% -> band = clamp(0.3*2.857, .25, 2.0) = 0.857%
    previousClose: 1400,
    ...overrides,
  };
}

describe("isHighlighted", () => {
  it("highlights a PRICE_LEVEL alert within its volatility-scaled proximity band", () => {
    // distance = |1400-1390|/1390*100 = 0.719% <= band 0.857%
    expect(isHighlighted(base({ lastPrice: 1390 }))).toBe(true);
  });

  it("does not highlight when outside the proximity band", () => {
    // distance = |1400-1300|/1300*100 = 7.69% > band
    expect(isHighlighted(base({ lastPrice: 1300 }))).toBe(false);
  });

  it("never highlights a non-ACTIVE alert (TRIGGERED or DISABLED)", () => {
    expect(isHighlighted(base({ alertState: "TRIGGERED", lastPrice: 1390 }))).toBe(false);
    expect(isHighlighted(base({ alertState: "DISABLED", lastPrice: 1390 }))).toBe(false);
  });

  it("never highlights on LAST_CLOSE or any untrustworthy/stale reliability - LIVE only", () => {
    expect(isHighlighted(base({ reliability: "LAST_CLOSE", lastPrice: 1390 }))).toBe(false);
    expect(isHighlighted(base({ reliability: "STALE", lastPrice: 1390 }))).toBe(false);
    expect(isHighlighted(base({ reliability: "UNAVAILABLE_TOO_OLD", lastPrice: 1390 }))).toBe(false);
  });

  it("is mutually exclusive with TRIGGERED: once price crosses the threshold, it never highlights, even if still ACTIVE", () => {
    // Price has already crossed ABOVE 1400, so it's no longer pre-trigger,
    // even though the persisted alert state hasn't caught up to TRIGGERED yet.
    expect(isHighlighted(base({ lastPrice: 1450 }))).toBe(false);
  });

  it("falls back to the 0.75% band when day range data is unavailable", () => {
    // distance = |1400-1396|/1396*100 = 0.286% <= 0.75% fallback -> highlighted
    expect(isHighlighted(base({ lastPrice: 1396, dayHigh: null, dayLow: null, previousClose: null }))).toBe(true);
    // distance = |1400-1390|/1390*100 = 0.719% > 0.75%? no it's below - use a farther price instead
    expect(isHighlighted(base({ lastPrice: 1380, dayHigh: null, dayLow: null, previousClose: null }))).toBe(false);
  });

  it("clamps the proximity band to a 2.0% ceiling for a very volatile stock", () => {
    // day range 200/1400 = 14.29% -> raw band 4.29% clamped to 2.0%
    const input = base({ dayHigh: 1500, dayLow: 1300, previousClose: 1400 });
    // distance = |1400-1372|/1372*100 = 2.04% > 2.0% ceiling -> not highlighted
    expect(isHighlighted({ ...input, lastPrice: 1372 })).toBe(false);
    // distance = |1400-1375|/1375*100 = 1.82% <= 2.0% ceiling -> highlighted
    expect(isHighlighted({ ...input, lastPrice: 1375 })).toBe(true);
  });

  it("clamps the proximity band to a 0.25% floor for a very stable stock", () => {
    // day range 2/1400 = 0.143% -> raw band 0.043% clamped up to 0.25%
    const input = base({ dayHigh: 1401, dayLow: 1399, previousClose: 1400 });
    // distance = |1400-1396|/1396*100 = 0.286% > 0.25% floor -> not highlighted
    expect(isHighlighted({ ...input, lastPrice: 1396 })).toBe(false);
    // distance = |1400-1397|/1397*100 = 0.215% <= 0.25% floor -> highlighted
    expect(isHighlighted({ ...input, lastPrice: 1397 })).toBe(true);
  });

  it("DAY_MOVE highlights when today's move is close to the threshold magnitude on the pre-trigger side", () => {
    const dayMove = base({
      conditionType: "DAY_MOVE",
      direction: "UP",
      thresholdValue: 3,
      changePercent: 2.8, // 0.2 points from the 3% threshold
      dayHigh: 1450,
      dayLow: 1350, // range 100/1400 = 7.14% -> band clamp(2.14, .25, 2.0) = 2.0%
      previousClose: 1400,
    });
    expect(isHighlighted(dayMove)).toBe(true);
  });

  it("DAY_MOVE with no usable change percent is never highlighted", () => {
    expect(isHighlighted(base({ conditionType: "DAY_MOVE", direction: "UP", thresholdValue: 3, changePercent: null }))).toBe(false);
  });
});
