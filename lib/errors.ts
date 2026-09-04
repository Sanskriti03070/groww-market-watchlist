// Typed application errors. Route handlers catch AppError and translate it to
// the matching HTTP response; every other thrown error is treated as
// unexpected and mapped to a generic 500 so raw database errors are never
// exposed to the client.

export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function unknownSymbolError(symbol: string): AppError {
  return new AppError(422, "unknown_symbol", `"${symbol}" is not a recognized symbol.`);
}

export function inactiveSymbolError(symbol: string): AppError {
  return new AppError(422, "inactive_symbol", `"${symbol}" is not currently active and cannot be added.`);
}

export function maxSizeExceededError(max: number): AppError {
  return new AppError(422, "max_size_exceeded", `A watchlist cannot hold more than ${max} symbols.`);
}

export function staleMembershipError(): AppError {
  return new AppError(
    409,
    "stale_membership",
    "The submitted order does not match the watchlist's current membership. Refetch and retry.",
  );
}
