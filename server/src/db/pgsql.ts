import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";
import { env } from "../config/env";
import { DatabaseNotInitialisedError, isTransientDbError } from "./errors";
import { retry } from "../util/retry";

/**
 * Postgres connection management.
 *
 * The pool is module-private and reached through getPool(). It is deliberately
 * NOT exported as a mutable binding: the previous version exported
 * `let appPool` and relied on CommonJS live-binding semantics for consumers to
 * observe the reassignment — which would have broken silently under ESM output.
 */

let appPool: Pool | null = null;
let closing = false;

const cfg = env.postgres;

const basePoolConfig = (database: string): PoolConfig => ({
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database,
  ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
  max: cfg.pool.max,
  idleTimeoutMillis: cfg.pool.idleTimeoutMillis,
  connectionTimeoutMillis: cfg.pool.connectionTimeoutMillis,
  // Server-side cap so a runaway query cannot hold a pooled client forever.
  statement_timeout: cfg.pool.statementTimeoutMillis,
});

/**
 * An idle client emitting 'error' with no listener attached takes the whole
 * process down. Postgres restarts and network blips both trigger this, so the
 * handler is mandatory rather than defensive.
 */
const attachPoolDiagnostics = (pool: Pool, label: string): void => {
  pool.on("error", (error) => {
    console.error(`[db:${label}] idle client error:`, error.message);
  });
};

/** Create the application database if it is missing. */
const ensureDatabaseExists = async (): Promise<void> => {
  const adminPool = new Pool({
    ...basePoolConfig(cfg.adminDatabase),
    max: 1,
  });
  attachPoolDiagnostics(adminPool, "admin");

  try {
    const { rowCount } = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [cfg.database],
    );

    if (rowCount === 0) {
      // An identifier cannot be parameterised. cfg.database comes from trusted
      // configuration, never from a request; quotes are escaped regardless.
      await adminPool.query(
        `CREATE DATABASE "${cfg.database.replace(/"/g, '""')}"`,
      );
      console.log(`[db] created database "${cfg.database}"`);
    }
  } finally {
    // The admin pool is only needed during bootstrap.
    await adminPool.end();
  }
};

/** Connect, verify pgvector, and publish the application pool. */
export const initPostgres = async (): Promise<Pool> => {
  if (appPool) return appPool;

  if (cfg.autoCreateDatabase) {
    await ensureDatabaseExists();
  }

  const pool = new Pool(basePoolConfig(cfg.database));
  attachPoolDiagnostics(pool, "app");

  // Verify connectivity and the extension before publishing the pool, so a
  // half-working database never reaches request handling.
  const client = await pool.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");

    const { rows } = await client.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    if (rows.length === 0) {
      throw new Error(
        "pgvector extension is unavailable. Use the pgvector/pgvector image or install the extension.",
      );
    }

    console.log(
      `[db] postgres ready — ${cfg.host}:${cfg.port}/${cfg.database} ` +
      `(pgvector ${rows[0].extversion}, pool max ${cfg.pool.max})`,
    );
  } catch (error) {
    client.release();
    await pool.end();
    throw error;
  }

  client.release();
  appPool = pool;
  return appPool;
};

/** The application pool. Throws if initialisation has not completed. */
export const getPool = (): Pool => {
  if (!appPool) throw new DatabaseNotInitialisedError();
  return appPool;
};

export const isPostgresReady = (): boolean => appPool !== null;

/**
 * Run work with a pooled client, always releasing it.
 *
 * Prefer this over getPool().connect(): a missed release() leaks a client, and
 * once `max` clients leak the pool deadlocks silently.
 */
export const withClient = async <T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
};

/** Run work in a transaction: COMMIT on success, ROLLBACK on throw. */
export const withTransaction = async <T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> =>
  withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // A failed rollback usually means the connection is already gone.
        // Surface the original error, not this one.
        console.error("[db] rollback failed:", rollbackError);
      }
      throw error;
    }
  });

/**
 * Single query with retry on transient failures.
 *
 * Each attempt acquires a FRESH client. The previous implementation retried
 * against one already-acquired client, so a dropped connection failed all
 * three attempts identically — the retry could never help the case it existed
 * for.
 */
export const query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> =>
  retry(() => withClient((client) => client.query<T>(text, params)), {
    maxAttempts: env.dbRetry.maxAttempts,
    baseDelayMs: env.dbRetry.baseDelayMs,
    maxDelayMs: env.dbRetry.maxDelayMs,
    shouldRetry: isTransientDbError,
    onRetry: (error, attempt) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[db] transient error, retrying (attempt ${attempt}): ${message}`,
      );
    },
  });

/** Close the pool. Safe to call more than once. */
export const closePostgres = async (): Promise<void> => {
  if (!appPool || closing) return;
  closing = true;
  const pool = appPool;
  try {
    await pool.end();
    console.log("[db] postgres pool closed");
  } finally {
    appPool = null;
    closing = false;
  }
};
