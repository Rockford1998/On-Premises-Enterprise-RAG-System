// src/services/vector.service.ts
import { toSql } from "pgvector/pg";
import { retry } from "../util/retry";
import { appPool } from "./pgsql";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const TABLE_NAME = "document_embeddings";

class VectorService {

  //
  private static async executeQuery<T>(
    query: string,
    params: any[] = [],
  ): Promise<T[]> {
    if (!appPool) {
      throw new Error("Database connection pool is not initialized");
    }
    const client = await appPool.connect();
    try {
      const result = await retry(
        () => client.query(query, params),
        MAX_RETRIES,
        RETRY_DELAY,
      );
      return result.rows;
    } catch (error) {
      throw error;
    } finally {
      client.release();
    }
  }


  public static async CheckIfkBPresentByFileHash({ fileHash }: { fileHash: string }) {
    const query = `
    SELECT 1
    FROM ${TABLE_NAME}
    WHERE metadata->>'fileHash' = $1
    LIMIT 1;
  `;
    const result = await this.executeQuery(query, [fileHash]) as any[];
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
    tableName: string = "document_embeddings",
    dimensions: number,
    indexParams: {
      type: "hnsw" | "ivfflat";
      m?: number;
      efConstruction?: number;
      lists?: number;
    },
  ) {
    await this.executeQuery(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id BIGSERIAL PRIMARY KEY,
        embedding vector(${dimensions}) NOT NULL,
        content TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await this.executeQuery(`
      CREATE INDEX IF NOT EXISTS idx_${tableName}_embedding 
      ON ${tableName} 
      USING ${indexParams.type} (embedding vector_l2_ops)
      ${indexParams.type === "hnsw"
        ? `WITH (m = ${indexParams.m || 16}, ef_construction = ${indexParams.efConstruction || 64
        })`
        : `WITH (lists = ${indexParams.lists || 100})`
      };
    `);

    // Add trigger for updated_at
    await this.executeQuery(`
      CREATE OR REPLACE FUNCTION update_modified_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trigger_update_${tableName}_updated_at ON ${tableName};
      CREATE TRIGGER trigger_update_${tableName}_updated_at
      BEFORE UPDATE ON ${tableName}
      FOR EACH ROW EXECUTE FUNCTION update_modified_column();
    `);
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
    const placeholders = vectors
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(",");

    const values = vectors.flatMap((v) => [
      toSql(v.embedding),
      v.content || null,
      v.metadata || null,
    ]);

    return this.executeQuery<{ id: number }>(
      `
      INSERT INTO ${tableName} (embedding, content, metadata)
      VALUES ${placeholders}
      RETURNING id
    `,
      values,
    );
  }

  //
  public static async insertVector(
    tableName: string = "document_embeddings",
    vector: {
      embedding: number[];
      content?: string;
      metadata?: Record<string, any>;
    },
  ) {

    return this.executeQuery<{ id: number }>(
      `
        INSERT INTO ${tableName} (embedding, content, metadata)
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

  // --- Search vectors using HNSW 
  public static async searchVectors(
    tableName: string = "document_embeddings",
    queryEmbedding: number[],
    options: {
      limit?: number;
      efSearch?: number;
      filter?: string;
      filterParams?: any[];
    } = {},
  ) {
    if (options.efSearch) {
      await this.executeQuery(`SET LOCAL hnsw.ef_search = ${options.efSearch}`);
    }

    return this.executeQuery<{
      id: number;
      content: string;
      metadata: Record<string, any>;
      distance: number;
    }>(
      `
      SELECT id, content, metadata, embedding <=> $1 AS distance
      FROM ${tableName}
      ${options.filter ? `WHERE ${options.filter}` : ""}
      ORDER BY distance
      LIMIT $${options.filter ? 3 : 2}
    `,
      [
        toSql(queryEmbedding),
        options.limit || 10,
        ...(options.filterParams || []),
      ],
    );
  }

  public static async deleteOutdatedKnowledgeByFileName(
    { fileName }: { fileName: string },
  ) {
    await this.executeQuery(`    DELETE FROM documents
    WHERE metadata->>'filename' = ${fileName}`);
  }
}

export { VectorService };
