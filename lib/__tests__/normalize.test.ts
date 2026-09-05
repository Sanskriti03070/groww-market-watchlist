import { describe, expect, it } from "vitest";
import { normalizeDailyBars, type DailyBar } from "@/lib/market/normalize";

const ref = { symbol: "RELIANCE", providerSymbol: "RELIANCE-EQ" };
const now = new Date("2026-06-03T10:00:00.000Z");

function bar(overrides: Partial<DailyBar>): DailyBar {
  return { open: 100, high: 105, low: 99, close: 102, volume: 1000, time: 1_780_000_000_000, ...overrides };
}

describe("normalizeDailyBars", () => {
  it("derives a quote from the last two bars when the market is closed", () => {
    const bars = [bar({ close: 100, time: 1 }), bar({ close: 102, time: 2 })];
    const result = normalizeDailyBars(ref, bars, now, { isOpen: false, todayIstDate: "2026-06-03" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quote.lastPrice).toBe("102");
      expect(result.quote.previousClose).toBe("100");
      expect(result.quote.weekHigh52).toBeNull();
      expect(result.quote.weekLow52).toBeNull();
    }
  });

  it("fails with INCOMPLETE when fewer than two bars are available", () => {
    const result = normalizeDailyBars(ref, [bar({})], now, { isOpen: false, todayIstDate: "2026-06-03" });
    expect(result).toEqual({ ok: false, failure: { symbol: "RELIANCE", reason: "INCOMPLETE" } });
  });

  it("fails with MALFORMED when a required numeric field isn't finite", () => {
    const bars = [bar({}), bar({ close: Number.NaN })];
    const result = normalizeDailyBars(ref, bars, now, { isOpen: false, todayIstDate: "2026-06-03" });
    expect(result).toEqual({ ok: false, failure: { symbol: "RELIANCE", reason: "MALFORMED" } });
  });

  it("fails with INCOMPLETE while OPEN if the latest bar isn't from today - never presents yesterday's close as live", () => {
    const yesterday = new Date("2026-06-02T05:00:00.000Z").getTime();
    const bars = [bar({}), bar({ time: yesterday })];
    const result = normalizeDailyBars(ref, bars, now, { isOpen: true, todayIstDate: "2026-06-03" });
    expect(result).toEqual({ ok: false, failure: { symbol: "RELIANCE", reason: "INCOMPLETE" } });
  });

  it("accepts a same-day latest bar while OPEN", () => {
    const today = new Date("2026-06-03T05:00:00.000Z").getTime();
    const bars = [bar({}), bar({ time: today })];
    const result = normalizeDailyBars(ref, bars, now, { isOpen: true, todayIstDate: "2026-06-03" });
    expect(result.ok).toBe(true);
  });

  it("nulls out dayHigh/dayLow individually when inconsistent with lastPrice, without rejecting the quote", () => {
    const bars = [bar({}), bar({ close: 102, high: 101, low: 99 })]; // high < close
    const result = normalizeDailyBars(ref, bars, now, { isOpen: false, todayIstDate: "2026-06-03" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quote.dayHigh).toBeNull();
      expect(result.quote.dayLow).toBe("99");
      expect(result.quote.lastPrice).toBe("102");
    }
  });
});
