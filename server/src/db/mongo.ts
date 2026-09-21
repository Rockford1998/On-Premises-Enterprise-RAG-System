import mongoose from "mongoose";
import { env } from "../config/env";

/**
 * MongoDB connection management.
 *
 * Connecting is explicit (called from index.ts) so that importing a model has
 * no side effects and a failed connection stops startup loudly.
 */

mongoose.connection.on("connected", () => {
    console.log("[db] mongodb connected");
});

mongoose.connection.on("disconnected", () => {
    console.warn("[db] mongodb disconnected");
});

mongoose.connection.on("reconnected", () => {
    console.log("[db] mongodb reconnected");
});

mongoose.connection.on("error", (err) => {
    console.error("[db] mongodb error:", err.message);
});

/**
 * By default mongoose queues operations while disconnected and only rejects
 * after ~30s, so an outage presents as a hang. Disabling the buffer makes
 * calls fail immediately with a clear error instead.
 */
mongoose.set("bufferCommands", false);

/** Connect using the configured pool and timeout settings. */
export async function mongoCnnection() {
    console.log("[db] connecting to mongodb…");

    await mongoose.connect(env.mongo.url, {
        maxPoolSize: env.mongo.maxPoolSize,
        minPoolSize: env.mongo.minPoolSize,
        // Fail fast when no primary is reachable rather than buffering.
        serverSelectionTimeoutMS: env.mongo.serverSelectionTimeoutMS,
        socketTimeoutMS: env.mongo.socketTimeoutMS,
    });

    console.log(
        `[db] mongodb ready (pool ${env.mongo.minPoolSize}-${env.mongo.maxPoolSize})`,
    );

    await ensureIndexes();
}

/**
 * Build every model's schema indexes now that there is a connection.
 *
 * Mongoose normally does this itself when a model is compiled, but models are
 * compiled at import time — before connect() — and bufferCommands is off, so
 * that automatic attempt fails silently and the indexes were never created on
 * a fresh database. That includes unique ones (user email) and the partial
 * unique index that stops two code-indexing runs overlapping. createIndexes
 * only adds what is missing; it never drops anything.
 *
 * A failure (say, existing duplicate emails blocking a unique index) is
 * logged, not thrown: it must not stop the server from starting.
 */
export async function ensureIndexes() {
    const entries = Object.entries(mongoose.models);
    const results = await Promise.allSettled(entries.map(([, model]) => model.createIndexes()));
    results.forEach((result, i) => {
        if (result.status === "rejected") {
            const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
            console.warn(`[db] could not create indexes for ${entries[i][0]}: ${reason}`);
        }
    });
}

/** Close the connection. Safe to call when already disconnected. */
export async function closeMongo() {
    // 0 = disconnected
    if (mongoose.connection.readyState === 0) return;
    await mongoose.disconnect();
    console.log("[db] mongodb connection closed");
}

export const isMongoReady = () => mongoose.connection.readyState === 1;
