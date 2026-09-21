const express = require("express");
const { listUsers, createUser } = require("../controllers/userController");

const router = express.Router();

router.get("/", listUsers);
router.post("/", createUser);

module.exports = router;
