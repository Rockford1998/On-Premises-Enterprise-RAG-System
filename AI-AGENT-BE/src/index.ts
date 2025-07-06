import express from "express";
import { init } from "./db/init";
import router from "./routes/app.routes";
import cors from "cors";
import dotenv from 'dotenv';
import './db/mongo';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

async function service() {
  await init();
  app.use(express.json());
  app.use(cors({ origin: "*" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/", router)

  app.use((err: any, req: any, res: any, next: any) => {
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }

    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Server error" });
  });

  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}

service();
