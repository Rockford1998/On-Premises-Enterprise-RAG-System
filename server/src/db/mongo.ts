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
}

/** Close the connection. Safe to call when already disconnected. */
export async function closeMongo() {
    // 0 = disconnected
    if (mongoose.connection.readyState === 0) return;
    await mongoose.disconnect();
    console.log("[db] mongodb connection closed");
}

export const isMongoReady = () => mongoose.connection.readyState === 1;
