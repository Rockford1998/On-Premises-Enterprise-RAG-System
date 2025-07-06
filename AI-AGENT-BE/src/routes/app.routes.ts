// routes/kb.routes.ts
import { Router } from "express";
import { addKnowledgeBase, chatBot, deleteKnowledgeBase, readKnowledgeBase, streamChatBot, } from "../controller/kb.controller";
import { upload } from "../middlewares/uploadMiddleware";

const router = Router();



// KB handling endpoints
router.get("/", readKnowledgeBase)
router.post("/upload", upload.single("file"), addKnowledgeBase);
router.delete("/delete/:fileName", deleteKnowledgeBase)

// Endpoint to handle chat requests
router.post("/chat", chatBot);
router.post("/streamChat", streamChatBot);


export default router;
