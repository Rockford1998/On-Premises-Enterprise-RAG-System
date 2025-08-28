import express from "express";
import { init } from "./db/init";
import router from "./routes/app.routes";
import cors from "cors";
import dotenv from 'dotenv';
import './db/mongo';
import { authenticateJWT } from "./middlewares/auth.middleware";

//
dotenv.config({
  path: `.env.${process.env.NODE_ENV}`.substring(
    0,
    `.env.${process.env.NODE_ENV}`.length - 1
  ),
});

const app = express();
const port = process.env.PORT || 3000;

async function service() {
  await init();
  app.use(express.json());
  app.use(cors({ origin: "*" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/", authenticateJWT, router);
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}

service();
