// src/services/vector.service.ts
import { toSql } from "pgvector/pg";
import { query, withTransaction } from "../db/pgsql";

/**
 * Table and index names are interpolated into SQL because identifiers cannot
 * be parameterised. Every caller derives them from `bot.vectorTable`, which is
 * generated server-side as `vector_table_<botId>` — never taken from a request
 * body. This guard is a second line of defence in case that ever changes.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const assertSafeIdentifier = (name: string, label = "table name"): string => {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(name)}`);
  }
  return name;
};

class VectorService {

  /**
   * Run a query through the pool. Retry and client lifecycle are handled by
   * db/pgsql.query, which acquires a fresh client per attempt and only retries
   * transient failures.
   */
  private static async executeQuery<T>(
    sql: string,
    params: any[] = [],
  ): Promise<T[]> {
    const result = await query<any>(sql, params);
    return result.rows as T[];
  }


  public static async CheckIfkBPresentByFileHash({ fileHash, TABLE_NAME }: { fileHash: string, TABLE_NAME: string }) {
    const table = assertSafeIdentifier(TABLE_NAME);
    // Named `sql`, not `query`: a local `query` would shadow the imported
    // pool helper that executeQuery relies on.
    const sql = `
    SELECT 1
    FROM ${table}
    WHERE metadata->>'fileHash' = $1
    LIMIT 1;
  `;
    const result = await this.executeQuery(sql, [fileHash]) as any[];
    return result.length > 0;
  }


  /**
   *      
   * @description Creates a table with a vector index for storing document embeddings.
   * @param tableName - to make different tables for different users or purposes. default is "document_embeddings".
   * @param dimensions - The number of dimensions for the vector embeddings.
   * @param indexParams - Parameters for the vector index, including type (hnsw or ivfflat) and specific settings.
   * @returns A promise that resolves when the table and index are created.
   */

  public static async createTableWithIndex(
    { dimensions, indexParams, tableName }: {
      tableName: string,
      dimensions: number,
      indexParams: {
        type: "hnsw" | "ivfflat";
        m?: number;
        efConstruction?: number;
        lists?: number;
      }
    }
  ) {
    const table = assertSafeIdentifier(tableName);

    // Interpolated into the DDL, so it must be a plain integer.
    if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 16000) {
      throw new Error(`Invalid vector dimensions: ${dimensions}`);
    }

    const indexType = indexParams.type === "ivfflat" ? "ivfflat" : "hnsw";
    const indexOptions =
      indexType === "hnsw"
        ? `WITH (m = ${Number(indexParams.m) || 16}, ef_construction = ${Number(indexParams.efConstruction) || 64})`
        : `WITH (lists = ${Number(indexParams.lists) || 100})`;

    // One transaction: a bot must not end up with a table but no index, or an
    // index but no updated_at trigger.
    await withTransaction(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id BIGSERIAL PRIMARY KEY,
          embedding vector(${dimensions}) NOT NULL,
          content TEXT,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // NOTE: vector_l2_ops does not match the `<=>` (cosine) operator used by
      // searchVectors, so this index currently goes unused. Tracked separately
      // — see "Known gaps" in docs/ARCHITECTURE.md.
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_${table}_embedding
        ON ${table}
        USING ${indexType} (embedding vector_l2_ops)
        ${indexOptions};
      `);

      await client.query(`
        CREATE OR REPLACE FUNCTION update_modified_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS trigger_update_${table}_updated_at ON ${table};
      `);

      await client.query(`
        CREATE TRIGGER trigger_update_${table}_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION update_modified_column();
      `);
    });
  }

  //
  public static async batchInsertVectors(
    tableName: string = "document_embeddings",
    vectors: {
      embedding: number[];
      content?: string;
      metadata?: Record<string, any>;
    }[],
  ) {
    const table = assertSafeIdentifier(tableName);

    // Without this an empty batch produces "VALUES  RETURNING id" — a syntax
    // error rather than a no-op.
    if (vectors.length === 0) return [];

    const placeholders = vectors
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(",");

    const values = vectors.flatMap((v) => [
      toSql(v.embedding),
      v.content || null,
      v.metadata || null,
    ]);

    // node-postgres returns int8/BIGSERIAL as a string to avoid losing
    // precision past Number.MAX_SAFE_INTEGER — hence `string`, not `number`.
    return this.executeQuery<{ id: string }>(
      `
      INSERT INTO ${table} (embedding, content, metadata)
      VALUES ${placeholders}
      RETURNING id
    `,
      values,
    );
  }

  //
  public static async insertVector(
    { tableName, vector }:
      {
        tableName: string,
        vector: {
          embedding: number[];
          content?: string;
          metadata?: Record<string, any>;
        }
      },
  ) {
    const table = assertSafeIdentifier(tableName);

    // node-postgres returns int8/BIGSERIAL as a string to avoid losing
    // precision past Number.MAX_SAFE_INTEGER — hence `string`, not `number`.
    return this.executeQuery<{ id: string }>(
      `
        INSERT INTO ${table} (embedding, content, metadata)
        VALUES ($1, $2, $3)
        RETURNING id
    `,
      [
        toSql(vector.embedding),
        vector.content || null,
        vector.metadata || null,
      ],
    );
  }

  /**
   * Nearest-neighbour search, ordered by cosine distance.
   *
   * `filter` is raw SQL appended to the WHERE clause and must never be built
   * from user input; `filterParams` supplies its bound values, numbered from
   * $3 onwards.
   */
  public static async searchVectors(
    { options, queryEmbedding, tableName }: {
      tableName: string
      queryEmbedding: number[],
      options: {
        limit?: number;
        efSearch?: number;
        filter?: string;
        filterParams?: any[];
      }
    }
  ) {
    const table = assertSafeIdentifier(tableName);
    const limit = Number.isInteger(options.limit) && (options.limit as number) > 0
      ? (options.limit as number)
      : 10;
    const filterParams = options.filterParams ?? [];

    // $1 embedding, $2 limit, $3.. filter params.
    const sql = `
      SELECT id, content, metadata, embedding <=> $1 AS distance
      FROM ${table}
      ${options.filter ? `WHERE ${options.filter}` : ""}
      ORDER BY distance
      LIMIT $2
    `;
    const params = [toSql(queryEmbedding), limit, ...filterParams];

    // ef_search has to be set on the SAME connection as the search, inside a
    // transaction for SET LOCAL to apply. The previous code sent it through a
    // separate pooled query, where it landed on a different client and was
    // discarded — so the tuning silently never took effect.
    if (options.efSearch) {
      const efSearch = Number(options.efSearch);
      if (!Number.isInteger(efSearch) || efSearch <= 0) {
        throw new Error(`Invalid efSearch: ${options.efSearch}`);
      }
      return withTransaction(async (client) => {
        await client.query(`SET LOCAL hnsw.ef_search = ${efSearch}`);
        const result = await client.query(sql, params);
        return result.rows as Array<{
          id: number;
          content: string;
          metadata: Record<string, any>;
          distance: number;
        }>;
      });
    }

    return this.executeQuery<{
      id: number;
      content: string;
      metadata: Record<string, any>;
      distance: number;
    }>(sql, params);
  }

  public static async deleteOutdatedKnowledgeByFileName(
    { fileName, tableName }: { fileName: string, tableName: string },

  ) {
    const table = assertSafeIdentifier(tableName);
    await this.executeQuery(
      `DELETE FROM ${table} WHERE metadata->>'fileName' = $1`,
      [fileName]
    );
  }

  public static async deleteOutdatedKnowledgeByFileHash(
    { fileHash, tableName }: { fileHash: string, tableName: string },
  ) {
    const table = assertSafeIdentifier(tableName);
    await this.executeQuery(
      `DELETE FROM ${table} WHERE metadata->>'fileHash' = $1`,
      [fileHash]
    );
  }

  public static async deleteTable(
    tableName: string) {
    const table = assertSafeIdentifier(tableName);
    await this.executeQuery(
      `DROP TABLE IF EXISTS ${table} CASCADE`
    );
  }

}

export { VectorService };
