// routes/kb.routes.ts
import { Router } from "express";
import { addKnowledgeBase, chatBot, deleteKnowledgeBase, readKnowledgeBase, streamChatBot, } from "../controller/kb.controller";
import { upload } from "../middlewares/uploadMiddleware";
import { UserController } from "../controller/user.controller";


const router = Router();
const userController = new UserController();
// User management endpoints
router.get("/users", userController.readUser);
router.get("/users/email/:email", userController.findUserByEmail);
router.get("/users/username/:userName", userController.findUserByUserName);
router.post("/users", userController.createUser);
router.put("/users/email/:email", userController.updateUserByEmail);
router.delete("/users/email/:email", userController.deleteUserByEmail);

// KB handling endpoints
router.get("/kb", readKnowledgeBase)
router.post("/kb/upload", upload.single("file"), addKnowledgeBase);
router.delete("/kb/delete/:fileName", deleteKnowledgeBase)

// Endpoint to handle chat requests
router.post("/chat", chatBot);
router.post("/streamChat", streamChatBot);


export default router;
