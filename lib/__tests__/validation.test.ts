import { describe, expect, it } from "vitest";
import { parseAddItemBody, parseOrderBody } from "@/lib/validation";

describe("validation", () => {
  it("accepts a well-formed add body", () => {
    expect(parseAddItemBody({ symbol: "RELIANCE" })).toEqual({ symbol: "RELIANCE" });
  });

  it("rejects an add body with a malformed symbol", () => {
    expect(parseAddItemBody({ symbol: "not valid!" })).toBeNull();
    expect(parseAddItemBody({ symbol: "" })).toBeNull();
    expect(parseAddItemBody({})).toBeNull();
    expect(parseAddItemBody(null)).toBeNull();
    expect(parseAddItemBody("RELIANCE")).toBeNull();
  });

  it("accepts a well-formed order body", () => {
    expect(parseOrderBody({ symbols: ["A", "B", "C"] })).toEqual({ symbols: ["A", "B", "C"] });
  });

  it("rejects an order body with duplicate symbols", () => {
    expect(parseOrderBody({ symbols: ["A", "B", "A"] })).toBeNull();
  });

  it("rejects an order body that is empty or not an array", () => {
    expect(parseOrderBody({ symbols: [] })).toBeNull();
    expect(parseOrderBody({ symbols: "A,B" })).toBeNull();
    expect(parseOrderBody({})).toBeNull();
  });

  it("rejects an order body over the max watchlist size", () => {
    const symbols = Array.from({ length: 51 }, (_, i) => `SYM${i}`);
    expect(parseOrderBody({ symbols })).toBeNull();
  });
});
