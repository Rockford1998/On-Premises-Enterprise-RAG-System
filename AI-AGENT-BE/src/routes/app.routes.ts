// routes/kb.routes.ts
import { Router } from "express";
import { addKnowledgeBase, chatBot, streamChatBot, test,  } from "../controller/kb.controller";
import { upload } from "../middlewares/uploadMiddleware";

const router = Router();



// Endpoint to handle file upload and training the knowledge base
router.post("/upload", upload.single("file"), addKnowledgeBase);
router.post("/chat", chatBot);
router.post("/streamChat", streamChatBot);

router.get("/test/:q", async (req, res) => {
    console.log("Testing RAG with query:", req.params.q);
    const q = parseInt(req.params.q, 10);
    await test(q);
    res.send("Testing RAG!");
});

export default router;
