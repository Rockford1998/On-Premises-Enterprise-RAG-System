const express = require("express");
const pg = require("pg");
const { Pool } = pg;

const pool = new Pool({
  user: "root",
  password: "root",
  host: "localhost",
  port: 5432,
  database: "testdb",
});

const app = express();
app.use(express.json());

async function initializeDatabase() {
  try {
    // Create users table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Users table created or already exists");
    
    // Optional: Insert a test user
    const testUser = await pool.query(
      "INSERT INTO users (name, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING *",
      ["Test User", "test@example.com"]
    );
    
    if (testUser.rows.length > 0) {
      console.log("Test user created");
    }
  } catch (err) {
    console.error("Error creating users table:", err);
    throw err;
  }
}

async function startServer() {
  try {
    // Test the database connection
    const result = await pool.query("SELECT NOW()");
    console.log("Database connected:", result.rows[0]);

    // Initialize database tables
    await initializeDatabase();

    /**
     * CREATE
     */
    app.post("/users", async (req, res) => {
      try {
        const { name, email } = req.body;

        // Validate input
        if (!name || !email) {
          return res.status(400).json({ error: "Name and email are required" });
        }

        // Check if email already exists
        const existingUser = await pool.query(
          "SELECT * FROM users WHERE email = $1",
          [email]
        );

        if (existingUser.rows.length > 0) {
          return res.status(409).json({ error: "Email already exists" });
        }

        const result = await pool.query(
          "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
          [name, email],
        );

        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
      }
    });

    /**
     * READ ALL
     */
    app.get("/users", async (req, res) => {
      try {
        const result = await pool.query("SELECT * FROM users ORDER BY id");
        res.json(result.rows);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
      }
    });

    /**
     * READ ONE
     */
    app.get("/users/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // Validate ID
        if (isNaN(id)) {
          return res.status(400).json({ error: "Invalid user ID" });
        }

        const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);

        if (result.rows.length === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(result.rows[0]);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
      }
    });
    /**
     * READ ONE
     */
    app.get("/users/email/:email", async (req, res) => {
      try {
        const { email } = req.params;


        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

        if (result.rows.length === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(result.rows[0]);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
      }
    });

    /**
     * UPDATE
     */
    app.put("/users/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { name, email } = req.body;

        // Validate input
        if (!name || !email) {
          return res.status(400).json({ error: "Name and email are required" });
        }

        if (isNaN(id)) {
          return res.status(400).json({ error: "Invalid user ID" });
        }

        // Check if email already exists for another user
        const existingUser = await pool.query(
          "SELECT * FROM users WHERE email = $1 AND id != $2",
          [email, id]
        );

        if (existingUser.rows.length > 0) {
          return res.status(409).json({ error: "Email already exists" });
        }

        const result = await pool.query(
          "UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *",
          [name, email, id],
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(result.rows[0]);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
      }
    });

    /**
     * DELETE
     */
    app.delete("/users/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (isNaN(id)) {
          return res.status(400).json({ error: "Invalid user ID" });
        }

        const result = await pool.query(
          "DELETE FROM users WHERE id = $1 RETURNING *",
          [id],
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({ message: "User deleted successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Start the server
    const PORT = 5000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

// Start the application
startServer();