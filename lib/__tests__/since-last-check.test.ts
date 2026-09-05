import { describe, expect, it } from "vitest";
import { canAdvanceBaseline, computeMeaningfulChange, evaluateSinceLastCheck } from "@/lib/since-last-check";

const baseline = (price: number, quoteFetchedAt: Date) => ({
  price,
  observedAt: quoteFetchedAt,
  quoteFetchedAt,
  sessionDate: "2026-06-03",
});

const T0 = new Date("2026-06-03T04:00:00.000Z");
const T1 = new Date("2026-06-03T05:00:00.000Z");

describe("evaluateSinceLastCheck", () => {
  it("no baseline -> NO_BASELINE (and is advanceable, i.e. a token would issue)", () => {
    const state = evaluateSinceLastCheck(
      { reliability: "LIVE", lastPrice: 100, dayHigh: null, dayLow: null, previousClose: null, fetchedAt: T1 },
      null,
    );
    expect(state).toEqual({ kind: "NO_BASELINE" });
    expect(canAdvanceBaseline(state)).toBe(true);
  });

  it("STALE current -> NOT_COMPARABLE, never NO_BASELINE, even with no baseline", () => {
    const state = evaluateSinceLastCheck(
      { reliability: "STALE", lastPrice: 100, dayHigh: null, dayLow: null, previousClose: null, fetchedAt: T1 },
      null,
    );
    expect(state).toEqual({ kind: "NOT_COMPARABLE", reason: "CURRENT_UNTRUSTWORTHY" });
    expect(canAdvanceBaseline(state)).toBe(false);
  });

  it("UNAVAILABLE current -> NOT_COMPARABLE, not advanceable", () => {
    const state = evaluateSinceLastCheck(
      {
        reliability: "UNAVAILABLE_TOO_OLD",
        lastPrice: 100,
        dayHigh: null,
        dayLow: null,
        previousClose: null,
        fetchedAt: T1,
      },
      baseline(100, T0),
    );
    expect(state).toEqual({ kind: "NOT_COMPARABLE", reason: "CURRENT_UNTRUSTWORTHY" });
    expect(canAdvanceBaseline(state)).toBe(false);
  });

  it("LAST_CLOSE can both establish (no baseline) and compare (with baseline)", () => {
    const noBaseline = evaluateSinceLastCheck(
      { reliability: "LAST_CLOSE", lastPrice: 100, dayHigh: null, dayLow: null, previousClose: null, fetchedAt: T1 },
      null,
    );
    expect(noBaseline.kind).toBe("NO_BASELINE");

    const withBaseline = evaluateSinceLastCheck(
      { reliability: "LAST_CLOSE", lastPrice: 105, dayHigh: null, dayLow: null, previousClose: null, fetchedAt: T1 },
      baseline(100, T0),
    );
    expect(withBaseline.kind).toBe("MEANINGFUL");
  });

  it("same quoteFetchedAt as baseline -> UNCHANGED_SESSION, not a fresh comparison", () => {
    const state = evaluateSinceLastCheck(
      { reliability: "LAST_CLOSE", lastPrice: 100, dayHigh: null, dayLow: null, previousClose: null, fetchedAt: T0 },
      baseline(100, T0),
    );
    expect(state).toEqual({ kind: "UNCHANGED_SESSION" });
    expect(canAdvanceBaseline(state)).toBe(false);
  });

  it("meaningful positive movement", () => {
    const state = evaluateSinceLastCheck(
      { reliability: "LIVE", lastPrice: 104, dayHigh: 110, dayLow: 90, previousClose: 100, fetchedAt: T1 },
      baseline(100, T0),
    );
    expect(state.kind).toBe("MEANINGFUL");
    if (state.kind === "MEANINGFUL") {
      expect(state.direction).toBe("UP");
      expect(canAdvanceBaseline(state)).toBe(true);
    }
  });

  it("meaningful negative movement", () => {
    const state = evaluateSinceLastCheck(
      { reliability: "LIVE", lastPrice: 96, dayHigh: 110, dayLow: 90, previousClose: 100, fetchedAt: T1 },
      baseline(100, T0),
    );
    expect(state.kind).toBe("MEANINGFUL");
    if (state.kind === "MEANINGFUL") {
      expect(state.direction).toBe("DOWN");
    }
  });

  it("below-threshold movement is still advanceable (must be able to move the baseline)", () => {
    // range = 110-90=20, rangePercent=20%, threshold=clamp(5,0.5,3)=3; delta 0.5% < 3%
    const state = evaluateSinceLastCheck(
      { reliability: "LIVE", lastPrice: 100.5, dayHigh: 110, dayLow: 90, previousClose: 100, fetchedAt: T1 },
      baseline(100, T0),
    );
    expect(state.kind).toBe("BELOW_THRESHOLD");
    expect(canAdvanceBaseline(state)).toBe(true);
  });

  it("mixed reliability across symbols is evaluated independently (no cross-contamination)", () => {
    const live = evaluateSinceLastCheck(
      { reliability: "LIVE", lastPrice: 104, dayHigh: 110, dayLow: 90, previousClose: 100, fetchedAt: T1 },
      baseline(100, T0),
    );
    const stale = evaluateSinceLastCheck(
      { reliability: "STALE", lastPrice: 104, dayHigh: 110, dayLow: 90, previousClose: 100, fetchedAt: T1 },
      baseline(100, T0),
    );
    expect(live.kind).toBe("MEANINGFUL");
    expect(stale.kind).toBe("NOT_COMPARABLE");
  });
});

describe("computeMeaningfulChange", () => {
  it("exactly-equal-to-threshold counts as meaningful", () => {
    // range=20, rangePercent=20%, threshold=clamp(5,...)=3.0 -> need deltaPercent exactly 3.0
    const result = computeMeaningfulChange({ currentPrice: 103, baselinePrice: 100, dayHigh: 110, dayLow: 90, previousClose: 100 });
    expect(result.thresholdPercent).toBe(3);
    expect(result.deltaPercent).toBe(3);
    expect(result.meaningful).toBe(true);
  });

  it("compares at full precision before any rounding", () => {
    // deltaPercent = 0.30000000000000004ish in naive float math; must still exceed a 0.3 threshold precisely
    const result = computeMeaningfulChange({
      currentPrice: 100.30000000000001,
      baselinePrice: 100,
      dayHigh: 101.2,
      dayLow: 100,
      previousClose: 100,
    });
    // range=1.2, rangePercent=1.2%, threshold=clamp(0.3,0.5,3)=0.5 (floor applies)
    expect(result.thresholdPercent).toBe(0.5);
    expect(result.deltaPercent).toBeCloseTo(0.3, 10);
  });

  it("falls back to 1.0% threshold when dayHigh/dayLow/previousClose are missing", () => {
    const result = computeMeaningfulChange({ currentPrice: 100.8, baselinePrice: 100, dayHigh: null, dayLow: null, previousClose: null });
    expect(result.thresholdPercent).toBe(1.0);
  });

  it("falls back to 1.0% threshold when dayRange <= 0", () => {
    const result = computeMeaningfulChange({ currentPrice: 100.8, baselinePrice: 100, dayHigh: 100, dayLow: 100, previousClose: 100 });
    expect(result.thresholdPercent).toBe(1.0);
  });

  it("delta of exactly zero is never meaningful", () => {
    const result = computeMeaningfulChange({ currentPrice: 100, baselinePrice: 100, dayHigh: 110, dayLow: 90, previousClose: 100 });
    expect(result.meaningful).toBe(false);
    expect(result.deltaPercent).toBe(0);
  });

  it("guards against a non-positive baseline instead of throwing", () => {
    const result = computeMeaningfulChange({ currentPrice: 100, baselinePrice: 0, dayHigh: 110, dayLow: 90, previousClose: 100 });
    expect(result.meaningful).toBe(false);
  });
});
