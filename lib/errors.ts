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

export function alertNotFoundError(): AppError {
  // Deliberately the same shape whether the id is malformed, belongs to
  // another owner, or simply doesn't exist - a tampered id must behave
  // exactly like a real one that was never there.
  return new AppError(404, "alert_not_found", "Alert not found.");
}

export function symbolNotOnWatchlistError(symbol: string): AppError {
  return new AppError(422, "symbol_not_on_watchlist", `"${symbol}" is not on your watchlist.`);
}

export function alertSymbolInactiveError(symbol: string): AppError {
  return new AppError(422, "symbol_inactive", `"${symbol}" is not currently active.`);
}

export function invalidAlertThresholdError(): AppError {
  return new AppError(422, "invalid_threshold", "The threshold is not valid for this alert.");
}

export function symbolAlertCapExceededError(max: number): AppError {
  return new AppError(409, "symbol_alert_cap_exceeded", `A symbol cannot have more than ${max} alerts.`);
}

export function ownerAlertCapExceededError(max: number): AppError {
  return new AppError(409, "owner_alert_cap_exceeded", `You cannot have more than ${max} alerts.`);
}

export function alertVersionConflictError(): AppError {
  return new AppError(409, "version_conflict", "This alert has changed since you last loaded it. Refetch and retry.");
}
