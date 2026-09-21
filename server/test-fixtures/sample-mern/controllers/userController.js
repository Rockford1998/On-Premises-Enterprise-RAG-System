const userService = require("../services/userService");

async function listUsers(req, res) {
  const users = await userService.findAll();
  res.json(users);
}

async function createUser(req, res) {
  const user = await userService.createUser(req.body);
  res.status(201).json(user);
}

module.exports = { listUsers, createUser };
