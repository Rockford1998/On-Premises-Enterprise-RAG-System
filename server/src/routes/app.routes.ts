// routes/kb.routes.ts
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { KnowledgeBaseController } from "../controller/kb.controller";
import { upload, UnsupportedFileTypeError } from "../middlewares/uploadMiddleware";
import { sendResponse } from "../util/sendResponse";
import { UserController } from "../controller/user.controller";
import { BotController } from "../controller/bot.controller";
import { ChatController } from "../controller/chat.controller";
import { ToolController } from "../controller/tool.controller";
import { AuthController } from "../controller/auth.controller";
import { LlmModelController } from "../controller/llmModel.controller";
import { MatadataController } from "../controller/metadata.controller";


const router = Router();
const userController = new UserController();
const botController = new BotController();
const knowledgeBaseController = new KnowledgeBaseController();
const chatController = new ChatController();
const toolController = new ToolController();
const authController = new AuthController();
const llmModelController = new LlmModelController();
const matadataController = new MatadataController();

/**
 * Translate multer rejections into 400s. Without this they fall through to
 * Express's default handler and surface as an HTML 500 page.
 */
const handleUploadErrors = (
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
) => {
    if (err instanceof UnsupportedFileTypeError) {
        sendResponse({ res, success: false, message: err.message, status: 400, code: "VALIDATION_ERROR" });
        return;
    }
    if (err instanceof multer.MulterError) {
        const message =
            err.code === "LIMIT_FILE_SIZE"
                ? "File is too large."
                : `Upload failed: ${err.message}`;
        sendResponse({ res, success: false, message, status: 400, code: "VALIDATION_ERROR" });
        return;
    }
    if (err) {
        next(err);
        return;
    }
    next();
};

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
router.get("/bots/owner/:owner", botController.readBotByOwner);
router.post("/bots", botController.create);
router.put("/bots/:botId", botController.update);
router.delete("/bots/:botId", botController.delete);

// LLM profile management endpoint
router.get("/llm", llmModelController.read);
router.get("/llm/:llmId", llmModelController.readById);
router.post("/llm", llmModelController.create);
router.put("/llm/:botId", llmModelController.update);
router.delete("/llm/:botId", llmModelController.delete);

// KB handling endpoints
router.get("/kb", knowledgeBaseController.readKnowledgeBase)
router.get("/kb/:id", knowledgeBaseController.readById)
router.get("/kb/bot-id/:botId", knowledgeBaseController.readBybotId)
router.get("/kb/download/:id", knowledgeBaseController.downloadFile)
router.post("/kb/upload/:botId", upload.single("file"), handleUploadErrors, knowledgeBaseController.addKnowledgeBase);
router.post("/kb/delete", knowledgeBaseController.deleteKnowledgeBase)

// Endpoint to handle chat requests
router.post("/chat", chatController.chatBot);
router.post("/streamChat", chatController.streamChatBot);

// Tool management endpoints
router.get("/tools/bot/:botId", toolController.readToolsByBotId);
router.get("/tools/:id", toolController.readToolById);
router.post("/tools", toolController.createTool);
router.put("/tools/:id", toolController.updateTool);
router.delete("/tools/:id", toolController.deleteTool);


// Auth / session management
router.post("/auth/login", authController.login);
router.post("/auth/refresh", authController.refresh);
router.post("/auth/logout", authController.logout);
router.post("/auth/logout-all", authController.logoutAll);
router.get("/auth/me", authController.me);
// Deprecated: kept so existing clients and .http files keep working.
router.post("/auth", authController.login);

//Metadata
router.get("/metadata/bot-type", matadataController.getBotType)
router.get("/metadata/models", llmModelController.readAvaibleModelsMetadata);

export default router;
