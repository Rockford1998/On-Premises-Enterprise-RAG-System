import { VectorService } from "../services/vectors.service";
import { initializeDatabase } from "./pgsql";


// This function initializes the database and creates a table for storing document embeddings.
// It should be called once at application startup to set up the necessary schema.
export async function init() {
  try {
    // Initialize the database
    await initializeDatabase();
    // Create a table for our vectors
    const TABLE_NAME = "document_embeddings";
    const VECTOR_DIMENSIONS = 768; // Adjust based on your model (e.g., OpenAI uses 1536)
    await VectorService.createTableWithIndex({ dimensions: VECTOR_DIMENSIONS, indexParams: { type: "hnsw" }, tableName: TABLE_NAME });
  } catch (error) {
    console.error("Application error:", error);
  }
}
