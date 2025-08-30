import { Pool } from "pg";

// Database configuration
const adminPool = new Pool({
  user: "root",
  host: "localhost",
  database: "postgres", // Connect to default maintenance database first
  password: "root",
  port: 5432,
});

let appPool: Pool | null = null; // This will hold our application pool

async function createDatabase() {
  const client = await adminPool.connect();
  try {
    // Check if database exists first
    const dbExists = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      ["poc"],
    );

    if (dbExists.rowCount === 0) {
      await client.query("CREATE DATABASE poc");
      console.log("Database poc created successfully");
    } else {
      console.log("Database poc already exists");
    }
  } catch (error: any) {
    console.error("Error creating database:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Initialize pgvector extension and application pool
async function initializeDatabase() {

  await createDatabase();
  // Create the application pool after ensuring database exists
  appPool = new Pool({
    user: "root",
    host: "localhost",
    database: "poc", // Now connect to our application database
    password: "root",
    port: 5432,
  });

  const client = await appPool.connect();

  try {
    // Initialize vector extension
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    // Test the extension
    await client.query(`
            CREATE TEMPORARY TABLE test_pgvector (
                id serial PRIMARY KEY,
                embedding vector(3)
            )
        `);

    await client.query(`
            INSERT INTO test_pgvector (embedding) VALUES ('[1,2,3]')
        `);

    console.log("Database and pgvector extension initialized successfully");
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Function to get a database client from the application pool
async function getClient() {
  if (!appPool) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  const client = await appPool.connect();
  await client.query("SET search_path TO public");
  return client;
}

// Graceful shutdown
async function closePools() {
  if (appPool) await appPool.end();
  await adminPool.end();
  console.log("Database pools closed");
}

export { appPool, initializeDatabase, closePools };
