// One-off migration: existing vector_table_* indexes were built with
// vector_l2_ops, which Postgres cannot use for the `<=>` (cosine) ordering
// searchVectors runs — every search has been a sequential scan. Embeddings are
// L2-normalised, so vector_cosine_ops ranks identically while letting the
// index actually engage. New tables already get this via
// VectorService.createTableWithIndex; this script catches up existing ones.
//
// Usage: npm run migrate:hnsw-cosine
import dotenv from "dotenv";
dotenv.config({ path: `.env.${process.env.NODE_ENV || "dev"}` });

import { initPostgres, closePostgres } from "../db/pgsql";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function main() {
  const pool = await initPostgres();

  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'vector\\_table\\_%' ESCAPE '\\'`,
  );

  if (rows.length === 0) {
    console.log("No vector_table_* tables found — nothing to migrate.");
    await closePostgres();
    return;
  }

  console.log(`Found ${rows.length} table(s) to reindex:`);
  rows.forEach((r) => console.log(`  - ${r.tablename}`));

  for (const { tablename } of rows) {
    // Table names came straight from pg_tables (trusted), but re-validate
    // before interpolating into DDL as a matter of habit — the same guard
    // VectorService applies to every identifier it embeds in SQL.
    if (!IDENTIFIER_PATTERN.test(tablename)) {
      console.warn(`Skipping "${tablename}": does not look like a safe identifier.`);
      continue;
    }

    const indexName = `idx_${tablename}_embedding`;
    console.log(`\n[${tablename}] dropping ${indexName} (vector_l2_ops)...`);
    await pool.query(`DROP INDEX IF EXISTS ${indexName}`);

    console.log(`[${tablename}] creating ${indexName} (vector_cosine_ops)...`);
    await pool.query(
      `CREATE INDEX ${indexName} ON ${tablename} USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200)`,
    );
    console.log(`[${tablename}] done.`);
  }

  console.log("\nAll vector_table_* indexes rebuilt with vector_cosine_ops.");
  await closePostgres();
}

main().catch(async (error) => {
  console.error("Migration failed:", error);
  await closePostgres();
  process.exit(1);
});
