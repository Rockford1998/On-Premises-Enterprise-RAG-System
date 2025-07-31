// routes/kb.routes.ts
import { Router } from "express";
import { KnowledgeBaseController } from "../controller/kb.controller";
import { upload } from "../middlewares/uploadMiddleware";
import { UserController } from "../controller/user.controller";
import { BotController } from "../controller/bot.controller";


const router = Router();
const userController = new UserController();
const botController = new BotController();
const knowledgeBaseController = new KnowledgeBaseController();
// User management endpoints
router.get("/users", userController.readUser);
router.get("/users/email/:email", userController.findUserByEmail);
router.get("/users/username/:userName", userController.findUserByUserName);
router.post("/users", userController.createUser);
router.put("/users/email/:email", userController.updateUserByEmail);
router.delete("/users/email/:email", userController.deleteUserByEmail);

// Bot management endpoints
router.get("/bots", botController.readBots);
router.get("/bots/:botId", botController.readBotById);
router.post("/bots", botController.create);
router.put("/bots/:botId", botController.update);
router.delete("/bots/:botId", botController.delete);

// KB handling endpoints
router.get("/kb", knowledgeBaseController.readKnowledgeBase)
router.post("/kb/upload/:botId", upload.single("file"), knowledgeBaseController.addKnowledgeBase);
router.post("/kb/delete", knowledgeBaseController.deleteKnowledgeBase)

// Endpoint to handle chat requests
router.post("/chat", knowledgeBaseController.chatBot);
router.post("/streamChat", knowledgeBaseController.streamChatBot);


export default router;
