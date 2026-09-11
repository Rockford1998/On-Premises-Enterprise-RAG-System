// routes/kb.routes.ts
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { KnowledgeBaseController } from "../controller/kb.controller";
import { KnowledgeConnectionController } from "../controller/knowledgeConnection.controller";
import { upload, UnsupportedFileTypeError } from "../middlewares/uploadMiddleware";
import { sendResponse } from "../util/sendResponse";
import { UserController } from "../controller/user.controller";
import { BotController } from "../controller/bot.controller";
import { ChatController } from "../controller/chat.controller";
import { ToolController } from "../controller/tool.controller";
import { AuthController } from "../controller/auth.controller";
import { LlmModelController } from "../controller/llmModel.controller";
import { MatadataController } from "../controller/metadata.controller";
import { requireRole } from "../middlewares/auth.middleware";


const router = Router();
const userController = new UserController();
const botController = new BotController();
const knowledgeBaseController = new KnowledgeBaseController();
const knowledgeConnectionController = new KnowledgeConnectionController();
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
// Param must be named :id — LlmModelController.readById/update/delete all
// destructure req.params.id; a mismatched name here silently resolves to
// undefined and every by-id lookup 404s.
router.get("/llm", llmModelController.read);
router.get("/llm/:id", llmModelController.readById);
router.post("/llm", llmModelController.create);
router.put("/llm/:id", llmModelController.update);
router.delete("/llm/:id", llmModelController.delete);

// KB handling endpoints
// Unscoped list across every bot's KB — not resource-owner-checkable, so
// restricted to admins rather than left open to any authenticated user.
router.get("/kb", requireRole("CONFIG_ADMIN"), knowledgeBaseController.readKnowledgeBase)
router.get("/kb/:id", knowledgeBaseController.readById)
router.get("/kb/bot-id/:botId", knowledgeBaseController.readBybotId)
router.get("/kb/download/:id", knowledgeBaseController.downloadFile)
router.post("/kb/upload/:botId", upload.single("file"), handleUploadErrors, knowledgeBaseController.addKnowledgeBase);
router.post("/kb/delete", knowledgeBaseController.deleteKnowledgeBase)

// Knowledge-base source connections (Google Drive sync). The OAuth callback
// is registered here but listed in PUBLIC_ROUTES in auth.middleware.ts —
// Google redirects the bare browser to it with no Authorization header.
router.post("/kb/connections/:botId", knowledgeConnectionController.startConnect);
router.get("/kb/connections/bot/:botId", knowledgeConnectionController.listConnections);
router.get("/kb/connections/google/callback", knowledgeConnectionController.completeConnect);
router.get("/kb/connections/:connectionId/folders", knowledgeConnectionController.listFolders);
router.put("/kb/connections/:connectionId/folder", knowledgeConnectionController.setFolder);
router.post("/kb/connections/:connectionId/sync", knowledgeConnectionController.triggerSync);
router.get("/kb/connections/:connectionId/logs", knowledgeConnectionController.getLogs);
router.delete("/kb/connections/:connectionId", knowledgeConnectionController.disconnect);

// Endpoint to handle chat requests
router.post("/chat", chatController.chatBot);

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
