import dotenv from "dotenv";

// Load environment before any module that reads it at import time.
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { env } from "./config/env";
import { init } from "./db/init";
import { closeMongo, isMongoReady, mongoCnnection } from "./db/mongo";
import { closePostgres, isPostgresReady } from "./db/pgsql";
import router from "./routes/app.routes";
import { authenticateJWT } from "./middlewares/auth.middleware";

const app = express();

// Behind a reverse proxy this makes req.ip the real client address, which the
// login throttle and session audit fields depend on.
app.set("trust proxy", true);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Credentialed CORS cannot use a wildcard origin: the refresh cookie only
// travels if the origin is echoed back explicitly.
app.use(
  cors({
    origin: env.clientOrigins,
    credentials: true,
  }),
);

app.get("/health", (_req, res) => {
  const postgres = isPostgresReady();
  const mongo = isMongoReady();
  const healthy = postgres && mongo;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    environment: env.nodeEnv,
    dependencies: {
      postgres: postgres ? "up" : "down",
      mongodb: mongo ? "up" : "down",
    },
  });
});

app.use("/", authenticateJWT, router);

const start = async () => {
  // Connect and migrate before accepting traffic, otherwise early requests
  // hit a null connection pool.
  await mongoCnnection();
  await init();

  const server = app.listen(env.port, () => {
    console.log(`Environment: [${env.nodeEnv}]`);
    console.log(`Allowed origins: ${env.clientOrigins.join(", ")}`);
    console.log(`Server is running on http://localhost:${env.port}`);
  });

  /**
   * Stop accepting connections, finish in-flight requests, then close the
   * database handles. Without this, pooled Postgres clients and the mongo
   * socket are torn down abruptly on every restart.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] ${signal} received, closing down…`);

    // Force-exit if a hung connection prevents a clean close.
    const forceExit = setTimeout(() => {
      console.error("[shutdown] timed out after 10s, forcing exit");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      console.log("[shutdown] http server closed");

      await Promise.allSettled([closePostgres(), closeMongo()]);
      console.log("[shutdown] complete");
      process.exit(0);
    } catch (error) {
      console.error("[shutdown] error while closing:", error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    console.error("[fatal] unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[fatal] uncaught exception:", error);
    void shutdown("uncaughtException");
  });
};

start().catch(async (error) => {
  console.error("Fatal: server failed to start.", error);
  // Release anything that did open before the failure.
  await Promise.allSettled([closePostgres(), closeMongo()]);
  process.exit(1);
});
