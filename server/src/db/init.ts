import { initPostgres } from "./pgsql";
import { CodeGraphService } from "../services/codeGraph.service";

/**
 * Bring the Postgres side up at startup.
 *
 * initPostgres creates the database if needed, verifies pgvector, and opens
 * the pool. Per-bot vector tables are created on demand by BotController when
 * a KB_Bot is created — there is no global schema to migrate here.
 *
 * Historically this also created a shared `document_embeddings` table and a
 * `test_pgvector` temp table on every boot. Neither was ever read: per-bot
 * tables superseded the former and the latter was an extension smoke-test that
 * initPostgres now covers by querying pg_extension directly.
 */
export async function init() {
  try {
    await initPostgres();
  } catch (error) {
    // Rethrow: a database that failed to initialise must stop startup rather
    // than leave the server serving 500s.
    console.error("Database initialisation failed:", error);
    throw error;
  }

  // Code_Interpreter needs pg_trgm. It is optional infrastructure, so a
  // failure must not block startup for deployments that never use it — bot
  // creation re-runs this and reports the reason to the caller.
  try {
    await CodeGraphService.ensureExtensions();
  } catch (error) {
    console.warn(
      "[db] pg_trgm unavailable — Code_Interpreter bots cannot be created until it is:",
      error instanceof Error ? error.message : error,
    );
  }
}
