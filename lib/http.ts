// Tiny response helpers shared by every route handler: a consistent JSON
// error shape, the Referrer-Policy header on every response, safe body
// parsing, and one place that turns a thrown AppError into the matching
// HTTP response (so route handlers stay a single try-free async function).

import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";

export function jsonResponse(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function errorResponse(status: number, code: string, message: string): NextResponse {
  return jsonResponse({ error: code, message }, status);
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleRoute(work: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.status, error.code, error.message);
    }
    // Never leak raw database/driver errors to the client.
    console.error(error);
    return errorResponse(500, "internal_error", "Something went wrong.");
  }
}
