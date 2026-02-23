
import express from "express";
import { init } from "./db/init";
import router from "./routes/app.routes";
import cors from "cors";

import dotenv from "dotenv";
dotenv.config({
  path: `.env.${process.env.NODE_ENV}`
});

import "./db/mongo";
import { authenticateJWT } from "./middlewares/auth.middleware"; 1

//
const app = express();
const port = process.env.PORT;
app.use(express.json());
app.use(cors({ origin: "*" }));
app.use(express.urlencoded({ extended: true }));
app.use("/", authenticateJWT, router);
app.listen(port, async () => {
  await init();
  console.log(`Environment: [${process.env.NODE_ENV}]`)
  console.log(`Server is running on http://localhost:${port}`);
});

