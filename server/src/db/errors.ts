/**
 * Postgres error classification.
 *
 * Retrying is only safe for failures that might succeed on a second attempt.
 * Retrying a syntax error or a constraint violation just burns time and
 * returns the same error three times slower — the previous implementation
 * retried everything indiscriminately.
 *
 * Codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

export class DatabaseNotInitialisedError extends Error {
  constructor() {
    super(
      "Database not initialised. initPostgres() must complete before queries run.",
    );
    this.name = "DatabaseNotInitialisedError";
  }
}

/** Connection-level failures surfaced by node-postgres / libpq, not by the server. */
const TRANSIENT_SYSTEM_ERRORS = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

/** SQLSTATE codes worth a second attempt. */
const TRANSIENT_SQL_STATES = new Set([
  // Class 08 — connection exceptions
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  // Class 40 — transaction rollback (concurrency, retryable by definition)
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  // Class 53 — insufficient resources
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
  // Class 57 — operator intervention
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (server starting up)
  // Class 55 — object not in prerequisite state
  "55P03", // lock_not_available
  "55006", // object_in_use
]);

/**
 * SQLSTATE prefixes that are always the caller's fault. Listed explicitly so
 * an unrecognised code defaults to NOT retrying — failing fast beats masking
 * a real bug behind backoff.
 */
const PERMANENT_SQL_STATE_CLASSES = [
  "22", // data exception (invalid text representation, division by zero, …)
  "23", // integrity constraint violation
  "42", // syntax error or access rule violation
  "3D", // invalid catalog name
  "3F", // invalid schema name
];

type PgLikeError = {
  code?: string;
  errno?: string;
  message?: string;
};

/** True when the failure has a plausible chance of succeeding on retry. */
export const isTransientDbError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;

  const { code } = error as PgLikeError;
  if (!code) {
    // No code at all usually means a socket-level abort surfaced as a bare
    // Error; treat the well-known connection messages as transient.
    const message = (error as PgLikeError).message ?? "";
    return (
      /connection terminated/i.test(message) ||
      /connection ended/i.test(message) ||
      /server closed the connection/i.test(message) ||
      /timeout exceeded when trying to connect/i.test(message)
    );
  }

  if (TRANSIENT_SYSTEM_ERRORS.has(code)) return true;
  if (TRANSIENT_SQL_STATES.has(code)) return true;
  if (PERMANENT_SQL_STATE_CLASSES.some((cls) => code.startsWith(cls))) {
    return false;
  }

  return false;
};

/**
 * True for errors caused by a bad request rather than by infrastructure.
 * Useful for mapping to a 4xx instead of a 5xx.
 */
export const isClientDbError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const { code } = error as PgLikeError;
  if (!code) return false;
  return PERMANENT_SQL_STATE_CLASSES.some((cls) => code.startsWith(cls));
};

/** Undefined-table (42P01), used to distinguish a missing bot vector table. */
export const isUndefinedTableError = (error: unknown): boolean =>
  !!error &&
  typeof error === "object" &&
  (error as PgLikeError).code === "42P01";
