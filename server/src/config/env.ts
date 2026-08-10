/**
 * Central environment configuration.
 *
 * Secrets have no fallback values on purpose: a missing JWT secret must stop
 * the process, not silently sign tokens with a well-known default.
 */

const isProd = process.env.NODE_ENV === "prod";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
      `Set it in .env.${process.env.NODE_ENV ?? "<NODE_ENV>"} before starting the server.`,
    );
  }
  return value;
};

const optional = (name: string, fallback: string): string =>
  process.env[name]?.trim() || fallback;

const seconds = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number of seconds`);
  }
  return parsed;
};

const integer = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer`);
  }
  return parsed;
};

/**
 * Postgres connection settings.
 *
 * DATABASE_URL wins when present; otherwise the discrete DB_* vars are used.
 * Either way the values come from the environment — nothing here is hard-coded,
 * which is what previously pinned the app to a single dev machine.
 */
const buildPostgresConfig = () => {
  const url = process.env.DATABASE_URL?.trim();

  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("DATABASE_URL is not a valid connection URL");
    }
    const database = parsed.pathname.replace(/^\//, "");
    if (!database) {
      throw new Error("DATABASE_URL must include a database name");
    }
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database,
      /** Database to connect to when creating the app database. */
      adminDatabase: optional("DB_ADMIN_DATABASE", "postgres"),
      ssl: optional("DB_SSL", "false") === "true",
      /** Create the application database at startup if it is absent. */
      autoCreateDatabase: optional("DB_AUTO_CREATE", "true") === "true",
      pool: {
        max: integer("DB_POOL_MAX", 10),
        idleTimeoutMillis: integer("DB_POOL_IDLE_TIMEOUT", 30_000),
        connectionTimeoutMillis: integer("DB_POOL_CONNECT_TIMEOUT", 10_000),
        statementTimeoutMillis: integer("DB_STATEMENT_TIMEOUT", 30_000),
      },
    };
  }

  return {
    host: optional("DB_HOST", "localhost"),
    port: integer("DB_PORT", 5432),
    user: optional("DB_USER", "root"),
    password: optional("DB_PASSWORD", "root"),
    database: optional("DB_NAME", "poc"),
    adminDatabase: optional("DB_ADMIN_DATABASE", "postgres"),
    ssl: optional("DB_SSL", "false") === "true",
    autoCreateDatabase: optional("DB_AUTO_CREATE", "true") === "true",
    pool: {
      max: integer("DB_POOL_MAX", 10),
      idleTimeoutMillis: integer("DB_POOL_IDLE_TIMEOUT", 30_000),
      connectionTimeoutMillis: integer("DB_POOL_CONNECT_TIMEOUT", 10_000),
      statementTimeoutMillis: integer("DB_STATEMENT_TIMEOUT", 30_000),
    },
  };
};

export const env = {
  isProd,
  nodeEnv: optional("NODE_ENV", "dev"),
  port: optional("PORT", "3000"),

  postgres: buildPostgresConfig(),

  mongo: {
    url: required("MONGODB_URL"),
    maxPoolSize: integer("MONGO_POOL_MAX", 10),
    minPoolSize: integer("MONGO_POOL_MIN", 0),
    /** Fail fast instead of buffering commands for the 30s default. */
    serverSelectionTimeoutMS: integer("MONGO_SERVER_SELECTION_TIMEOUT", 10_000),
    socketTimeoutMS: integer("MONGO_SOCKET_TIMEOUT", 45_000),
  },

  /** Retry policy for transient database failures. */
  dbRetry: {
    maxAttempts: integer("DB_RETRY_ATTEMPTS", 3),
    baseDelayMs: integer("DB_RETRY_BASE_DELAY", 200),
    maxDelayMs: integer("DB_RETRY_MAX_DELAY", 2_000),
  },

  // Comma-separated list of allowed browser origins. Credentialed CORS forbids
  // the "*" wildcard, so this must be explicit.
  clientOrigins: optional("CLIENT_ORIGIN", "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  auth: {
    accessSecret: required("JWT_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessTtlSeconds: seconds("ACCESS_TOKEN_TTL", 15 * 60),        // 15 minutes
    refreshTtlSeconds: seconds("REFRESH_TOKEN_TTL", 7 * 24 * 3600), // 7 days
    /** Max concurrent sessions per user; oldest is evicted beyond this. */
    maxSessionsPerUser: seconds("MAX_SESSIONS_PER_USER", 5),
    cookieName: optional("REFRESH_COOKIE_NAME", "rag_rt"),
    /** Cookie path — scoped so the refresh token is only sent to auth routes. */
    cookiePath: "/auth",
    /** Secure cookies require HTTPS; disabled outside production for localhost. */
    cookieSecure: isProd,
    /** Login attempts allowed per email+IP within the window. */
    loginMaxAttempts: seconds("LOGIN_MAX_ATTEMPTS", 10),
    loginWindowSeconds: seconds("LOGIN_WINDOW_SECONDS", 15 * 60),
  },
} as const;
