// POST /api/watchlists - creates an owner and its capability token. This is
// the only endpoint that does not require a credential, since it is what
// issues one. Owner creation is explicit POST behavior; no GET ever creates
// an owner as a side effect.

import { getDb } from "@/db/client";
import { AUTH_COOKIE, authCookieOptions, createOwner } from "@/lib/auth";
import { handleRoute, jsonResponse } from "@/lib/http";

export async function POST() {
  return handleRoute(async () => {
    const { token } = await createOwner(getDb());
    const response = jsonResponse({ token }, 201);
    response.cookies.set(AUTH_COOKIE, token, authCookieOptions());
    return response;
  });
}
