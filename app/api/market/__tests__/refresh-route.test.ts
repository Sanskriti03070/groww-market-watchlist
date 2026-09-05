// The authentication boundary for the external-scheduler refresh endpoint.
// getDb() is redirected to the embedded test database, refreshMarketData is
// stubbed (so no real NSE/network call happens), and only the calendar's
// regularSessionCloseFor is stubbed (used solely on the postClose path).

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async () => {
  const { getTestDb } = await import("@/lib/__tests__/test-db");
  return { getDb: () => getTestDb() };
});

vi.mock("@/lib/market/refresh-service", () => ({
  refreshMarketData: vi.fn(),
}));

vi.mock("@/lib/nse-session-calendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nse-session-calendar")>();
  return { ...actual, regularSessionCloseFor: vi.fn() };
});

import { GET, POST } from "@/app/api/market/refresh/route";
import { refreshMarketData } from "@/lib/market/refresh-service";
import { regularSessionCloseFor } from "@/lib/nse-session-calendar";

const SECRET = "test-market-refresh-secret-value";
const REFRESH_URL = "http://localhost/api/market/refresh";

function request(url: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(url, { method: init.method ?? "GET", headers: new Headers(init.headers) });
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(refreshMarketData).mockReset().mockResolvedValue({ ran: true, succeeded: 3, failed: 0 });
  vi.mocked(regularSessionCloseFor).mockReset();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("refresh endpoint authentication boundary", () => {
  it("1. missing credentials -> 401, refresh never runs", async () => {
    vi.stubEnv("MARKET_REFRESH_SECRET", SECRET);

    const response = await GET(request(REFRESH_URL));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized", message: "A valid refresh credential is required." });
    expect(refreshMarketData).not.toHaveBeenCalled();
  });

  it("2. incorrect secret -> 401, refresh never runs", async () => {
    vi.stubEnv("MARKET_REFRESH_SECRET", SECRET);

    const response = await GET(request(REFRESH_URL, { headers: { authorization: "Bearer wrong-secret" } }));

    expect(response.status).toBe(401);
    expect(refreshMarketData).not.toHaveBeenCalled();
  });

  it("3. server has no MARKET_REFRESH_SECRET configured -> 401 (fails closed)", async () => {
    vi.stubEnv("MARKET_REFRESH_SECRET", "");

    const response = await GET(request(REFRESH_URL, { headers: { authorization: `Bearer ${SECRET}` } }));

    expect(response.status).toBe(401);
    expect(refreshMarketData).not.toHaveBeenCalled();
  });

  it("4. correct secret -> the existing refresh path is reached (GET and POST)", async () => {
    vi.stubEnv("MARKET_REFRESH_SECRET", SECRET);

    const getResponse = await GET(request(REFRESH_URL, { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({ ran: true, succeeded: 3, failed: 0 });
    expect(refreshMarketData).toHaveBeenCalledTimes(1);

    const postResponse = await POST(request(REFRESH_URL, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    expect(postResponse.status).toBe(200);
    expect(refreshMarketData).toHaveBeenCalledTimes(2);
  });

  it("5. correct secret + ?mode=postClose -> the postClose branch is reached", async () => {
    vi.stubEnv("MARKET_REFRESH_SECRET", SECRET);
    // Force "not in the post-close window" deterministically so the response
    // is a postClose-only outcome, proving that branch executed under auth.
    vi.mocked(regularSessionCloseFor).mockReturnValue(new Date("2099-01-01T00:00:00.000Z"));

    const response = await POST(
      request(`${REFRESH_URL}?mode=postClose`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ran: false, reason: "outside_post_close_window" });
    expect(regularSessionCloseFor).toHaveBeenCalledTimes(1);
    expect(refreshMarketData).not.toHaveBeenCalled();
  });

  it("6. the secret never appears in any response body or log line", async () => {
    vi.stubEnv("MARKET_REFRESH_SECRET", SECRET);

    const ok = await GET(request(REFRESH_URL, { headers: { authorization: `Bearer ${SECRET}` } }));
    const rejected = await GET(request(REFRESH_URL, { headers: { authorization: "Bearer a-completely-different-value" } }));

    const bodies = JSON.stringify([await ok.json(), await rejected.json()]);
    const logs = JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls]);

    expect(bodies).not.toContain(SECRET);
    expect(logs).not.toContain(SECRET);
  });
});
